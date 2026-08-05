import { describe, expect, it } from "vitest";
import { resolveAdaptiveConfig, type OutcomeSignal } from "../domain/adaptive-concurrency";
import { classifyFailureSignal, runAdaptiveWorkerPool } from "./adaptive-worker-pool";

describe("runAdaptiveWorkerPool", () => {
  it("processes every item exactly once and drains", async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    let cursor = 0;
    const seen: number[] = [];
    const result = await runAdaptiveWorkerPool<number>({
      config: resolveAdaptiveConfig({ start: 4, max: 4 }),
      pull: async () => (cursor < items.length ? items[cursor++] : undefined),
      handle: async (item) => {
        seen.push(item);
        return { ok: true } satisfies OutcomeSignal;
      },
    });
    expect(result.processed).toBe(50);
    expect(seen.slice().sort((a, b) => a - b)).toEqual(items);
  });

  it("never runs more than the current concurrency in flight", async () => {
    const items = Array.from({ length: 40 }, (_, i) => i);
    let cursor = 0;
    let inFlight = 0;
    let peak = 0;
    await runAdaptiveWorkerPool<number>({
      config: resolveAdaptiveConfig({ start: 5, max: 5 }),
      pull: async () => (cursor < items.length ? items[cursor++] : undefined),
      handle: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return { ok: true };
      },
    });
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1); // actually ran concurrently
  });

  it("shrinks in flight after distress reduces concurrency", async () => {
    // A steady stream of DB-pressure signals should drive concurrency (and thus the
    // observed in-flight peak in the tail) down toward the floor.
    const total = 200;
    let cursor = 0;
    let inFlight = 0;
    const tailPeaks: number[] = [];
    await runAdaptiveWorkerPool<number>({
      config: resolveAdaptiveConfig({ start: 16, max: 16 }),
      pull: async () => (cursor < total ? cursor++ : undefined),
      handle: async () => {
        inFlight += 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (cursor > total - 20) tailPeaks.push(inFlight);
        inFlight -= 1;
        return { ok: true, dbPressure: true };
      },
    });
    // By the tail, sustained halving has floored concurrency at 1.
    expect(Math.max(...tailPeaks)).toBeLessThanOrEqual(2);
  });

  it("treats a thrown handler as a failure without aborting the cycle", async () => {
    const items = [1, 2, 3, 4, 5];
    let cursor = 0;
    let completed = 0;
    const result = await runAdaptiveWorkerPool<number>({
      config: resolveAdaptiveConfig({ start: 2, max: 2 }),
      pull: async () => (cursor < items.length ? items[cursor++] : undefined),
      handle: async (item) => {
        completed += 1;
        if (item === 3) throw new Error("boom");
        return { ok: true };
      },
    });
    expect(completed).toBe(5);
    expect(result.processed).toBe(5);
  });

  it("propagates a pull error (fatal source failure aborts the cycle)", async () => {
    await expect(
      runAdaptiveWorkerPool<number>({
        config: resolveAdaptiveConfig(),
        pull: async () => {
          throw new Error("source unreachable");
        },
        handle: async () => ({ ok: true }),
      }),
    ).rejects.toThrow(/source unreachable/);
  });
});

describe("classifyFailureSignal", () => {
  it("flags CourtListener 429 responses as throttled", () => {
    expect(classifyFailureSignal(new Error("CourtListener request failed: 429 Too Many Requests")))
      .toEqual({ throttled: true, dbPressure: false });
  });

  it("flags generic rate-limit language as throttled", () => {
    expect(classifyFailureSignal(new Error("Upstream rate limit exceeded")).throttled).toBe(true);
  });

  it("flags Postgres connection/capacity errors as DB pressure", () => {
    expect(classifyFailureSignal(new Error("sorry, too many clients already")).dbPressure).toBe(
      true,
    );
    const coded = Object.assign(new Error("connection failure"), { code: "53300" });
    expect(classifyFailureSignal(coded).dbPressure).toBe(true);
    const timeout = Object.assign(new Error("write CONNECT_TIMEOUT"), { code: "CONNECT_TIMEOUT" });
    expect(classifyFailureSignal(timeout).dbPressure).toBe(true);
  });

  it("flags deadlocks and statement timeouts as DB pressure", () => {
    expect(classifyFailureSignal(new Error("deadlock detected")).dbPressure).toBe(true);
    expect(
      classifyFailureSignal(new Error("canceling statement due to statement timeout")).dbPressure,
    ).toBe(true);
  });

  it("leaves an ordinary parse/validation error unclassified", () => {
    expect(classifyFailureSignal(new Error("Invalid docket payload"))).toEqual({
      throttled: false,
      dbPressure: false,
    });
  });
});
