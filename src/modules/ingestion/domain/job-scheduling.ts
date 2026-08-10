// Pure scheduling logic for the durable ingestion job queue and supervisor.
//
// All decisions the queue and supervisor make — backoff timing, retry vs. dead,
// lease expiry, dedupe identity, checkpoint staleness, queue-growth and
// idle-polling detection — live here as pure functions so they are exhaustively
// unit-testable without a database. The SQL adapter and the supervisor loop are
// thin shells over this module.

export type JobStatus = "pending" | "leased" | "succeeded" | "failed" | "dead";
export type JobOutcome = "succeeded" | "retryable_error" | "fatal_error";

export interface BackoffPolicy {
  readonly baseMs: number;
  readonly factor: number;
  readonly maxMs: number;
}

/** Conservative default: 30s → 1m → 2m → … capped at 1h. */
export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 30_000, factor: 2, maxMs: 3_600_000 };

/**
 * Bounded exponential backoff for the Nth attempt (attempt 1 == first retry).
 * Deterministic (no jitter) so it is testable; callers may add jitter at the
 * edge if desired.
 */
export function computeBackoffMs(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF): number {
  if (attempt <= 0) return 0;
  const raw = policy.baseMs * policy.factor ** (attempt - 1);
  return Math.min(policy.maxMs, Math.round(raw));
}

export interface TransitionResult {
  readonly status: JobStatus;
  /** True when the job is scheduled to run again after a backoff. */
  readonly retry: boolean;
  /** Backoff before the next attempt, in ms (0 when not retrying). */
  readonly backoffMs: number;
}

/**
 * Decide a job's next state after a run outcome. A retryable error re-queues
 * with backoff until max_attempts is reached, then the job goes to `dead` for
 * review (never silently dropped). A fatal error goes straight to `dead`.
 */
export function nextStateAfter(
  outcome: JobOutcome,
  attempts: number,
  maxAttempts: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
): TransitionResult {
  if (outcome === "succeeded") return { status: "succeeded", retry: false, backoffMs: 0 };
  if (outcome === "fatal_error") return { status: "dead", retry: false, backoffMs: 0 };
  // retryable_error
  if (attempts >= maxAttempts) return { status: "dead", retry: false, backoffMs: 0 };
  return { status: "pending", retry: true, backoffMs: computeBackoffMs(attempts, policy) };
}

/** Stable idempotency key for a unit of work. */
export function dedupeKey(kind: string, courtCode: string | null, partition: string | null): string {
  return [kind, courtCode ?? "*", partition ?? "*"].join(":");
}

/** A lease is expired when now is at/after its expiry. */
export function isLeaseExpired(nowMs: number, leaseExpiresAtMs: number | null): boolean {
  if (leaseExpiresAtMs === null) return false;
  return nowMs >= leaseExpiresAtMs;
}

export function leaseExpiryMs(nowMs: number, leaseDurationMs: number): number {
  return nowMs + Math.max(0, leaseDurationMs);
}

/**
 * A checkpoint is stale when no progress has been recorded within its freshness
 * target (plus a grace multiplier to avoid flapping right at the boundary).
 */
export function isCheckpointStale(
  nowMs: number,
  lastProgressMs: number,
  freshnessTargetMs: number,
  graceFactor = 2,
): boolean {
  return nowMs - lastProgressMs > freshnessTargetMs * graceFactor;
}

/** A worker is considered crashed/stalled when its heartbeat is older than the limit. */
export function isWorkerStalled(nowMs: number, lastHeartbeatMs: number, limitMs: number): boolean {
  return nowMs - lastHeartbeatMs > limitMs;
}

/** Queue growth is anomalous when depth exceeds the threshold (backpressure signal). */
export function isQueueGrowthAnomalous(pendingDepth: number, threshold: number): boolean {
  return pendingDepth > threshold;
}

/**
 * Idle-polling detection: when the last `window` runs of a source all produced
 * zero new usable items, polling should be reduced/paused so we stop spending
 * work on a source that yields nothing incremental.
 */
export function shouldReduceIdlePolling(recentNewItemCounts: readonly number[], window: number): boolean {
  if (recentNewItemCounts.length < window) return false;
  return recentNewItemCounts.slice(-window).every((n) => n === 0);
}

/** Multiply a poll interval when a source is idle, capped, to back off gracefully. */
export function backoffPollIntervalMs(baseIntervalMs: number, idleRounds: number, maxIntervalMs: number): number {
  const factor = 2 ** Math.max(0, idleRounds);
  return Math.min(maxIntervalMs, baseIntervalMs * factor);
}
