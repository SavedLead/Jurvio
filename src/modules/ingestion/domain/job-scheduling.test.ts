import { describe, expect, it } from "vitest";
import {
  backoffPollIntervalMs,
  computeBackoffMs,
  dedupeKey,
  DEFAULT_BACKOFF,
  isCheckpointStale,
  isLeaseExpired,
  isQueueGrowthAnomalous,
  isWorkerStalled,
  leaseExpiryMs,
  nextStateAfter,
  shouldReduceIdlePolling,
} from "./job-scheduling";

describe("job-scheduling", () => {
  it("computes bounded exponential backoff", () => {
    expect(computeBackoffMs(0)).toBe(0);
    expect(computeBackoffMs(1)).toBe(30_000);
    expect(computeBackoffMs(2)).toBe(60_000);
    expect(computeBackoffMs(3)).toBe(120_000);
    // Caps at maxMs (1h) rather than growing unbounded.
    expect(computeBackoffMs(20)).toBe(DEFAULT_BACKOFF.maxMs);
  });

  it("retries a retryable error with backoff until max_attempts, then goes dead", () => {
    expect(nextStateAfter("retryable_error", 1, 3)).toEqual({
      status: "pending",
      retry: true,
      backoffMs: 30_000,
    });
    expect(nextStateAfter("retryable_error", 3, 3)).toEqual({
      status: "dead",
      retry: false,
      backoffMs: 0,
    });
  });

  it("sends a fatal error straight to dead and a success to succeeded", () => {
    expect(nextStateAfter("fatal_error", 1, 8).status).toBe("dead");
    expect(nextStateAfter("succeeded", 1, 8)).toEqual({
      status: "succeeded",
      retry: false,
      backoffMs: 0,
    });
  });

  it("builds a stable dedupe key with wildcards for null parts", () => {
    expect(dedupeKey("direct-court-feed", "txwd", "2026-08-10")).toBe(
      "direct-court-feed:txwd:2026-08-10",
    );
    expect(dedupeKey("scotus-backfill", null, null)).toBe("scotus-backfill:*:*");
  });

  it("detects lease expiry and computes lease windows", () => {
    expect(isLeaseExpired(100, null)).toBe(false);
    expect(isLeaseExpired(100, 101)).toBe(false);
    expect(isLeaseExpired(101, 101)).toBe(true);
    expect(leaseExpiryMs(1_000, 5_000)).toBe(6_000);
  });

  it("detects stale checkpoints, stalled workers, and queue growth", () => {
    // freshnessTarget 60s, grace 2× → stale only after 120s.
    expect(isCheckpointStale(200_000, 100_000, 60_000)).toBe(false);
    expect(isCheckpointStale(230_000, 100_000, 60_000)).toBe(true);
    expect(isWorkerStalled(500_000, 100_000, 180_000)).toBe(true);
    expect(isWorkerStalled(200_000, 100_000, 180_000)).toBe(false);
    expect(isQueueGrowthAnomalous(5_000, 1_000)).toBe(true);
    expect(isQueueGrowthAnomalous(100, 1_000)).toBe(false);
  });

  it("reduces idle polling only after a full window of zero-yield runs", () => {
    expect(shouldReduceIdlePolling([0, 0, 0], 3)).toBe(true);
    expect(shouldReduceIdlePolling([0, 1, 0], 3)).toBe(false);
    expect(shouldReduceIdlePolling([0, 0], 3)).toBe(false); // not enough history yet
    expect(backoffPollIntervalMs(60_000, 0, 3_600_000)).toBe(60_000);
    expect(backoffPollIntervalMs(60_000, 3, 3_600_000)).toBe(480_000);
    expect(backoffPollIntervalMs(60_000, 100, 3_600_000)).toBe(3_600_000); // capped
  });
});
