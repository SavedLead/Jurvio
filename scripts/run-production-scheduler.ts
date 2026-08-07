import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type SchedulerLane = "coa" | "core";

type ScheduledJob = {
  lane: SchedulerLane;
  name: string;
  initialDelayMs: number;
  intervalMs: number;
  command: string[];
};

const minute = 60_000;
const artifactRoot = process.env.JURVIO_ARTIFACT_ROOT
  ?? process.env.RAW_ARTIFACT_DIR
  ?? "/var/lib/jurvio/artifacts";
const logRoot = join(artifactRoot, "scheduler");
mkdirSync(logRoot, { recursive: true });

function currentScotusTerm(): string {
  const now = new Date();
  const year = now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return String(year % 100).padStart(2, "0");
}

const jobs: ScheduledJob[] = [
  {
    lane: "core",
    name: "judge-case-matching",
    initialDelayMs: 8 * minute,
    intervalMs: 15 * minute,
    command: ["jobs/match-judges.mjs", "--limit=5000"],
  },
  {
    lane: "core",
    name: "fjc-judge-roster",
    initialDelayMs: 3 * minute,
    intervalMs: 24 * 60 * minute,
    command: ["jobs/import-fjc-judges.mjs", "--limit=50000"],
  },
  {
    lane: "core",
    name: "district-court-source-scout",
    initialDelayMs: 15 * minute,
    intervalMs: 7 * 24 * 60 * minute,
    command: [
      "jobs/scout-district-court-sources.mjs",
      "--limit=94",
      "--output=/var/lib/jurvio/artifacts/reports/district-court-scout.json",
    ],
  },
  {
    lane: "core",
    name: "scotus-pre500-backfill",
    initialDelayMs: 30_000,
    intervalMs: 5 * minute,
    command: ["jobs/run-scotus-pre500-backfill.mjs"],
  },
  {
    lane: "coa",
    name: "direct-court",
    initialDelayMs: 0,
    intervalMs: 5 * minute,
    command: ["jobs/ingest-direct-court-feeds.mjs", "--court=all"],
  },
  {
    lane: "coa",
    name: "appellate-official",
    initialDelayMs: 1 * minute,
    intervalMs: 5 * minute,
    command: [
      "jobs/run-appellate-ingestion.mjs",
      "--court=all",
      "--watch=false",
      "--discovery-concurrency=13",
      "--processing-concurrency=52",
    ],
  },
  // Advance one durable circuit cursor per cycle. Database-backed selection
  // prevents later circuits from being starved when unrelated deployments
  // restart this process before long in-memory stagger delays can fire.
  // Seven-minute spacing stays below the shared DEMO_KEY limit; a configured
  // free key automatically enables the importer's multi-page mode.
  {
    lane: "coa",
    name: "appellate-govinfo-backfill",
    initialDelayMs: 2 * minute,
    intervalMs: 7 * minute,
    command: [
      "jobs/ingest-govinfo-appellate.mjs",
      "--court=next",
      "--page-size=1000",
      "--pages-per-court=10",
    ],
  },
  {
    lane: "coa",
    name: "appellate-courtlistener-backfill",
    initialDelayMs: 6 * minute,
    intervalMs: 10 * minute,
    command: [
      "jobs/ingest-courtlistener-appellate-backfill.mjs",
      "--court=next",
      "--batch-size=20",
      "--delay-ms=1000",
      "--min-year=1700",
      "--maximum-attempts=10",
    ],
  },
  {
    lane: "coa",
    name: "appellate-backfill-report",
    initialDelayMs: 8 * minute,
    intervalMs: 15 * minute,
    command: ["jobs/report-appellate-backfill.mjs"],
  },
  {
    lane: "core",
    name: "scotus-enriched",
    initialDelayMs: 4 * minute,
    intervalMs: 5 * minute,
    command: [
      "jobs/ingest-enriched-official-scotus.mjs",
      "--term=__CURRENT_SCOTUS_TERM__",
      "--limit=100",
      "--resume=true",
      "--attempts=10",
    ],
  },
  // Federal loops no longer carry the artificial throttle (fixed --limit=100 ceiling,
  // forced --approve-scale-up=false, and 1s/item --delay-ms). They now self-throttle via
  // a bounded adaptive worker pool: conservative --start-concurrency that climbs only after
  // clean windows and halves on distress, capped by --max-concurrency (hard max 16), and a
  // finite --max-items runaway guard rather than an hourly ceiling. Defaults are OOM-safe
  // for the small droplet; per-loop overrides below stay well inside those bounds.
  {
    lane: "core",
    name: "federal-new-cases",
    initialDelayMs: 2 * minute,
    intervalMs: 60 * minute,
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=new-case-discovery",
      "--start-concurrency=6",
      "--max-concurrency=8",
      "--max-items=5000",
    ],
  },
  {
    lane: "core",
    name: "federal-material-decisions",
    initialDelayMs: 12 * minute,
    intervalMs: 60 * minute,
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=material-decisions",
      "--start-concurrency=6",
      "--max-concurrency=8",
      "--max-items=5000",
    ],
  },
  {
    lane: "core",
    name: "federal-publication",
    initialDelayMs: 22 * minute,
    intervalMs: 60 * minute,
    // Publication is pure DB work (each publish opens a transaction); keep concurrency
    // lower so it never starves the shared Postgres pool (max 10 connections).
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=publication-quarantine",
      "--start-concurrency=4",
      "--max-concurrency=6",
      "--max-items=5000",
    ],
  },
  {
    lane: "core",
    name: "federal-active-cases",
    initialDelayMs: 32 * minute,
    intervalMs: 6 * 60 * minute,
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=active-case-updates",
      "--start-concurrency=6",
      "--max-concurrency=8",
      "--max-items=5000",
    ],
  },
  {
    lane: "core",
    name: "federal-history",
    initialDelayMs: 42 * minute,
    intervalMs: 24 * 60 * minute,
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=historical-backfill",
      "--start-concurrency=6",
      "--max-concurrency=8",
      "--max-items=5000",
    ],
  },
];

const configuredLane = process.env.JURVIO_SCHEDULER_LANE ?? "core";
if (configuredLane !== "coa" && configuredLane !== "core") {
  throw new Error(`JURVIO_SCHEDULER_LANE must be "coa" or "core"; received ${configuredLane}`);
}
const activeJobs = jobs.filter((job) => job.lane === configuredLane);
if (activeJobs.length === 0) {
  throw new Error(`No jobs configured for scheduler lane ${configuredLane}`);
}
if (
  configuredLane === "coa"
  && activeJobs.some((job) => job.name.startsWith("scotus-"))
) {
  throw new Error("COA scheduler must never include SCOTUS jobs");
}

const running = new Set<string>();
const timers: NodeJS.Timeout[] = [];

function logStatus(name: string, message: string): void {
  const timestamp = new Date().toISOString();
  const line = `${timestamp} ${message}\n`;
  process.stdout.write(`[${name}] ${line}`);
  const stream = createWriteStream(join(logRoot, `${name}.log`), { flags: "a" });
  stream.end(line);
}

function run(job: ScheduledJob): void {
  if (running.has(job.name)) {
    logStatus(job.name, "skipped: previous cycle still running");
    return;
  }

  running.add(job.name);
  const command = job.command.map((argument) =>
    argument === "--term=__CURRENT_SCOTUS_TERM__" ? `--term=${currentScotusTerm()}` : argument
  );
  logStatus(job.name, `started: node ${command.join(" ")}`);
  const output = createWriteStream(join(logRoot, `${job.name}.log`), { flags: "a" });
  const child = spawn("node", command, {
    cwd: "/app",
    env: {
      ...process.env,
      RAW_ARTIFACT_DIR: artifactRoot,
      JURVIO_ARTIFACT_ROOT: artifactRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });

  child.once("error", (error) => {
    logStatus(job.name, `spawn failed: ${error.message}`);
  });
  child.once("close", (code, signal) => {
    running.delete(job.name);
    output.end();
    logStatus(job.name, `finished: code=${code ?? "null"} signal=${signal ?? "none"}`);
  });
}

for (const job of activeJobs) {
  const start = setTimeout(() => {
    run(job);
    const repeating = setInterval(() => run(job), job.intervalMs);
    repeating.unref();
    timers.push(repeating);
  }, job.initialDelayMs);
  timers.push(start);
}

function shutdown(signal: string): void {
  for (const timer of timers) clearTimeout(timer);
  logStatus("scheduler", `received ${signal}; waiting for container restart`);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Liveness heartbeat. The container's Docker healthcheck reads this file and
// considers the worker healthy only while it is being refreshed. Workers run
// the scheduler (no HTTP server), so the image's default HTTP healthcheck can
// never pass for them — this gives a health signal that reflects the scheduler
// loop actually being alive. Not unref'd, so it also keeps the daemon alive
// between job cycles.
const heartbeatFile = join(logRoot, `${configuredLane}.alive`);
function writeHeartbeat(): void {
  try {
    writeFileSync(heartbeatFile, String(Math.floor(Date.now() / 1000)));
  } catch (error) {
    logStatus("scheduler", `heartbeat write failed: ${(error as Error).message}`);
  }
}
writeHeartbeat();
timers.push(setInterval(writeHeartbeat, 30_000));

logStatus("scheduler", `ready lane=${configuredLane} with ${activeJobs.length} server-side schedules`);
