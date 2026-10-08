import { describe, expect, it } from "vitest";
import { bulkClusterWithinMinYear } from "./ingest-courtlistener-bulk-appellate-opinions";

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
