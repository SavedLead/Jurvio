import { describe, expect, it } from "vitest";
import { canOfferCaseAlerts, determineCaseAlertCoverage } from "./case-alert-coverage";

describe("case alert coverage policy", () => {
  it("offers only verified event types for a direct official SCOTUS docket", () => {
    const coverage = determineCaseAlertCoverage({
      courtName: "Supreme Court of the United States",
      officialDocketUrl: "https://www.supremecourt.gov/docket/docketfiles/html/public/24-1.html",
      sourceHealth: "healthy",
      lastCheckedAt: "2026-08-03T02:00:00Z",
    });

    expect(canOfferCaseAlerts(coverage)).toBe(true);
    expect(coverage.state).toBe("available");
    expect(coverage.eventTypes).toContain("order");
    expect(coverage.eventTypes).toContain("opinion");
    expect(coverage.sources[0]?.isDirect).toBe(true);
  });

  it("does not infer alertability from the existence of a published case", () => {
    const coverage = determineCaseAlertCoverage({
      courtName: "United States District Court",
      officialDocketUrl: null,
    });

    expect(canOfferCaseAlerts(coverage)).toBe(false);
    expect(coverage.eventTypes).toEqual([]);
  });

  it("rejects secondary or unverified URLs as direct official monitoring", () => {
    const coverage = determineCaseAlertCoverage({
      courtName: "Supreme Court of the United States",
      officialDocketUrl: "https://www.courtlistener.com/docket/123/example/",
    });

    expect(canOfferCaseAlerts(coverage)).toBe(false);
  });

  it("withdraws the offer when the official source is stale", () => {
    const coverage = determineCaseAlertCoverage({
      courtName: "Supreme Court of the United States",
      officialDocketUrl: "https://www.supremecourt.gov/docket/docketfiles/html/public/24-1.html",
      sourceHealth: "stale",
    });

    expect(canOfferCaseAlerts(coverage)).toBe(false);
    expect(coverage.disclosure).toContain("stale");
  });
});
