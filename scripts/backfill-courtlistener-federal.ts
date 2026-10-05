import postgres from "postgres";
import {
  BACKFILL_STAGES,
  runFederalBackfill,
  type BackfillStage,
} from "@/modules/ingestion/application/bulk-backfill/run-federal-backfill";

// Full federal CourtListener backfill from a local, checksummed snapshot
// (see docs/operations/full-federal-backfill.md). Exit codes:
//   0  every requested stage completed
//   75 stopped at a batch boundary (signal, time budget, size cap); rerun to resume
//   1  failed

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function flag(name: string, fallback: boolean): boolean {
  if (process.argv.includes(`--${name}`)) return true;
  const value = option(name);
  if (value === undefined) return fallback;
  if (["true", "1"].includes(value)) return true;
  if (["false", "0"].includes(value)) return false;
  throw new Error(`--${name} must be true or false`);
}

function positiveNumber(name: string): number | undefined {
  const raw = option(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
}

const snapshotDate = option("snapshot-date") ?? "";
const snapshotDir = option("snapshot-dir") ?? "";
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error("--snapshot-date=YYYY-MM-DD is required");
if (!snapshotDir) throw new Error("--snapshot-dir=<directory with SHA256SUMS> is required");

const stages = (option("stages") ?? "").split(",").filter(Boolean);
for (const stage of stages) {
  if (!(BACKFILL_STAGES as readonly string[]).includes(stage)) {
    throw new Error(`--stages accepts ${BACKFILL_STAGES.join(",")}`);
  }
}
const courts = (option("courts") ?? "").split(",").map((code) => code.trim()).filter(Boolean);
const minYear = positiveNumber("min-year");
if (minYear !== undefined && (!Number.isInteger(minYear) || minYear < 1600 || minYear > 2100)) {
  throw new Error("--min-year must be an integer from 1600 to 2100");
}
const maxRowsPerStage = positiveNumber("max-rows-per-stage");
const timeBudgetMinutes = positiveNumber("time-budget-minutes");
const maxDatabaseGb = positiveNumber("max-database-gb");
const targetBatchMs = positiveNumber("target-batch-ms") ?? 4_000;
const maxPauseMs = positiveNumber("max-pause-ms") ?? 30_000;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

// A dedicated small pool: the loader runs one batch at a time plus the cursor
// that builds the prefilter. synchronous_commit=off applies to this session only;
// a crash can lose the last few commits, and their cursors with them, so the
// rerun simply repeats those batches.
const sql = postgres(databaseUrl, {
  max: 3,
  prepare: true,
  idle_timeout: 60,
  connect_timeout: 30,
  onnotice: () => undefined,
  transform: { undefined: null },
  connection: {
    application_name: "jurvio-federal-backfill",
    synchronous_commit: "off",
    statement_timeout: 0,
  },
});

let signalled = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    signalled = true;
    console.log(JSON.stringify({ lane: "courtlistener-federal-backfill", event: "stop_requested", signal }));
  });
}

try {
  const result = await runFederalBackfill(sql, {
    snapshotDate,
    snapshotDir,
    includeBankruptcy: flag("include-bankruptcy", true),
    includeScotus: flag("include-scotus", false),
    courts: courts.length ? courts : undefined,
    minYear,
    stages: stages.length ? (stages as BackfillStage[]) : undefined,
    maxRowsPerStage,
    governor: {
      targetBatchMs,
      maxPauseMs,
      maxDatabaseBytes: maxDatabaseGb === undefined ? undefined : maxDatabaseGb * 1024 ** 3,
      deadline: timeBudgetMinutes === undefined ? undefined : Date.now() + timeBudgetMinutes * 60_000,
    },
    signalled: () => signalled,
    log: (event) =>
      console.log(JSON.stringify({ lane: "courtlistener-federal-backfill", at: new Date().toISOString(), ...event })),
  });
  console.log(JSON.stringify({ lane: "courtlistener-federal-backfill", event: "result", ...result }));
  if (result.status === "stopped") process.exitCode = 75;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 10 });
}
