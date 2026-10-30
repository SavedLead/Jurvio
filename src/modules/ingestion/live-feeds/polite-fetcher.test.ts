import { describe, expect, it } from "vitest";
import { FetchBudget, RateLimitedError, parseRetryAfter } from "./polite-fetcher";

function harness(statuses: number[], headers: Record<string, string> = {}) {
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? "ok" : "", { status, headers });
  }) as unknown as typeof fetch;
  return {
    calls, sleeps,
    tick: (ms: number) => { clock += ms; },
    budget: (maxRequests = 10, maxMs = 60_000) => new FetchBudget({
      source: "test", maxRequests, maxMs, minIntervalMs: 1_000, fetchImpl,
      now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    }),
  };
}

describe("FetchBudget", () => {
  it("spaces requests by the minimum interval", async () => {
    const h = harness([200, 200]);
    const budget = h.budget();
    await budget.text("https://example.test/a");
    await budget.text("https://example.test/b");
    expect(h.sleeps).toEqual([1_000]);
    expect(budget.requests).toBe(2);
  });

  it("stops at max requests", async () => {
    const h = harness([200, 200, 200]);
    const budget = h.budget(2);
    await budget.get("https://example.test/1");
    await budget.get("https://example.test/2");
    expect(budget.canFetch).toBe(false);
    await expect(budget.get("https://example.test/3")).rejects.toThrow(/budget exhausted/);
    expect(h.calls).toHaveLength(2);
  });

  it("stops at max time", async () => {
    const h = harness([200]);
    const budget = h.budget(10, 5_000);
    h.tick(6_000);
    await expect(budget.get("https://example.test/late")).rejects.toThrow(/max time/);
  });

  it("stops for good on 429 and records Retry-After", async () => {
    const h = harness([429, 200], { "retry-after": "120" });
    const budget = h.budget();
    const error = await budget.get("https://example.test/x").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterUntil?.getTime()).toBe(1_000_000 + 120_000);
    expect(budget.canFetch).toBe(false);
    await expect(budget.get("https://example.test/y")).rejects.toBeInstanceOf(RateLimitedError);
    expect(h.calls).toHaveLength(1);
  });

  it("returns 404 to the caller instead of throwing", async () => {
    const h = harness([404]);
    const response = await h.budget().get("https://example.test/missing");
    expect(response.status).toBe(404);
  });
});

describe("parseRetryAfter", () => {
  it("accepts seconds and HTTP dates", () => {
    expect(parseRetryAfter("30", 0)?.getTime()).toBe(30_000);
    expect(parseRetryAfter("Fri, 30 Oct 2026 12:00:00 GMT", 0)?.toISOString()).toBe("2026-10-30T12:00:00.000Z");
    expect(parseRetryAfter(null, 0)).toBeNull();
    expect(parseRetryAfter("soon", 0)).toBeNull();
  });
});
