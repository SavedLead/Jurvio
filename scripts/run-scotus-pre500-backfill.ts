import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const newestVolume = 499;
const oldestVolume = 477;
const volumeWorkers = 1;
const leaseKey = "jurvio:scotus-pre500:499-477";
const artifactRoot = process.env.JURVIO_ARTIFACT_ROOT
  ?? process.env.RAW_ARTIFACT_DIR
  ?? "/var/lib/jurvio/artifacts";
const stateRoot = join(artifactRoot, "scheduler", "scotus-pre500");

type VolumeResult = {
  volume: number;
  code: number | null;
  signal: string | null;
  output: string;
};

function runNode(args: string[]): Promise<VolumeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, {
      cwd: "/app",
      env: {
        ...process.env,
        RAW_ARTIFACT_DIR: artifactRoot,
        JURVIO_ARTIFACT_ROOT: artifactRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ volume: Number.NaN, code, signal, output });
    });
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

async function drainPublication(volume: number): Promise<Record<string, unknown>> {
  const publication = await runNode(["jobs/publish-official-scotus-opinions.mjs", "--limit=10000"]);
  const extraction = await runNode(["jobs/extract-official-scotus-opinion-text.mjs", "--limit=1000"]);
  const published = lastJsonObject(publication.output);
  const extracted = lastJsonObject(extraction.output);
  if (publication.code !== 0 || extraction.code !== 0) {
    throw new Error(`volume ${volume} publication/extraction process failed: publish=${publication.code}, extract=${extraction.code}`);
  }
  if (numberField(published, "published") < 1) {
    throw new Error(`volume ${volume} produced no public case pages: ${publication.output.slice(-2_000)}`);
  }
  return { published, extracted };
}

async function runVolume(volume: number): Promise<void> {
  const attempts: Array<{ code: number | null; signal: string | null; output: string }> = [];
  let lastStageFailure: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await runNode([
      "jobs/ingest-loc-us-reports-volume.mjs",
      `--volume=${volume}`,
      "--limit=1000",
      "--resume=true",
    ]);
    attempts.push({ code: result.code, signal: result.signal, output: result.output });
    await writeFile(join(stateRoot, `${volume}.attempt-${attempt}.log`), result.output);
    const ingestion = lastJsonObject(result.output);
    try {
      if (result.code !== 0) throw new Error(`ingester exited ${result.code ?? "null"}`);
      if (numberField(ingestion, "discovered") < 1
        || numberField(ingestion, "selected") < 1
        || numberField(ingestion, "succeeded") < 1
        || numberField(ingestion, "failed") !== 0) {
        throw new Error(`ingestion gate not met: ${result.output.slice(-2_000)}`);
      }
      const publication = await drainPublication(volume);
      await writeJson(join(stateRoot, `${volume}.stages.json`), {
        volume, verifiedAt: new Date().toISOString(), attempt, ingestion, publication,
      });
      await rm(join(stateRoot, `${volume}.failed.json`), { force: true });
      await writeJson(join(stateRoot, `${volume}.complete.json`), {
        volume, completedAt: new Date().toISOString(), attempts: attempt, ingestion, publication,
      });
      return;
    } catch (error) {
      lastStageFailure = error instanceof Error ? error.message : String(error);
      await writeJson(join(stateRoot, `${volume}.stages.json`), {
        volume, checkedAt: new Date().toISOString(), attempt, ingestion,
        failure: lastStageFailure,
      });
      // This is a controlled operator command. Persist the full diagnostic and
      // emit a bounded, stage-specific tail so Actions never reduces a real
      // production failure to only "volume failed".
      process.stderr.write(`Volume ${volume} attempt ${attempt} stage failure: ${lastStageFailure}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 15_000));
  }

  await writeJson(join(stateRoot, `${volume}.failed.json`), {
    volume,
    failedAt: new Date().toISOString(),
    attempts: attempts.map((attempt) => ({
      code: attempt.code,
      signal: attempt.signal,
      tail: attempt.output.slice(-4_000),
    })),
  });
  throw new Error(`volume ${volume} failed after two verified attempts: ${lastStageFailure ?? "no stage diagnostic recorded"}`);
}

async function main(): Promise<void> {
  await mkdir(stateRoot, { recursive: true });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the SCOTUS backfill lease");

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [lease] = await sql<{ acquired: boolean }[]>
      `SELECT pg_try_advisory_lock(hashtext(${leaseKey})) AS acquired`;
    if (!lease?.acquired) {
      process.stdout.write("SCOTUS pre-500 coordinator skipped: another coordinator holds the lease\n");
      return;
    }

    const volumes: number[] = [];
    for (let volume = newestVolume; volume >= oldestVolume; volume -= 1) {
      if (!await isComplete(volume)) volumes.push(volume);
    }

    await writeJson(join(stateRoot, "status.json"), {
      status: volumes.length === 0 ? "complete" : "running",
      updatedAt: new Date().toISOString(),
      newestVolume,
      oldestVolume,
      volumeWorkers,
      pendingVolumes: volumes,
      completedVolumes: [],
      failedVolumes: [],
    });

    if (volumes.length === 0) {
      process.stdout.write("SCOTUS pre-500 coordinator complete: no unfinished volumes\n");
      return;
    }

    let cursor = 0;
    const completedVolumes: number[] = [];
    const failedVolumes: number[] = [];
    async function worker(): Promise<void> {
      while (cursor < volumes.length) {
        const volume = volumes[cursor];
        if (volume === undefined) return;
        cursor += 1;
        try {
          await runVolume(volume);
          completedVolumes.push(volume);
        } catch (error) {
          failedVolumes.push(volume);
          process.stderr.write(`Volume ${volume} failed: ${error instanceof Error ? error.message : String(error)}\n`);
        }
        await writeJson(join(stateRoot, "status.json"), {
          status: "running",
          updatedAt: new Date().toISOString(),
          newestVolume,
          oldestVolume,
          volumeWorkers,
          pendingVolumes: volumes.slice(cursor),
          completedVolumes: [...completedVolumes].sort((a, b) => b - a),
          failedVolumes: [...failedVolumes].sort((a, b) => b - a),
        });
        // Preserve ordering and the durable checkpoint: do not let a later
        // volume mask the first failed one or compound pressure on production.
        if (failedVolumes.length > 0) break;
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(volumeWorkers, volumes.length) }, () => worker()));
    } finally {
      // Each volume runs publication synchronously inside runVolume so its stage
      // record and completion checkpoint cannot get ahead of public visibility.
    }
    await writeJson(join(stateRoot, "status.json"), {
      status: failedVolumes.length === 0 ? "complete" : "needs-retry",
      updatedAt: new Date().toISOString(),
      newestVolume,
      oldestVolume,
      volumeWorkers,
      pendingVolumes: failedVolumes.length === 0
        ? []
        : volumes.slice(volumes.indexOf(failedVolumes[0]!)),
      completedVolumes: [...completedVolumes].sort((a, b) => b - a),
      failedVolumes: [...failedVolumes].sort((a, b) => b - a),
    });

    if (failedVolumes.length > 0) {
      throw new Error(`SCOTUS pre-500 coordinator completed with failed volumes: ${failedVolumes.join(",")}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
