import { describe, expect, it } from "vitest";
import {
  ACTIVE_CASE_EXIT_MARGIN_MS,
  activeCaseBudget,
  activeCaseStopReason,
  DEFAULT_ACTIVE_CASE_BUDGET_MS,
} from "./active-case-budget";
import { SCHEDULED_JOBS } from "../../../../scripts/scheduler-jobs";

const minute = 60_000;

describe("federal-active-cases budget", () => {
  it("stops pulling with time left for in-flight dockets and cuts requests before the SIGTERM", () => {
    const budget = activeCaseBudget({ startedAtMs: 0, budgetMs: 20 * minute });
    expect(budget.stopPullingAtMs).toBe(16 * minute);
    expect(budget.requestDeadlineMs).toBe(20 * minute - ACTIVE_CASE_EXIT_MARGIN_MS);
    expect(budget.stopPullingAtMs).toBeLessThan(budget.requestDeadlineMs);
    expect(budget.requestDeadlineMs).toBeLessThan(20 * minute);
  });

  it("matches the scheduler's budget for the lane", () => {
    const job = SCHEDULED_JOBS.find((entry) => entry.name === "federal-active-cases");
    expect(job?.budgetMs).toBe(DEFAULT_ACTIVE_CASE_BUDGET_MS);
    expect(job?.command).toContain("--loop=active-case-updates");
  });

  it("falls back to the default budget and handles tiny budgets", () => {
    expect(activeCaseBudget({ startedAtMs: 0, budgetMs: null }).budgetMs).toBe(DEFAULT_ACTIVE_CASE_BUDGET_MS);
    const tiny = activeCaseBudget({ startedAtMs: 1_000, budgetMs: 30_000 });
    expect(tiny.stopPullingAtMs).toBeGreaterThan(1_000);
    expect(tiny.stopPullingAtMs).toBeLessThanOrEqual(tiny.requestDeadlineMs);
    expect(tiny.requestDeadlineMs).toBeLessThan(31_000);
  });

  it("treats rate limits and deadlines as run stops, not docket failures", () => {
    expect(activeCaseStopReason(Object.assign(new Error("x"), { name: "CourtListenerRateLimited" }))).toBe("rate_limited");
    expect(activeCaseStopReason(Object.assign(new Error("x"), { name: "CourtListenerDeadlineReached" }))).toBe("budget");
    expect(activeCaseStopReason(new Error("CourtListener request failed: 404 Not Found"))).toBeNull();
    expect(activeCaseStopReason(null)).toBeNull();
  });
});
