import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

// Library of Congress U.S. Reports backfill coordinator (www.loc.gov + tile.loc.gov,
// both confirmed reachable from the ingestion box). This closes the one remaining
// gap in SCOTUS coverage: the supremecourt.gov PDF parser only handles the modern
// "Nos. ... Decided" format, so it never produced candidates for the earliest
// volumes (roughly 1-111, ~1790-1885). LoC publishes those volumes with structured
// per-case metadata, so this coordinator sweeps them and feeds the shared SCOTUS
// publish path. The LoC single-volume ingester already existed but was never
// scheduled; this is the missing coordinator + lane.
const oldestVolume = Number.parseInt(process.env.LOC_BACKFILL_OLDEST_VOLUME ?? "2", 10);
// LoC covers volumes 2-501. Default to the un-ingested early tail (<=111); raise
// LOC_BACKFILL_MAX_VOLUME to sweep further into the LoC range if needed.
const maxVolume = Math.min(Number.parseInt(process.env.LOC_BACKFILL_MAX_VOLUME ?? "111", 10), 501);
const volumeWorkers = Number.parseInt(process.env.LOC_BACKFILL_WORKERS ?? "3", 10);
const leaseKey = "jurvio:loc-us-reports:coordinator";
const artifactRoot = process.env.JURVIO_ARTIFACT_ROOT
  ?? process.env.RAW_ARTIFACT_DIR
  ?? "/var/lib/jurvio/artifacts";
const stateRoot = join(artifactRoot, "scheduler", "loc-us-reports");

type Sql = ReturnType<typeof postgres>;
type VolumeOutcome = "completed" | "failed" | "already-running" | "empty";

function runNode(args: string[]): Promise<{ code: number | null; signal: string | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, {
      cwd: "/app",
      env: { ...process.env, RAW_ARTIFACT_DIR: artifactRoot, JURVIO_ARTIFACT_ROOT: artifactRoot },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, output }));
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function isComplete(volume: number): Promise<boolean> {
  try {
    await readFile(join(stateRoot, `${volume}.complete.json`), "utf8");
    return true;
  } catch {
    return false;
  }
}

function lastJsonObject(output: string): Record<string, unknown> | null {
  for (const line of output.trim().split("\n").reverse()) {
    try {
      const value: unknown = JSON.parse(line);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // Scheduler output may precede the final machine-readable result.
    }
  }
  return null;
}

function numberField(value: Record<string, unknown> | null, field: string): number {
  const raw = value?.[field];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : -1;
}

async function runVolume(volume: number): Promise<void> {
  // Ingest every case LoC lists for this volume. The single-volume ingester isolates
  // each case internally, so a few unparseable records never abort the volume.
  const ingestion = await runNode([
    "jobs/ingest-loc-us-reports-volume.mjs",
    `--volume=${volume}`,
    "--limit=1000",
    "--resume=true",
  ]);
  await writeFile(join(stateRoot, `${volume}.ingest.log`), ingestion.output);
  const result = lastJsonObject(ingestion.output);
  const discovered = numberField(result, "discovered");
  if (ingestion.code !== 0 && discovered < 1) {
    throw new Error(`LoC volume ${volume} ingester exited ${ingestion.code ?? "null"}: ${ingestion.output.slice(-1_500)}`);
  }
  // Drain the shared SCOTUS publish/extract path so the freshly-ingested candidates
  // become published cases in the same cycle.
  const publish = await runNode(["jobs/publish-official-scotus-opinions.mjs", "--limit=10000"]);
  const extract = await runNode(["jobs/extract-official-scotus-opinion-text.mjs", "--limit=1000"]);
  await writeJson(join(stateRoot, `${volume}.complete.json`), {
    volume,
    completedAt: new Date().toISOString(),
    discovered,
    ingestion: result,
    publishCode: publish.code,
    extractCode: extract.code,
  });
}

async function runVolumeWithLease(databaseUrl: string, volume: number): Promise<VolumeOutcome> {
  const volumeSql = postgres(databaseUrl, { max: 1 });
  try {
    const [lease] = await volumeSql<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${`jurvio:loc-us-reports:volume:${volume}`})) AS acquired
    `;
    if (!lease?.acquired) return "already-running";
    await runVolume(volume);
    return "completed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // LoC legitimately has no listing for a handful of volumes; treat that as an
    // empty (not failed) outcome so the sweep still records progress and moves on.
    if (/returned no cases|no matching cases/i.test(message)) return "empty";
    process.stderr.write(`LoC volume ${volume} failed: ${message}\n`);
    return "failed";
  } finally {
    await volumeSql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  await mkdir(stateRoot, { recursive: true });
  const databaseUrl: string = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the LoC U.S. Reports backfill lease");

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [lease] = await sql<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${leaseKey})) AS acquired
    `;
    if (!lease?.acquired) {
      process.stdout.write("LoC U.S. Reports backfill coordinator skipped: another coordinator holds the lease\n");
      return;
    }

    const volumes: number[] = [];
    for (let volume = oldestVolume; volume <= maxVolume; volume += 1) {
      if (!await isComplete(volume)) volumes.push(volume);
    }
    // Oldest first: the earliest volumes are the ones missing from the corpus.
    volumes.sort((left, right) => left - right);

    const completed: number[] = [];
    const failed: number[] = [];
    const empty: number[] = [];
    let cursor = 0;
    const writeStatus = (status: string): Promise<void> => writeJson(join(stateRoot, "status.json"), {
      status, updatedAt: new Date().toISOString(), oldestVolume, maxVolume, volumeWorkers,
      pending: volumes.slice(cursor), completed: [...completed], failed: [...failed], empty: [...empty],
    });

    await writeStatus(volumes.length === 0 ? "complete" : "running");
    if (volumes.length === 0) {
      process.stdout.write("LoC U.S. Reports backfill coordinator complete: no unfinished volumes\n");
      return;
    }

    async function worker(): Promise<void> {
      while (true) {
        const volume = volumes[cursor];
        if (volume === undefined) return;
        cursor += 1;
        const outcome = await runVolumeWithLease(databaseUrl, volume);
        if (outcome === "completed") completed.push(volume);
        else if (outcome === "failed") failed.push(volume);
        else if (outcome === "empty") empty.push(volume);
        await writeStatus("running");
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, Math.min(volumeWorkers, volumes.length)) }, () => worker()));
    await writeStatus(failed.length === 0 ? "complete" : "complete-with-failures");
    process.stdout.write(
      `LoC U.S. Reports backfill finished: completed=${completed.length}, empty=${empty.length}, failed=${failed.length}\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
