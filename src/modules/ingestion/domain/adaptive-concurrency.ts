/**
 * Adaptive, self-throttling concurrency controller for federal ingestion.
 *
 * SAFETY NOTE: Jurvio's federal loops run on a small production droplet that has
 * OOM-killed (exit 137) before. This controller therefore favors correctness and
 * conservative behavior over peak throughput:
 *
 *   - It starts LOW (a modest default concurrency) and only climbs slowly (+1 at a
 *     time) after a sustained clean window, so a healthy system ramps gently rather
 *     than spiking memory/DB load.
 *   - It reacts FAST to trouble: any distress signal HALVES concurrency immediately
 *     (multiplicative decrease / additive increase, i.e. AIMD), flooring at 1 so the
 *     loop never fully stalls but also never hammers a struggling dependency.
 *   - It never exceeds a hard maximum, which is itself clamped well below anything
 *     that could exhaust the droplet's memory or the Postgres connection pool.
 *
 * The module is intentionally PURE (no timers, no I/O, no globals): every decision is
 * a function of the previous state plus the outcome of a single processed item, which
 * makes the escalation/de-escalation logic exhaustively unit-testable.
 */

/** Tunable thresholds and bounds. All are plain numbers so they are trivial to test. */
export interface AdaptiveConcurrencyConfig {
  /** Concurrency the controller boots at. Conservative by design. */
  readonly start: number;
  /** Floor. Concurrency never drops below this (loop must keep making progress). */
  readonly min: number;
  /** Hard ceiling. Concurrency never rises above this, regardless of health. */
  readonly max: number;
  /** Error-rate trip point over the sliding window, as a fraction (0.15 == 15%). */
  readonly errorRateThreshold: number;
  /** Sliding-window length (number of recent outcomes) used for the error rate. */
  readonly windowSize: number;
  /** Trip after this many consecutive failures, independent of the window rate. */
  readonly consecutiveFailureLimit: number;
  /** Consecutive clean outcomes required before recovering by +1. */
  readonly recoveryStreak: number;
}

/**
 * Conservative, OOM-safe defaults.
 *
 * start=6 keeps steady-state memory and the Postgres pool (max: 10 connections)
 * comfortably under pressure while still being ~6x faster than the old strictly
 * sequential + 1s/item throttle. max=16 is a hard cap chosen to stay safe even in
 * the worst case where every worker holds a connection; the pool queues rather than
 * errors past 10, and 16 bounds in-flight record memory. min=1 guarantees forward
 * progress under sustained distress without ever fully stalling.
 */
export const ADAPTIVE_CONCURRENCY_DEFAULTS: AdaptiveConcurrencyConfig = {
  start: 6,
  min: 1,
  max: 16,
  errorRateThreshold: 0.15,
  windowSize: 20,
  consecutiveFailureLimit: 5,
  recoveryStreak: 20,
};

/** Signal for a single processed item. `ok` is success; the flags are distress signals. */
export interface OutcomeSignal {
  /** True when the item was ingested successfully. */
  readonly ok: boolean;
  /** Source rate-limit / 429 / throttle response. Forces an immediate reduction. */
  readonly throttled?: boolean;
  /** DB distress: query error, connection failure, or elevated latency. Forces reduction. */
  readonly dbPressure?: boolean;
}

/** Immutable controller state. Treat as opaque; always thread the returned value. */
export interface AdaptiveConcurrencyState {
  /** Current concurrency level the worker pool should target. */
  readonly concurrency: number;
  /** Recent outcomes as failure flags (true == failure), newest last, capped to windowSize. */
  readonly window: readonly boolean[];
  /** Number of failures in a row, reset by any clean success. */
  readonly consecutiveFailures: number;
  /** Number of clean successes in a row, reset by any distress. */
  readonly cleanStreak: number;
}

export type AdaptiveAction = "reduce" | "raise" | "hold";

export interface RecordOutcomeResult {
  readonly state: AdaptiveConcurrencyState;
  readonly action: AdaptiveAction;
  /** Populated when action === "reduce": which threshold tripped, for logging. */
  readonly trippedBy?: "throttle" | "db_pressure" | "consecutive_failures" | "error_rate";
}

function clampInteger(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(high, Math.trunc(value)));
}

/**
 * Build a validated config from partial overrides (e.g. env vars / CLI flags).
 * Clamps every field into a sane range so a misconfigured env can never, for example,
 * set an unbounded max or a start above the hard ceiling.
 */
export function resolveAdaptiveConfig(
  overrides: Partial<AdaptiveConcurrencyConfig> = {},
): AdaptiveConcurrencyConfig {
  const base = ADAPTIVE_CONCURRENCY_DEFAULTS;
  // Absolute safety ceiling: even an explicit override cannot ask for more than this.
  const HARD_LIMIT = 64;
  const max = clampInteger(overrides.max ?? base.max, 1, HARD_LIMIT);
  const min = clampInteger(overrides.min ?? base.min, 1, max);
  const start = clampInteger(overrides.start ?? base.start, min, max);
  const windowSize = clampInteger(overrides.windowSize ?? base.windowSize, 1, 10_000);
  const consecutiveFailureLimit = clampInteger(
    overrides.consecutiveFailureLimit ?? base.consecutiveFailureLimit,
    1,
    10_000,
  );
  const recoveryStreak = clampInteger(overrides.recoveryStreak ?? base.recoveryStreak, 1, 10_000);
  let errorRateThreshold = overrides.errorRateThreshold ?? base.errorRateThreshold;
  if (!Number.isFinite(errorRateThreshold) || errorRateThreshold <= 0 || errorRateThreshold > 1) {
    errorRateThreshold = base.errorRateThreshold;
  }
  return { start, min, max, errorRateThreshold, windowSize, consecutiveFailureLimit, recoveryStreak };
}

/** Fresh state booting at the configured (conservative) starting concurrency. */
export function initialConcurrencyState(config: AdaptiveConcurrencyConfig): AdaptiveConcurrencyState {
  return { concurrency: config.start, window: [], consecutiveFailures: 0, cleanStreak: 0 };
}

function windowErrorRate(window: readonly boolean[]): number {
  if (window.length === 0) return 0;
  const failures = window.reduce((total, failed) => total + (failed ? 1 : 0), 0);
  return failures / window.length;
}

/**
 * Fold one item outcome into the controller state and decide the next concurrency.
 *
 * Reduction (HALVE, floor at min) fires when ANY of these trip, checked in priority order:
 *   1. a source throttle / 429 signal,
 *   2. a DB-pressure signal,
 *   3. `consecutiveFailureLimit` failures in a row,
 *   4. the sliding-window error rate exceeding `errorRateThreshold` (only once the window
 *      is full, so a single early failure can't trip it — bursty failures are caught by #3).
 *
 * On a trip we reset the measurement window, streaks, and consecutive-failure count so the
 * halved level gets a fresh window to prove itself before any further reduction.
 *
 * Recovery (+1, capped at max) fires after `recoveryStreak` consecutive clean outcomes.
 *
 * Otherwise concurrency holds.
 */
export function recordOutcome(
  config: AdaptiveConcurrencyConfig,
  state: AdaptiveConcurrencyState,
  outcome: OutcomeSignal,
): RecordOutcomeResult {
  const failed = !outcome.ok;
  const window = [...state.window, failed].slice(-config.windowSize);
  const consecutiveFailures = failed ? state.consecutiveFailures + 1 : 0;
  const distressed = failed || Boolean(outcome.throttled) || Boolean(outcome.dbPressure);
  const cleanStreak = distressed ? 0 : state.cleanStreak + 1;

  let trippedBy: RecordOutcomeResult["trippedBy"] | undefined;
  if (outcome.throttled) {
    trippedBy = "throttle";
  } else if (outcome.dbPressure) {
    trippedBy = "db_pressure";
  } else if (consecutiveFailures >= config.consecutiveFailureLimit) {
    trippedBy = "consecutive_failures";
  } else if (
    window.length >= config.windowSize &&
    windowErrorRate(window) > config.errorRateThreshold
  ) {
    trippedBy = "error_rate";
  }

  if (trippedBy) {
    const reduced = Math.max(config.min, Math.floor(state.concurrency / 2));
    return {
      state: { concurrency: reduced, window: [], consecutiveFailures: 0, cleanStreak: 0 },
      action: "reduce",
      trippedBy,
    };
  }

  if (cleanStreak >= config.recoveryStreak && state.concurrency < config.max) {
    return {
      state: {
        concurrency: state.concurrency + 1,
        window,
        consecutiveFailures: 0,
        cleanStreak: 0,
      },
      action: "raise",
    };
  }

  return {
    state: { concurrency: state.concurrency, window, consecutiveFailures, cleanStreak },
    action: "hold",
  };
}
