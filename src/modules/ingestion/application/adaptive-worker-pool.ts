import {
  initialConcurrencyState,
  recordOutcome,
  type AdaptiveConcurrencyConfig,
  type AdaptiveConcurrencyState,
  type OutcomeSignal,
  type RecordOutcomeResult,
} from "../domain/adaptive-concurrency";

/**
 * Bounded worker pool whose parallelism is governed at runtime by the adaptive
 * concurrency controller. Memory stays bounded because it never buffers the whole
 * queue: it pulls one item at a time via `pull`, and only ever has up to
 * `state.concurrency` (<= config.max) items in flight.
 *
 * The pool is a single-threaded dispatcher (Node's event loop): at most one `pull`
 * is outstanding at any moment, and new work is only spawned while
 * `inFlight < state.concurrency`, so the controller's decision to shrink takes
 * effect immediately (no new work) and its decision to grow ramps up as capacity
 * frees. `handle` is never expected to reject — callers wrap per-item work and
 * translate it into an OutcomeSignal — but a stray rejection is treated as a plain
 * failure so one bad item can never abort the cycle.
 */
export interface AdaptiveWorkerPoolParams<T> {
  readonly config: AdaptiveConcurrencyConfig;
  /** Returns the next item, or undefined when the eligible queue is drained. */
  readonly pull: () => Promise<T | undefined>;
  /** Processes one item and reports its outcome. Should not throw. */
  readonly handle: (item: T) => Promise<OutcomeSignal>;
  /** Optional starting state so the controller can be threaded across pages/chunks. */
  readonly initialState?: AdaptiveConcurrencyState;
  /** Optional observer for every controller decision (logging/metrics). */
  readonly onStep?: (step: RecordOutcomeResult, item: T) => void;
}

export interface AdaptiveWorkerPoolResult {
  readonly processed: number;
  readonly finalState: AdaptiveConcurrencyState;
}

export async function runAdaptiveWorkerPool<T>(
  params: AdaptiveWorkerPoolParams<T>,
): Promise<AdaptiveWorkerPoolResult> {
  const { config, pull, handle, onStep } = params;
  let state = params.initialState ?? initialConcurrencyState(config);
  let inFlight = 0;
  let processed = 0;
  let drained = false;
  let pulling = false;

  return await new Promise<AdaptiveWorkerPoolResult>((resolve, reject) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve({ processed, finalState: state });
    };
    const abort = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const complete = (outcome: OutcomeSignal): void => {
      inFlight -= 1;
      processed += 1;
      const step = recordOutcome(config, state, outcome);
      state = step.state;
      try {
        onStep?.(step, undefined as unknown as T);
      } catch {
        // Never let an observer error abort ingestion.
      }
      pump();
    };

    function pump(): void {
      if (settled) return;
      if (drained && inFlight === 0 && !pulling) {
        finish();
        return;
      }
      if (drained || pulling || inFlight >= state.concurrency) return;

      pulling = true;
      pull().then(
        (item) => {
          pulling = false;
          if (settled) return;
          if (item === undefined) {
            drained = true;
            pump();
            return;
          }
          inFlight += 1;
          handle(item).then(complete, (error) => {
            // A rejection from handle is unexpected; degrade it to a failure signal.
            const message = error instanceof Error ? error.message : String(error);
            complete({ ok: false, ...classifyFailureSignal(new Error(message)) });
          });
          // There may be room for more workers; keep the pipeline full.
          pump();
        },
        abort,
      );
    }

    pump();
  });
}

/**
 * Classify a thrown error into adaptive-concurrency distress signals.
 *
 * - `throttled`: source rate limiting (HTTP 429 / "rate limit" / "too many requests"),
 *   which should back the pool off the upstream API.
 * - `dbPressure`: Postgres connection/timeout/capacity/deadlock conditions, which should
 *   back the pool off the database. postgres.js surfaces these as errors carrying a
 *   `code` (SQLSTATE or a driver code like CONNECT_TIMEOUT / CONNECTION_ENDED), plus the
 *   usual socket-level codes.
 *
 * Anything else is a plain failure (counts toward error-rate / consecutive-failure trips
 * but is not itself a throttle or DB signal).
 */
export function classifyFailureSignal(
  error: unknown,
): { throttled: boolean; dbPressure: boolean } {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const code =
    typeof (error as { code?: unknown } | null)?.code === "string"
      ? String((error as { code: string }).code).toUpperCase()
      : "";

  const throttled =
    /\b429\b/.test(message) ||
    message.includes("too many requests") ||
    message.includes("rate limit") ||
    message.includes("ratelimit") ||
    message.includes("throttle");

  const dbPressureCodes = new Set([
    "CONNECT_TIMEOUT",
    "CONNECTION_ENDED",
    "CONNECTION_DESTROYED",
    "CONNECTION_CLOSED",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "57P01", // admin_shutdown
    "57P03", // cannot_connect_now
    "53300", // too_many_connections
    "53400", // configuration_limit_exceeded
    "40P01", // deadlock_detected
    "55P03", // lock_not_available
    "08006", // connection_failure
    "08003", // connection_does_not_exist
    "08001", // sqlclient_unable_to_establish_sqlconnection
  ]);
  const dbPressure =
    dbPressureCodes.has(code) ||
    message.includes("too many clients") ||
    message.includes("too many connections") ||
    message.includes("connection terminated") ||
    message.includes("connection timeout") ||
    message.includes("connect_timeout") ||
    message.includes("connection ended") ||
    message.includes("deadlock") ||
    message.includes("db timeout") ||
    message.includes("statement timeout") ||
    message.includes("canceling statement due to statement timeout");

  return { throttled, dbPressure };
}
