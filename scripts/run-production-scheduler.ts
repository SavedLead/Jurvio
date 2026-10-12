import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db/client";
import { recordLaneRun } from "@/modules/ingestion/application/lane-health";
import { jobsForLane, type ScheduledJob } from "./scheduler-jobs";

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

const configuredLane = process.env.JURVIO_SCHEDULER_LANE ?? "core";
const activeJobs = jobsForLane(configuredLane);

const running = new Set<string>();
const timers: NodeJS.Timeout[] = [];

// Bookkeeping-only pool: the scheduler records each lane's exit outcome so the
// supervisor can detect a crash-looping lane. A failure here must never take down
// the scheduler loop, so every write is best-effort (see recordLaneOutcome).
const sql = db();

function logStatus(name: string, message: string): void {
  const timestamp = new Date().toISOString();
  const line = `${timestamp} ${message}\n`;
  process.stdout.write(`[${name}] ${line}`);
  const stream = createWriteStream(join(logRoot, `${name}.log`), { flags: "a" });
  stream.end(line);
}

const LANE_TAIL_MAX = 8_000;

function recordLaneOutcome(outcome: Parameters<typeof recordLaneRun>[1]): void {
  // Never let lane-health bookkeeping (a bad DB connection, a transient error)
  // abort the long-running scheduler. Detection is best-effort by design.
  recordLaneRun(sql, outcome).catch((error) => {
    process.stdout.write(
      `[lane-health] failed to record ${outcome.lane}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  });
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
  const commandLine = `node ${command.join(" ")}`;
  const startedAt = new Date();
  logStatus(job.name, `started: ${commandLine}`);
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

  // Keep the trailing bytes of the child's output so a failed lane can persist the
  // actual error (an uncaught throw goes to stderr) into scheduler_lane_run, not
  // just an exit code. Bounded, so a chatty lane can never grow this unbounded.
  let tail = "";
  const collect = (chunk: Buffer): void => {
    tail = (tail + chunk.toString("utf8")).slice(-LANE_TAIL_MAX);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  // Unify cleanup + recording so it happens exactly once whether the child exits
  // normally or fails to spawn. Previously `running` and the log stream were only
  // cleaned up in the `close` handler, so a spawn error (where `close` may never
  // fire) would leave the lane wedged as permanently "running" and skipped forever.
  let settled = false;
  const settle = (code: number | null, signal: NodeJS.Signals | null, extraTail: string | null): void => {
    if (settled) return;
    settled = true;
    running.delete(job.name);
    output.end();
    logStatus(job.name, `finished: code=${code ?? "null"} signal=${signal ?? "none"}`);
    const finishedAt = new Date();
    const errorTail = [extraTail, tail].filter(Boolean).join("\n").trim().slice(-LANE_TAIL_MAX) || null;
    recordLaneOutcome({
      lane: job.name,
      schedulerLane: configuredLane,
      command: commandLine,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      exitCode: code,
      signal: signal ?? null,
      errorTail,
    });
  };

  child.once("error", (error) => settle(null, null, `spawn failed: ${error.message}`));
  child.once("close", (code, signal) => settle(code, signal, null));
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

