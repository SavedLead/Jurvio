import { describe, expect, it } from "vitest";
import { matchesBulkFederalJurisdiction } from "./ingest-courtlistener-bulk-federal-dockets";

describe("matchesBulkFederalJurisdiction", () => {
  it("selects only the requested appellate segment", () => {
    expect(matchesBulkFederalJurisdiction("F", true, "F")).toBe(true);
    expect(matchesBulkFederalJurisdiction("FD", true, "F")).toBe(false);
    expect(matchesBulkFederalJurisdiction("FB", true, "F")).toBe(false);
  });

  it("keeps district and bankruptcy cohorts separate", () => {
    expect(matchesBulkFederalJurisdiction("FD", true, "FD")).toBe(true);
    expect(matchesBulkFederalJurisdiction("F", true, "FD")).toBe(false);
    expect(matchesBulkFederalJurisdiction("FB", true, "FB")).toBe(true);
    expect(matchesBulkFederalJurisdiction("FD", true, "FB")).toBe(false);
  });

  it("preserves the existing unsegmented behavior", () => {
    expect(matchesBulkFederalJurisdiction("F", false)).toBe(true);
    expect(matchesBulkFederalJurisdiction("FD", false)).toBe(true);
    expect(matchesBulkFederalJurisdiction("FB", false)).toBe(false);
    expect(matchesBulkFederalJurisdiction("FB", true)).toBe(true);
  });
});
