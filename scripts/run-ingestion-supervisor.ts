import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeDb, db } from "@/db/client";
import {
  queueDepth,
  reapExpiredLeases,
  recordHeartbeat,
  recordRepairAction,
} from "@/modules/ingestion/application/pg-job-queue";
import { detectFailingLanes } from "@/modules/ingestion/application/lane-health";
import { isQueueGrowthAnomalous } from "@/modules/ingestion/domain/job-scheduling";
import { runJudgeAutopilot } from "@/modules/judges/application/judge-autopilot";

// Server-resident supervisor for the durable ingestion job queue. Runs as its
// own container/service with restart: unless-stopped, so it survives crashes and
// server reboots. Each tick it: refreshes its liveness heartbeat (file + DB),
// reaps leases abandoned by crashed/stalled workers back to `pending` (bounded,
// safe self-repair), and records a backpressure signal when the pending queue
// grows past a threshold. Every automatic action is written to
// ingestion_repair_action with detector/action/reason/outcome — it never
// silently repairs, never makes publication/legal judgments, and never spends.

const artifactRoot =
  process.env.JURVIO_ARTIFACT_ROOT ?? process.env.RAW_ARTIFACT_DIR ?? "/var/lib/jurvio/artifacts";
const heartbeatDir = join(artifactRoot, "scheduler");
mkdirSync(heartbeatDir, { recursive: true });
const heartbeatFile = join(heartbeatDir, "supervisor.alive");

const sql = db();
const workerId = process.env.SUPERVISOR_ID ?? `supervisor-${process.pid}`;
const intervalMs = Number(process.env.SUPERVISOR_INTERVAL_MS ?? 30_000);
const queueThreshold = Number(process.env.SUPERVISOR_QUEUE_THRESHOLD ?? 50_000);
const once = process.argv.includes("--once");
const judgeAutopilotIntervalMs = Number(process.env.JUDGE_AUTOPILOT_INTERVAL_MS ?? 5 * 60_000);
let lastJudgeAutopilotAt = 0;

// A persistently-failing scheduler lane (crash-looping on startup, never once
// succeeding) is flagged into ingestion_repair_action so it surfaces in the repair
// feed with the real error tail. Detection is throttled per lane so a lane that
// keeps failing does not flood the append-only audit — one alert per lane per
// interval, until the underlying code/config is fixed by a human/PR. The supervisor
// deliberately does NOT auto-restart a crashing lane: a startup crash needs a fix,
// not a retry, and inventing one would violate the "never silently repair beyond
// safe requeues, never make code judgments" contract.
const laneAlertIntervalMs = Number(process.env.SUPERVISOR_LANE_ALERT_INTERVAL_MS ?? 15 * 60_000);
const laneAlertAt = new Map<string, number>();

async function detectAndFlagFailingLanes(): Promise<number> {
  const failingLanes = await detectFailingLanes(sql);
  let flagged = 0;
  for (const lane of failingLanes) {
    const last = laneAlertAt.get(lane.lane) ?? 0;
    if (Date.now() - last < laneAlertIntervalMs) continue;
    laneAlertAt.set(lane.lane, Date.now());
    await recordRepairAction(sql, {
      detector: "lane-health",
      subject: `lane:${lane.lane}`,
      action: "flag_failing_lane",
      reason:
        `${lane.lane} failed ${lane.failedRuns}x with no successful run in the detection window`
        + ` (last exit code ${lane.lastExitCode ?? "null"}`
        + `${lane.lastSignal ? `, signal ${lane.lastSignal}` : ""})`,
      outcome: "flagged",
      detail: {
        lane: lane.lane,
        schedulerLane: lane.schedulerLane,
        failedRuns: lane.failedRuns,
        lastExitCode: lane.lastExitCode,
        lastSignal: lane.lastSignal,
        lastRunAt: lane.lastRunAt,
        errorTail: lane.lastErrorTail,
      },
    });
    flagged += 1;
  }
  return flagged;
}

async function tick(): Promise<{ reaped: number; depth: number; judgeAutopilotRan: boolean; lanesFlagged: number }> {
  writeFileSync(heartbeatFile, String(Math.floor(Date.now() / 1000)));
  await recordHeartbeat(sql, { workerId, lane: "supervisor" });

  let judgeAutopilotRan = false;
  if (Date.now() - lastJudgeAutopilotAt >= judgeAutopilotIntervalMs) {
    lastJudgeAutopilotAt = Date.now();
    const judgeSnapshot = await runJudgeAutopilot(sql);
    judgeAutopilotRan = true;
    await recordHeartbeat(sql, {
      workerId: `${workerId}-judges`, lane: "judge-autopilot", status: "alive",
      detail: { ...judgeSnapshot },
    });
  }

  const reaped = await reapExpiredLeases(sql);
  if (reaped > 0) {
    await recordRepairAction(sql, {
      detector: "lease-reaper",
      subject: "ingestion_job",
      action: "requeue_expired_lease",
      reason: `${reaped} expired lease(s) reclaimed from crashed/stalled workers`,
      outcome: "requeued",
      detail: { reaped },
    });
  }

  const depth = await queueDepth(sql);
  if (isQueueGrowthAnomalous(depth, queueThreshold)) {
    await recordRepairAction(sql, {
      detector: "queue-growth",
      subject: "ingestion_job",
      action: "record_backpressure",
      reason: `pending depth ${depth} exceeds ${queueThreshold}`,
      outcome: "recorded",
      detail: { depth, threshold: queueThreshold },
    });
  }

  const lanesFlagged = await detectAndFlagFailingLanes();

  return { reaped, depth, judgeAutopilotRan, lanesFlagged };
}

if (once) {
  try {
    const result = await tick();
    console.log(JSON.stringify({ supervisor: workerId, ...result, at: new Date().toISOString() }));
  } finally {
    await closeDb();
  }
} else {
  // Long-running loop. The container/service restart policy keeps it alive; the
  // loop itself never exits so a single failing tick cannot stop supervision.
  for (;;) {
    try {
      const result = await tick();
      console.log(
        JSON.stringify({ supervisor: workerId, ...result, at: new Date().toISOString() }),
      );
    } catch (error) {
      console.error(
        "supervisor tick failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
