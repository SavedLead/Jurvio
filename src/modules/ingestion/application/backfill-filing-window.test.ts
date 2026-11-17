import { describe, expect, it } from "vitest";
import { filingDateInWindow, filingFamilyForCourt, selectBackfillRow } from "./backfill-filing-window";
import type { CourtListenerBulkDocket } from "../providers/courtlistener/bulk-dockets";

function docket(overrides: Partial<CourtListenerBulkDocket> = {}): CourtListenerBulkDocket {
  return {
    id: "10",
    court_id: "ca9",
    docket_number: "24-1234",
    case_name: "Alpha v. Beta",
    date_filed: "2026-10-01",
    cause: "",
    nature_of_suit: "",
    jury_demand: "",
    assigned_to_str: "",
    referred_to_str: "",
    date_modified: "2026-10-02T00:00:00Z",
    ...overrides,
  };
}

describe("filing window selection", () => {
  it("keeps appeals circuits and district courts, and leaves bankruptcy and the Supreme Court out", () => {
    expect(filingFamilyForCourt("ca9")).toBe("appeals");
    expect(filingFamilyForCourt("nysd")).toBe("district");
    expect(filingFamilyForCourt("nysb")).toBeNull();
    expect(filingFamilyForCourt("scotus")).toBeNull();
  });

  it("keeps a filing date inside the window and drops today", () => {
    expect(filingDateInWindow("2026-10-20", "2026-11-17", 30)).toBe(true);
    expect(filingDateInWindow("2026-10-01", "2026-11-17", 30)).toBe(false);
    expect(filingDateInWindow("2026-11-17", "2026-11-17", 30)).toBe(false);
  });

  it("selects an appeals case and drops a sealed caption", () => {
    expect(selectBackfillRow(docket(), "appeals", "2026-11-17", 90)?.courtCode).toBe("ca9");
    expect(selectBackfillRow(docket(), "district", "2026-11-17", 90)).toBeNull();
    expect(selectBackfillRow(docket({ case_name: "Sealed v. Minor" }), "appeals", "2026-11-17", 90)).toBeNull();
  });
});
