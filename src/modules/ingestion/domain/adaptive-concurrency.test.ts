import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_CONCURRENCY_DEFAULTS,
  initialConcurrencyState,
  recordOutcome,
  resolveAdaptiveConfig,
  type AdaptiveConcurrencyConfig,
  type AdaptiveConcurrencyState,
  type OutcomeSignal,
} from "./adaptive-concurrency";

/** Fold a sequence of outcomes through the controller, returning the final state. */
function drive(
  config: AdaptiveConcurrencyConfig,
  outcomes: OutcomeSignal[],
  start: AdaptiveConcurrencyState = initialConcurrencyState(config),
): AdaptiveConcurrencyState {
  return outcomes.reduce((state, outcome) => recordOutcome(config, state, outcome).state, start);
}

const ok: OutcomeSignal = { ok: true };
const fail: OutcomeSignal = { ok: false };

describe("adaptive concurrency controller", () => {
  const config = resolveAdaptiveConfig();

  it("boots at the conservative default concurrency", () => {
    expect(initialConcurrencyState(config).concurrency).toBe(ADAPTIVE_CONCURRENCY_DEFAULTS.start);
    expect(config.start).toBe(6);
    expect(config.max).toBe(16);
    expect(config.min).toBe(1);
  });

  it("halves concurrency on a source throttle / 429 signal", () => {
    const step = recordOutcome(config, initialConcurrencyState(config), {
      ok: true,
      throttled: true,
    });
    expect(step.action).toBe("reduce");
    expect(step.trippedBy).toBe("throttle");
    expect(step.state.concurrency).toBe(3); // floor(6 / 2)
  });

  it("halves concurrency on a DB-pressure signal", () => {
    const step = recordOutcome(config, initialConcurrencyState(config), {
      ok: false,
      dbPressure: true,
    });
    expect(step.action).toBe("reduce");
    expect(step.trippedBy).toBe("db_pressure");
    expect(step.state.concurrency).toBe(3);
  });

  it("halves after the configured number of consecutive failures", () => {
    const start = initialConcurrencyState(config);
    // First (limit - 1) failures only accumulate; the Nth trips the reduction.
    const beforeTrip = drive(
      config,
      Array.from({ length: config.consecutiveFailureLimit - 1 }, () => fail),
      start,
    );
    expect(beforeTrip.concurrency).toBe(6);
    const step = recordOutcome(config, beforeTrip, fail);
    expect(step.action).toBe("reduce");
    expect(step.trippedBy).toBe("consecutive_failures");
    expect(step.state.concurrency).toBe(3);
  });

  it("resets the consecutive-failure counter after any success", () => {
    let state = initialConcurrencyState(config);
    for (let i = 0; i < config.consecutiveFailureLimit - 1; i += 1) {
      state = recordOutcome(config, state, fail).state;
    }
    state = recordOutcome(config, state, ok).state; // breaks the streak
    // A single failure now should not immediately trip the consecutive-failure rule.
    const step = recordOutcome(config, state, fail);
    expect(step.action).toBe("hold");
    expect(step.state.concurrency).toBe(6);
  });

  it("halves when the sliding-window error rate exceeds the threshold", () => {
    // Fill the window with a clean history, then inject enough failures to cross 15%.
    const cfg = resolveAdaptiveConfig({
      windowSize: 20,
      consecutiveFailureLimit: 100,
      recoveryStreak: 1000, // keep recovery out of the way so we isolate the error-rate trip
    });
    let state = initialConcurrencyState(cfg);
    // 20 successes fill the window at 0% error.
    state = drive(cfg, Array.from({ length: 20 }, () => ok), state);
    expect(state.concurrency).toBe(cfg.start);
    // Interleave failures so the consecutive rule never fires but the window rate climbs.
    // After enough, >15% (>3 of 20) of the window are failures.
    let tripped = false;
    for (let i = 0; i < 20 && !tripped; i += 1) {
      const outcome = i % 3 === 0 ? fail : ok;
      const step = recordOutcome(cfg, state, outcome);
      state = step.state;
      if (step.action === "reduce") {
        expect(step.trippedBy).toBe("error_rate");
        tripped = true;
      }
    }
    expect(tripped).toBe(true);
    expect(state.concurrency).toBe(3);
  });

  it("does not trip on a single early failure before the window is full", () => {
    const step = recordOutcome(config, initialConcurrencyState(config), fail);
    expect(step.action).toBe("hold");
    expect(step.state.concurrency).toBe(6);
  });

  it("floors at 1 under sustained distress and never stalls to 0", () => {
    let state = initialConcurrencyState(config);
    for (let i = 0; i < 10; i += 1) {
      state = recordOutcome(config, state, { ok: true, dbPressure: true }).state;
    }
    expect(state.concurrency).toBe(1);
    // Still 1 (not 0) after yet more distress.
    state = recordOutcome(config, state, { ok: true, throttled: true }).state;
    expect(state.concurrency).toBe(1);
  });

  it("recovers by +1 after a sustained clean window", () => {
    const cfg = resolveAdaptiveConfig({ recoveryStreak: 5, start: 4 });
    let state = initialConcurrencyState(cfg);
    // 4 clean outcomes: still holding.
    state = drive(cfg, [ok, ok, ok, ok], state);
    expect(state.concurrency).toBe(4);
    // The 5th clean outcome raises by exactly 1.
    const step = recordOutcome(cfg, state, ok);
    expect(step.action).toBe("raise");
    expect(step.state.concurrency).toBe(5);
    expect(step.state.cleanStreak).toBe(0);
  });

  it("recovers one step at a time, not in a jump", () => {
    const cfg = resolveAdaptiveConfig({ recoveryStreak: 3, start: 2, max: 16 });
    // 9 clean outcomes == 3 recovery streaks == +3 total.
    const state = drive(cfg, Array.from({ length: 9 }, () => ok));
    expect(state.concurrency).toBe(5); // 2 + 3
  });

  it("never exceeds the hard maximum no matter how clean the run is", () => {
    const cfg = resolveAdaptiveConfig({ recoveryStreak: 1, start: 15, max: 16 });
    const state = drive(cfg, Array.from({ length: 100 }, () => ok));
    expect(state.concurrency).toBe(16);
  });

  it("stops raising exactly at the cap and holds there", () => {
    const cfg = resolveAdaptiveConfig({ recoveryStreak: 1, start: 16, max: 16 });
    const step = recordOutcome(cfg, initialConcurrencyState(cfg), ok);
    expect(step.action).toBe("hold");
    expect(step.state.concurrency).toBe(16);
  });

  it("prioritizes throttle over other trip reasons for clear signalling", () => {
    // A failing item that is also throttled and DB-pressured reports throttle first.
    const step = recordOutcome(config, initialConcurrencyState(config), {
      ok: false,
      throttled: true,
      dbPressure: true,
    });
    expect(step.trippedBy).toBe("throttle");
  });
});

describe("resolveAdaptiveConfig clamping", () => {
  it("clamps an over-eager max to the absolute safety ceiling", () => {
    expect(resolveAdaptiveConfig({ max: 10_000 }).max).toBe(64);
  });

  it("keeps start within [min, max]", () => {
    expect(resolveAdaptiveConfig({ start: 100, max: 8 }).start).toBe(8);
    expect(resolveAdaptiveConfig({ start: 0, min: 2, max: 8 }).start).toBe(2);
  });

  it("rejects a nonsensical error-rate threshold and falls back to the default", () => {
    expect(resolveAdaptiveConfig({ errorRateThreshold: 0 }).errorRateThreshold).toBe(0.15);
    expect(resolveAdaptiveConfig({ errorRateThreshold: 5 }).errorRateThreshold).toBe(0.15);
    expect(resolveAdaptiveConfig({ errorRateThreshold: 0.25 }).errorRateThreshold).toBe(0.25);
  });

  it("never lets min exceed max", () => {
    const cfg = resolveAdaptiveConfig({ min: 50, max: 4 });
    expect(cfg.min).toBeLessThanOrEqual(cfg.max);
    expect(cfg.min).toBe(4);
  });
});
