import type { db } from "@/db/client";
import {
  dedupeKey,
  leaseExpiryMs,
  nextStateAfter,
  type BackoffPolicy,
  type JobOutcome,
  type TransitionResult,
} from "../domain/job-scheduling";

// Thin PostgreSQL adapter over the pure job-scheduling domain. Provides durable,
// idempotent enqueue, single-leaser claiming (FOR UPDATE SKIP LOCKED), outcome
// transitions with backoff, expired-lease reaping, worker heartbeats, and an
// append-only repair-action audit. The scheduling *decisions* live in
// ../domain/job-scheduling and are unit-tested there; this layer only executes
// them against Postgres.

type Db = ReturnType<typeof db>;
type Json = Parameters<Db["json"]>[0];

function asJson(value: Record<string, unknown>): Json {
  return value as unknown as Json;
}

export interface EnqueueInput {
  readonly kind: string;
  readonly courtCode?: string | null;
  readonly partition?: string | null;
  readonly payload?: Record<string, unknown>;
  readonly priority?: number;
  readonly maxAttempts?: number;
  readonly runAfter?: Date;
}

export interface JobRow {
  readonly id: string;
  readonly kind: string;
  readonly court_code: string | null;
  readonly partition: string | null;
  readonly payload: Record<string, unknown>;
  readonly priority: number;
  readonly status: string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly dedupe_key: string;
}

/** Idempotent enqueue. If a job with the same dedupe key is already outstanding, no duplicate is created. */
export async function enqueueJob(
  sql: Db,
  input: EnqueueInput,
): Promise<{ id: string | null; deduped: boolean }> {
  const key = dedupeKey(input.kind, input.courtCode ?? null, input.partition ?? null);
  const rows = await sql<{ id: string }[]>`
    INSERT INTO ingestion_job (kind, court_code, partition, payload, priority, max_attempts, run_after, dedupe_key)
    VALUES (
      ${input.kind}, ${input.courtCode ?? null}, ${input.partition ?? null},
      ${sql.json(asJson(input.payload ?? {}))}, ${input.priority ?? 100}, ${input.maxAttempts ?? 8},
      ${input.runAfter ?? new Date()}, ${key}
    )
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id
  `;
  const first = rows[0];
  return first ? { id: first.id, deduped: false } : { id: null, deduped: true };
}

/** Atomically lease the next eligible job for a worker. Returns null when the queue is empty. */
export async function leaseNextJob(
  sql: Db,
  opts: { owner: string; leaseDurationMs: number; now?: Date },
): Promise<JobRow | null> {
  const now = opts.now ?? new Date();
  const expiresAt = new Date(leaseExpiryMs(now.getTime(), opts.leaseDurationMs));
  const rows = await sql<JobRow[]>`
    UPDATE ingestion_job SET
      status = 'leased',
      lease_owner = ${opts.owner},
      lease_expires_at = ${expiresAt},
      attempts = attempts + 1,
      updated_at = now()
    WHERE id = (
      SELECT id FROM ingestion_job
      WHERE status = 'pending' AND run_after <= ${now}
      ORDER BY priority, run_after
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, kind, court_code, partition, payload, priority, status, attempts, max_attempts, dedupe_key
  `;
  return rows[0] ?? null;
}

export async function completeJob(sql: Db, id: string): Promise<void> {
  await sql`
    UPDATE ingestion_job SET status = 'succeeded', last_error = NULL, updated_at = now()
    WHERE id = ${id}
  `;
}

/** Record a run outcome, applying the domain transition (retry-with-backoff, or dead after max attempts). */
export async function failJob(
  sql: Db,
  opts: {
    id: string;
    attempts: number;
    maxAttempts: number;
    outcome: Exclude<JobOutcome, "succeeded">;
    error: string;
    now?: Date;
    policy?: BackoffPolicy;
  },
): Promise<TransitionResult> {
  const now = opts.now ?? new Date();
  const transition = nextStateAfter(opts.outcome, opts.attempts, opts.maxAttempts, opts.policy);
  const runAfter = new Date(now.getTime() + transition.backoffMs);
  await sql`
    UPDATE ingestion_job SET
      status = ${transition.status},
      run_after = ${runAfter},
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error = ${opts.error.slice(0, 4000)},
      updated_at = now()
    WHERE id = ${opts.id}
  `;
  return transition;
}

/** Reap leases that expired (crashed/stalled workers) back to pending so another worker can claim them. */
export async function reapExpiredLeases(sql: Db, opts: { now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const rows = await sql<{ id: string }[]>`
    UPDATE ingestion_job SET
      status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
      run_after = ${now}, updated_at = now()
    WHERE status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < ${now}
    RETURNING id
  `;
  return rows.length;
}

export async function recordHeartbeat(
  sql: Db,
  opts: { workerId: string; lane: string; status?: string; detail?: Record<string, unknown> },
): Promise<void> {
  await sql`
    INSERT INTO ingestion_worker_heartbeat (worker_id, lane, status, last_heartbeat_at, detail)
    VALUES (${opts.workerId}, ${opts.lane}, ${opts.status ?? "alive"}, now(), ${sql.json(asJson(opts.detail ?? {}))})
    ON CONFLICT (worker_id) DO UPDATE SET
      lane = EXCLUDED.lane, status = EXCLUDED.status,
      last_heartbeat_at = EXCLUDED.last_heartbeat_at, detail = EXCLUDED.detail
  `;
}

export async function recordRepairAction(
  sql: Db,
  entry: {
    detector: string;
    subject: string;
    action: string;
    reason: string;
    outcome: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    INSERT INTO ingestion_repair_action (detector, subject, action, reason, outcome, detail)
    VALUES (${entry.detector}, ${entry.subject}, ${entry.action}, ${entry.reason}, ${entry.outcome},
            ${sql.json(asJson(entry.detail ?? {}))})
  `;
}

export async function queueDepth(sql: Db): Promise<number> {
  const rows = await sql<{ pending: string }[]>`
    SELECT count(*)::text AS pending FROM ingestion_job WHERE status = 'pending'
  `;
  return Number(rows[0]?.pending ?? 0);
}
