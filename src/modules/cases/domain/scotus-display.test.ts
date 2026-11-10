import { describe, expect, it } from "vitest";
import { extractOfficialCitation, formatPublicCaseDate, formatVerifiedOutcome, humanizeVerifiedValue, visibleCaseStatusDetails } from "./scotus-display";

describe("SCOTUS public display policy", () => {
  it("suppresses generic and unsupported status values", () => {
    for (const value of ["active", "filing", "none", "unknown", "unavailable", "not_applicable"]) {
      expect(humanizeVerifiedValue(value)).toBeNull();
    }
  });

  it("renders only meaningful verified outcome fields", () => {
    expect(visibleCaseStatusDetails({
      dispositionScope: "reversed_and_remanded",
      judgmentState: "none",
      appealState: "unavailable",
    })).toEqual([["Disposition", "Reversed And Remanded"]]);
  });

  it("formats verified outcomes without title-casing conjunctions", () => {
    expect(formatVerifiedOutcome("reversed_and_remanded")).toBe("Reversed and remanded");
    expect(formatVerifiedOutcome("unknown")).toBeNull();
  });

  it("formats verified ISO dates for public display", () => {
    expect(formatPublicCaseDate("2025-11-24")).toBe("Nov. 24, 2025");
    expect(formatPublicCaseDate("2026-11-10", "America/Los_Angeles")).toBe("Nov. 10, 2026");
    expect(formatPublicCaseDate("2026-11-10T04:48:00.000Z", "America/Los_Angeles")).toBe("Nov. 9, 2026");
    expect(formatPublicCaseDate("2026-11-10T00:00:00.000Z", "America/New_York")).toBe("Nov. 9, 2026");
    expect(formatPublicCaseDate(null)).toBeNull();
    expect(formatPublicCaseDate("not-a-date")).toBeNull();
  });

  it("extracts a supported United States Reports citation from court text", () => {
    expect(extractOfficialCitation("Cite as: 607 U. S. 1 (2025)")).toBe("607 U. S. 1 (2025)");
    expect(extractOfficialCitation("No official citation here")).toBeNull();
  });
});
