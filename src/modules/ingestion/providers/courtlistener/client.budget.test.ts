import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CourtListenerDeadlineReached,
  CourtListenerRateLimited,
  fetchDocket,
  parseRetryAfterMs,
  setCourtListenerRequestPolicy,
} from "./client";

function response(status: number, headers: Record<string, string> = {}, body = "{}"): Response {
  return new Response(status === 204 ? null : body, { status, headers });
}

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgresql://jurvio:jurvio@localhost:5432/jurvio";
  process.env.INGESTION_USER_AGENT ??= "Jurvio-Test/0.1";
});

afterEach(() => {
  setCourtListenerRequestPolicy({});
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("parseRetryAfterMs", () => {
  it("reads delta-seconds and HTTP dates", () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
    expect(parseRetryAfterMs("0")).toBe(0);
    const now = Date.parse("2026-10-29T12:00:00Z");
    expect(parseRetryAfterMs("Thu, 29 Oct 2026 12:02:00 GMT", now)).toBe(120_000);
  });

  it("returns null for missing or invalid values", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs("soon")).toBeNull();
    expect(parseRetryAfterMs("-5")).toBeNull();
  });
});

describe("budgeted CourtListener requests", () => {
  it("stops the run on a 429 instead of sleeping when stopOnRateLimit is set", async () => {
    const fetchMock = vi.fn(async () => response(429, { "retry-after": "600" }));
    vi.stubGlobal("fetch", fetchMock);
    setCourtListenerRequestPolicy({ stopOnRateLimit: true, deadlineMs: Date.now() + 60_000 });
    const started = Date.now();
    const error = await fetchDocket(1).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CourtListenerRateLimited);
    expect((error as CourtListenerRateLimited).retryAfterMs).toBe(600_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("never sleeps a Retry-After that runs past the deadline", async () => {
    const fetchMock = vi.fn(async () => response(429, { "retry-after": "30" }));
    vi.stubGlobal("fetch", fetchMock);
    setCourtListenerRequestPolicy({ deadlineMs: Date.now() + 5_000 });
    const started = Date.now();
    await expect(fetchDocket(1)).rejects.toBeInstanceOf(CourtListenerRateLimited);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("does not start a request once the deadline has passed", async () => {
    const fetchMock = vi.fn(async () => response(200));
    vi.stubGlobal("fetch", fetchMock);
    setCourtListenerRequestPolicy({ deadlineMs: Date.now() - 1 });
    await expect(fetchDocket(1)).rejects.toBeInstanceOf(CourtListenerDeadlineReached);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not wait out a 5xx backoff that would cross the deadline", async () => {
    const fetchMock = vi.fn(async () => response(503));
    vi.stubGlobal("fetch", fetchMock);
    setCourtListenerRequestPolicy({ deadlineMs: Date.now() + 500 });
    await expect(fetchDocket(1)).rejects.toBeInstanceOf(CourtListenerDeadlineReached);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the default behavior when no policy is set (retries a short Retry-After)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429, { "retry-after": "0.01" }))
      .mockResolvedValueOnce(response(500))
      .mockResolvedValue(response(404));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const pending = fetchDocket(1).catch((caught: unknown) => caught);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(String(error)).toContain("CourtListener request failed: 404");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
