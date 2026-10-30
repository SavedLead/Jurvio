import { describe, expect, it } from "vitest";
import {
  bulkClusterWithinMinYear,
  bulkClusterWithinYearRange,
} from "./ingest-courtlistener-bulk-appellate-opinions";

// bulkClusterWithinMinYear is the single in-range rule shared by the Pass A0 docket
// pre-scan and the Pass B cluster-persist step. If the two ever decided "in range"
// differently, the Pass A0 memory optimization would stop being behavior-preserving
// (a docket could be dropped that Pass B still wants, or vice versa), so this rule is
// worth pinning down on its own.
describe("bulkClusterWithinMinYear", () => {
  it("keeps clusters filed in or after minYear", () => {
    expect(bulkClusterWithinMinYear("1900-01-01", 1900)).toBe(true);
    expect(bulkClusterWithinMinYear("2026-09-30", 1900)).toBe(true);
    expect(bulkClusterWithinMinYear("1950-06-15", 1950)).toBe(true);
  });

  it("drops clusters filed strictly before minYear", () => {
    expect(bulkClusterWithinMinYear("1899-12-31", 1900)).toBe(false);
    expect(bulkClusterWithinMinYear("1799-01-01", 1900)).toBe(false);
    expect(bulkClusterWithinMinYear("1949-12-31", 1950)).toBe(false);
  });

  it("keeps clusters with no filing date (nothing to exclude on)", () => {
    expect(bulkClusterWithinMinYear(null, 1900)).toBe(true);
    expect(bulkClusterWithinMinYear(null, 2000)).toBe(true);
  });

  it("keeps clusters whose date does not start with a parseable year", () => {
    // Matches the loader's prior behavior: an unparseable leading year is NaN, and
    // `NaN < minYear` is false, so such rows were never excluded.
    expect(bulkClusterWithinMinYear("not-a-date", 1900)).toBe(true);
    expect(bulkClusterWithinMinYear("", 1900)).toBe(true);
  });
});

// bulkClusterWithinYearRange adds the inclusive upper bound used to slice the federal
// corpus into year-window runs. Both Pass A0 and Pass B call it with the same bounds,
// so a docket is retained iff a cluster in the window references it.
describe("bulkClusterWithinYearRange", () => {
  it("keeps clusters within [minYear, maxYear] inclusive", () => {
    expect(bulkClusterWithinYearRange("1950-01-01", 1950, 1969)).toBe(true);
    expect(bulkClusterWithinYearRange("1969-12-31", 1950, 1969)).toBe(true);
    expect(bulkClusterWithinYearRange("1960-06-15", 1950, 1969)).toBe(true);
  });

  it("drops clusters below minYear or above maxYear", () => {
    expect(bulkClusterWithinYearRange("1949-12-31", 1950, 1969)).toBe(false);
    expect(bulkClusterWithinYearRange("1970-01-01", 1950, 1969)).toBe(false);
    expect(bulkClusterWithinYearRange("2026-01-01", 1950, 1969)).toBe(false);
  });

  it("keeps undated / unparseable clusters so no window silently drops them", () => {
    expect(bulkClusterWithinYearRange(null, 1950, 1969)).toBe(true);
    expect(bulkClusterWithinYearRange("not-a-date", 1950, 1969)).toBe(true);
  });

  it("is consistent with bulkClusterWithinMinYear when there is no upper bound", () => {
    for (const d of ["1899-01-01", "1900-01-01", "2026-09-30", null, "junk"]) {
      expect(bulkClusterWithinYearRange(d, 1900, Number.MAX_SAFE_INTEGER)).toBe(
        bulkClusterWithinMinYear(d, 1900),
      );
    }
  });
});
