import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";

type ScheduledJob = {
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
    name: "scotus-pre500-backfill",
    initialDelayMs: 30_000,
    intervalMs: 5 * minute,
    command: ["jobs/run-scotus-pre500-backfill.mjs"],
  },
  {
    name: "direct-court",
    initialDelayMs: 0,
    intervalMs: 5 * minute,
    command: ["jobs/ingest-direct-court-feeds.mjs", "--court=all"],
  },
  {
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
  // The public GovInfo DEMO_KEY permits ten searches per rolling hour. These
  // non-overlapping 120-minute groups place at most ten searches in any such
  // window while every one of the 13 durable circuit cursors advances.
  {
    name: "appellate-govinfo-backfill-a",
    initialDelayMs: 3 * minute,
    intervalMs: 120 * minute,
    command: [
      "jobs/ingest-govinfo-appellate.mjs",
      "--court=ca1,ca2,ca3,ca4,ca5",
      "--page-size=1000",
      "--pages-per-court=10",
    ],
  },
  {
    name: "appellate-govinfo-backfill-b",
    initialDelayMs: 43 * minute,
    intervalMs: 120 * minute,
    command: [
      "jobs/ingest-govinfo-appellate.mjs",
      "--court=ca6,ca7,ca8,ca9,ca10",
      "--page-size=1000",
      "--pages-per-court=10",
    ],
  },
  {
    name: "appellate-govinfo-backfill-c",
    initialDelayMs: 83 * minute,
    intervalMs: 120 * minute,
    command: [
      "jobs/ingest-govinfo-appellate.mjs",
      "--court=ca11,cadc,cafc",
      "--page-size=1000",
      "--pages-per-court=10",
    ],
  },
  {
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
  {
    name: "federal-new-cases",
    initialDelayMs: 2 * minute,
    intervalMs: 60 * minute,
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=new-case-discovery",
      "--limit=100",
      "--approve-scale-up=false",
      "--delay-ms=1000",
    ],
  },
  {
    name: "federal-material-decisions",
    initialDelayMs: 12 * minute,
    intervalMs: 60 * minute,
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=material-decisions",
      "--limit=100",
      "--approve-scale-up=false",
      "--delay-ms=1000",
    ],
  },
  {
    name: "federal-publication",
    initialDelayMs: 22 * minute,
    intervalMs: 60 * minute,
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=publication-quarantine",
      "--limit=100",
      "--approve-scale-up=false",
      "--delay-ms=0",
    ],
  },
  {
    name: "federal-active-cases",
    initialDelayMs: 32 * minute,
    intervalMs: 6 * 60 * minute,
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=active-case-updates",
      "--limit=100",
      "--approve-scale-up=false",
      "--delay-ms=1000",
    ],
  },
  {
    name: "federal-history",
    initialDelayMs: 42 * minute,
    intervalMs: 24 * 60 * minute,
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=historical-backfill",
      "--limit=100",
      "--approve-scale-up=false",
      "--delay-ms=1000",
    ],
  },
];

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

for (const job of jobs) {
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
logStatus("scheduler", `ready with ${jobs.length} server-side schedules`);
