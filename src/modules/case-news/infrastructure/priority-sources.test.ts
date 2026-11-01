import { describe, expect, it } from "vitest";
import { FetchBudget, RateLimitedError } from "@/modules/ingestion/live-feeds/polite-fetcher";
import { caseNewsTerms } from "../domain/case-terms";
import { buildPriorityQuery, buildPriorityQueryCore, isTransientNetworkError, searchGdelt } from "./gdelt";

const terms = (caption: string, docketNumber: string, courtCode = "scotus", courtName = "scotus") =>
  caseNewsTerms({ caption, docketNumber, courtCode, courtName });

describe("priority (SCOTUS / appeals) queries", () => {
  it("searches 'X v. United States' by the distinctive party plus Supreme Court", () => {
    expect(buildPriorityQuery(terms("Barrett v. United States", "24-5774"), "24-5774")).toEqual({ query: 'Barrett "Supreme Court" sourcelang:english', kind: "parties" });
    expect(buildPriorityQueryCore(terms("Ellingburg v. United States", "24-482"), "24-482")?.query).toBe('Ellingburg "Supreme Court"');
  });
  it("drops State of X, the Commissioner and et al.", () => {
    expect(buildPriorityQueryCore(terms("STATE OF TEXAS v. Ordaz-Cortes, et al.", "25-10"), "25-10")?.query).toBe('"Ordaz-Cortes" "Supreme Court"');
    expect(buildPriorityQueryCore(terms("Zuch v. Commissioner of Internal Revenue", "24-1287", "ca3", "Third Circuit"), "24-1287")?.query)
      .toBe('Zuch ("Third Circuit" OR "3rd Circuit")');
  });
  it("uses the circuit name for appeals and both weak names when they are all there is", () => {
    expect(buildPriorityQueryCore(terms("Trump v. Cook", "25-A312"), "25-A312")?.query).toBe('Trump Cook "Supreme Court"');
    expect(buildPriorityQueryCore(terms("Uber Technologies, Inc. v. City of Seattle", "25-228", "ca9", "Ninth Circuit"), "25-228")?.query)
      .toBe('Uber ("Ninth Circuit" OR "9th Circuit")');
  });
  it("falls back to the docket number with the court when no party is usable", () => {
    expect(buildPriorityQuery(terms("Smith v. United States", "25-5123"), "25-5123")).toEqual({ query: '"25-5123" "Supreme Court" sourcelang:english', kind: "docket" });
  });
});

describe("transient GDELT failures back off like rate limiting", () => {
  it("classifies fetch failed and timeouts", () => {
    expect(isTransientNetworkError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientNetworkError(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toBe(true);
    expect(isTransientNetworkError(new Error("returned HTTP 500"))).toBe(false);
  });
  it("turns fetch failed into RateLimitedError and stops the budget", async () => {
    const budget = new FetchBudget({ source: "gdelt", maxRequests: 5, maxMs: 60_000, minIntervalMs: 0, fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    await expect(searchGdelt(budget, "x")).rejects.toBeInstanceOf(RateLimitedError);
    expect(budget.canFetch).toBe(false);
  });
});
