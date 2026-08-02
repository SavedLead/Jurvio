import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const newestVolume = 499;
const oldestVolume = 1;
const volumeWorkers = 4;
const leaseKey = "jurvio:scotus-pre500:coordinator";
const artifactRoot = process.env.JURVIO_ARTIFACT_ROOT
  ?? process.env.RAW_ARTIFACT_DIR
  ?? "/var/lib/jurvio/artifacts";
const stateRoot = join(artifactRoot, "scheduler", "scotus-pre500");

type Sql = ReturnType<typeof postgres>;

type VolumeResult = {
  volume: number;
  code: number | null;
  signal: string | null;
  output: string;
};

type VolumeOutcome = "completed" | "failed" | "already-running";

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
  return { published, extracted };
}

async function verifyPublishedVolume(
  sql: Sql,
  volume: number,
  expectedRecords: number,
): Promise<Record<string, unknown>> {
  const [provider] = await sql<{ id: string }[]>`
    SELECT id FROM provider WHERE code = 'scotus_official'
  `;
  if (!provider) throw new Error("Official Supreme Court provider seed is missing");
  const [proof] = await sql<{
    candidates: number;
    publicCases: number;
    publicOpinions: number;
  }[]>`
    SELECT
      COUNT(DISTINCT candidate.source_record_id)::int AS candidates,
      COUNT(DISTINCT candidate.source_record_id) FILTER (
        WHERE legal_case.publication = 'published'
      )::int AS "publicCases",
      COUNT(DISTINCT candidate.source_record_id) FILTER (
        WHERE document.publication = 'published'
      )::int AS "publicOpinions"
    FROM official_opinion_candidate candidate
    LEFT JOIN case_identifier ON case_identifier.provider_id = candidate.provider_id
      AND case_identifier.identifier_type = 'scotus_official_opinion'
      AND case_identifier.identifier_value = candidate.source_record_id
    LEFT JOIN legal_case ON legal_case.id = case_identifier.case_id
    LEFT JOIN document_identifier ON document_identifier.provider_id = candidate.provider_id
      AND document_identifier.identifier_type = 'scotus_official_opinion'
      AND document_identifier.identifier_value = candidate.source_record_id
    LEFT JOIN document ON document.id = document_identifier.document_id
    WHERE candidate.provider_id = ${provider.id}
      AND candidate.citation LIKE ${`${volume} U.S.%`}
  `;
  const actual = proof ?? { candidates: 0, publicCases: 0, publicOpinions: 0 };
  if (actual.candidates < expectedRecords
    || actual.publicCases < expectedRecords
    || actual.publicOpinions < expectedRecords) {
    throw new Error(`volume ${volume} has not reached durable public proof: ${JSON.stringify({
      expectedRecords, ...actual,
    })}`);
  }
  return { expectedRecords, ...actual };
}

async function runVolume(
  sql: Sql,
  volume: number,
  drain: (volume: number) => Promise<Record<string, unknown>>,
): Promise<void> {
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
      const discovered = numberField(ingestion, "discovered");
      const selected = numberField(ingestion, "selected");
      const succeeded = numberField(ingestion, "succeeded");
      const failed = numberField(ingestion, "failed");
      // A resumable volume may have already persisted every candidate before an
      // earlier coordinator stopped at its publication gate. In that state the
      // ingester correctly selects no new records; proceed to publication, which
      // remains the required proof before writing the completion checkpoint.
      const resumedAtEnd = selected === 0 && succeeded === 0 && failed === 0;
      if (discovered < 1
        || failed !== 0
        || (!resumedAtEnd && (selected < 1 || succeeded < 1))) {
        throw new Error(`ingestion gate not met: ${result.output.slice(-2_000)}`);
      }
      const publication = await drain(volume);
      // A retry may legitimately create zero new pages because the prior run
      // already published them. Completion is based on durable public records,
      // not the retry's delta, and requires both the case and official opinion.
      const publicProof = await verifyPublishedVolume(sql, volume, discovered);
      await writeJson(join(stateRoot, `${volume}.stages.json`), {
        volume, verifiedAt: new Date().toISOString(), attempt, ingestion, publication, publicProof,
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

async function runVolumeWithLease(
  databaseUrl: string,
  volume: number,
  drain: (volume: number) => Promise<Record<string, unknown>>,
): Promise<VolumeOutcome> {
  const volumeSql = postgres(databaseUrl, { max: 1 });
  try {
    const [lease] = await volumeSql<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${`jurvio:scotus-pre500:volume:${volume}`})) AS acquired
    `;
    if (!lease?.acquired) {
      process.stdout.write(`Volume ${volume} skipped: another lane already holds its lease\n`);
      return "already-running";
    }
    await runVolume(volumeSql, volume, drain);
    return "completed";
  } catch (error) {
    process.stderr.write(`Volume ${volume} failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return "failed";
  } finally {
    await volumeSql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  await mkdir(stateRoot, { recursive: true });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the SCOTUS backfill lease");

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [lease] = await sql<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${leaseKey})) AS acquired
    `;
    if (!lease?.acquired) {
      process.stdout.write("SCOTUS pre-500 coordinator skipped: another coordinator holds the lease\n");
      return;
    }

    const volumes: number[] = [];
    for (let volume = newestVolume; volume >= oldestVolume; volume -= 1) {
      if (!await isComplete(volume)) volumes.push(volume);
    }

    let publicationTail: Promise<void> = Promise.resolve();
    const drainSerially = async (volume: number): Promise<Record<string, unknown>> => {
      let resolveDrain: ((value: Record<string, unknown>) => void) | undefined;
      let rejectDrain: ((reason?: unknown) => void) | undefined;
      const current = new Promise<Record<string, unknown>>((resolve, reject) => {
        resolveDrain = resolve;
        rejectDrain = reject;
      });
      const previous = publicationTail;
      publicationTail = current.then(() => undefined, () => undefined);
      try {
        await previous;
        const result = await drainPublication(volume);
        resolveDrain?.(result);
        return result;
      } catch (error) {
        rejectDrain?.(error);
        throw error;
      }
    };

    let cursor = 0;
    const completedVolumes: number[] = [];
    const failedVolumes: number[] = [];
    const runningVolumes: number[] = [];
    const alreadyRunningVolumes: number[] = [];

    let statusTail: Promise<void> = Promise.resolve();
    const writeStatus = (status: "running" | "complete" | "complete-with-failures"): Promise<void> => {
      const snapshot = {
        status,
        updatedAt: new Date().toISOString(),
        newestVolume,
        oldestVolume,
        volumeWorkers,
        pendingVolumes: volumes.slice(cursor),
        runningVolumes: [...runningVolumes].sort((a, b) => b - a),
        completedVolumes: [...completedVolumes].sort((a, b) => b - a),
        failedVolumes: [...failedVolumes].sort((a, b) => b - a),
        alreadyRunningVolumes: [...alreadyRunningVolumes].sort((a, b) => b - a),
      };
      statusTail = statusTail.then(() => writeJson(join(stateRoot, "status.json"), snapshot));
      return statusTail;
    };

    await writeStatus(volumes.length === 0 ? "complete" : "running");
    if (volumes.length === 0) {
      process.stdout.write("SCOTUS pre-500 coordinator complete: no unfinished volumes\n");
      return;
    }

    async function worker(): Promise<void> {
      while (true) {
        const volume = volumes[cursor];
        if (volume === undefined) return;
        cursor += 1;
        runningVolumes.push(volume);
        await writeStatus("running");
        const outcome = await runVolumeWithLease(databaseUrl, volume, drainSerially);
        runningVolumes.splice(runningVolumes.indexOf(volume), 1);
        if (outcome === "completed") completedVolumes.push(volume);
        if (outcome === "failed") failedVolumes.push(volume);
        if (outcome === "already-running") alreadyRunningVolumes.push(volume);
        await writeStatus("running");
      }
    }

    await Promise.all(Array.from({ length: Math.min(volumeWorkers, volumes.length) }, () => worker()));
    await writeStatus(failedVolumes.length === 0 ? "complete" : "complete-with-failures");
    process.stdout.write(`SCOTUS pre-500 coordinator finished: completed=${completedVolumes.length}, failed=${failedVolumes.length}, alreadyRunning=${alreadyRunningVolumes.length}\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
