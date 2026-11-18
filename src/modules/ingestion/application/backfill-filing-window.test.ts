import { describe, expect, it } from "vitest";
import {
  decodeFilingCheckpoint,
  dedupeFilingRows,
  filingBackfillExitCode,
  filingBackfillStop,
  filingDateInWindow,
  filingFamilyForCourt,
  filingWriteCounts,
  selectBackfillRow,
} from "./backfill-filing-window";
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

  it("counts a match that already has a filing date as already present", () => {
    expect(filingWriteCounts({ incoming: 2309, joined: 2309, inserted: 0, filledDate: 0 })).toEqual({
      inserted: 0, filledDate: 0, alreadyPresent: 2309, noCourt: 0,
    });
  });

  it("does not abandon a run because the scan itself is busy", () => {
    expect(filingBackfillStop({
      allowAnytime: true, elapsedMs: 90 * 60_000, budgetMs: 90 * 60_000, outsideQuietWindow: true, diskOk: true,
    })).toBeNull();
    expect(filingBackfillStop({
      allowAnytime: false, elapsedMs: 1_000, budgetMs: 90 * 60_000, outsideQuietWindow: true, diskOk: true,
    })).toBe("quiet-window");
    expect(filingBackfillStop({
      allowAnytime: true, elapsedMs: 1_000, budgetMs: 90 * 60_000, outsideQuietWindow: false, diskOk: false,
    })).toBe("disk");
    expect(filingBackfillExitCode("pace")).toBe(75);
    expect(filingBackfillExitCode("budget")).toBe(75);
    expect(filingBackfillExitCode("complete")).toBe(0);
    expect(filingBackfillExitCode("quota")).toBe(0);
    expect(filingBackfillExitCode("memory")).toBe(75);
    expect(filingBackfillExitCode("disk")).toBe(1);
    expect(filingBackfillExitCode(null)).toBe(0);
  });

  it("collapses duplicate court and docket keys in one insert batch", () => {
    const today = "2026-11-17";
    const first = selectBackfillRow(docket({
      court_id: "nysd", docket_number: "1:26-cv-00001", case_name: "Short", date_filed: "2026-10-02",
    }), "district", today, 365);
    const richer = selectBackfillRow(docket({
      court_id: "nysd", docket_number: "1:26-cv-00001", case_name: "Short v. Longer Name", date_filed: "2026-09-01",
    }), "district", today, 365);
    const dated = selectBackfillRow(docket({
      court_id: "nysd", docket_number: "1:26-cv-00009", case_name: "Dated v. Party", date_filed: "2026-08-01",
    }), "district", today, 365);
    const other = selectBackfillRow(docket({
      court_id: "cacd", docket_number: "1:26-cv-00001", case_name: "Other v. Party", date_filed: "2026-10-03",
    }), "district", today, 365);
    expect(first && richer && dated && other).toBeTruthy();
    const rows = dedupeFilingRows([
      first!,
      richer!,
      { ...dated!, filedOn: "" },
      dated!,
      other!,
    ]);
    expect(rows.map((row) => [row.courtCode, row.docketNumber, row.caption, row.filedOn])).toEqual([
      ["nysd", "1:26-cv-00001", "Short v. Longer Name", "2026-09-01"],
      ["nysd", "1:26-cv-00009", "Dated v. Party", "2026-08-01"],
      ["cacd", "1:26-cv-00001", "Other v. Party", "2026-10-03"],
    ]);
    expect(rows[0]?.publicId).toBe(first!.publicId);
  });

  it("resumes a finished snapshot instead of reading the file again", () => {
    const stored = JSON.stringify({
      version: 1, snapshotDate: "2026-09-30", family: "appeals", windowDays: 365,
      rowsConsumed: 5_580_000, stopped: "complete",
    });
    expect(decodeFilingCheckpoint(stored, "2026-09-30", "appeals", 365)).toMatchObject({
      rowsConsumed: 5_580_000, stopped: "complete",
    });
    const paused = JSON.stringify({
      version: 1, snapshotDate: "2026-09-30", family: "appeals", windowDays: 365,
      rowsConsumed: 5_580_000, stopped: "pace",
    });
    expect(decodeFilingCheckpoint(paused, "2026-09-30", "appeals", 365).stopped).toBeNull();
  });
});
