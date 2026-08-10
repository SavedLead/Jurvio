import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeDb, db } from "@/db/client";
import {
  queueDepth,
  reapExpiredLeases,
  recordHeartbeat,
  recordRepairAction,
} from "@/modules/ingestion/application/pg-job-queue";
import { isQueueGrowthAnomalous } from "@/modules/ingestion/domain/job-scheduling";

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

async function tick(): Promise<{ reaped: number; depth: number }> {
  writeFileSync(heartbeatFile, String(Math.floor(Date.now() / 1000)));
  await recordHeartbeat(sql, { workerId, lane: "supervisor" });

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

  return { reaped, depth };
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
