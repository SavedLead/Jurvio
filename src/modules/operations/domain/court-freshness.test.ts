import { describe, expect, it } from "vitest";
import {
  classifyFreshness, filterRows, formatAge, formatLag, isFailing, lagHours, sortRows, summarize,
  type CourtFreshnessRow,
} from "./court-freshness";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

function row(overrides: Partial<CourtFreshnessRow>): CourtFreshnessRow {
  return {
    courtCode: "nysd", courtType: "district", name: "Southern District of New York", circuit: "2",
    caseCount: 10, publishedCount: 4, draftCount: 6, withheldCount: 0,
    newestFiledOn: "2026-10-29", newestCaseCreatedAt: null,
    lastBulkAt: null, lastFeedAt: null, lastCourtListenerAt: null,
    feedAvailable: true, feedHealth: "healthy", feedFailures: 0, courtListenerRetryAfter: null,
    refreshedAt: hoursAgo(0.2),
    ...overrides,
  };
}

describe("classifyFreshness", () => {
  it("is never when no source has run", () => {
    expect(classifyFreshness(row({}), NOW)).toBe("never");
  });
  it("is fresh when the live feed succeeded inside the window", () => {
    expect(classifyFreshness(row({ lastFeedAt: hoursAgo(3) }), NOW)).toBe("fresh");
    expect(classifyFreshness(row({ lastCourtListenerAt: hoursAgo(35) }), NOW)).toBe("fresh");
  });
  it("is stale when only a bulk snapshot touched the court, however recent", () => {
    expect(classifyFreshness(row({ lastBulkAt: hoursAgo(1) }), NOW)).toBe("stale");
  });
  it("is stale when the newest live source is older than the window", () => {
    expect(classifyFreshness(row({ lastFeedAt: hoursAgo(40), lastBulkAt: hoursAgo(2) }), NOW)).toBe("stale");
  });
});

describe("lag and formatting", () => {
  it("measures lag from the newest source of any kind", () => {
    expect(lagHours(row({ lastBulkAt: hoursAgo(2), lastFeedAt: hoursAgo(50) }), NOW)).toBeCloseTo(2);
    expect(lagHours(row({}), NOW)).toBeNull();
  });
  it("formats minutes, hours, days and months", () => {
    expect(formatLag(0.25)).toBe("15m");
    expect(formatLag(5)).toBe("5h");
    expect(formatLag(72)).toBe("3d");
    expect(formatLag(24 * 90)).toBe("3mo");
    expect(formatLag(null)).toBe("—");
    expect(formatAge(null, NOW)).toBe("never");
    expect(formatAge(hoursAgo(5), NOW)).toBe("5h ago");
  });
  it("flags failing feeds", () => {
    expect(isFailing(row({ feedFailures: 3 }))).toBe(true);
    expect(isFailing(row({ feedHealth: "degraded" }))).toBe(true);
    expect(isFailing(row({ feedFailures: 1 }))).toBe(false);
  });
});

describe("sorting and filtering", () => {
  const rows = [
    row({ courtCode: "nysd", caseCount: 50, lastFeedAt: hoursAgo(1) }),
    row({ courtCode: "ca11", courtType: "appellate", name: "Eleventh Circuit", caseCount: 5, lastBulkAt: hoursAgo(100) }),
    row({ courtCode: "ca2", courtType: "appellate", name: "Second Circuit", caseCount: 20 }),
    row({ courtCode: "scotus", courtType: "supreme", name: "Supreme Court", caseCount: 9, lastFeedAt: hoursAgo(2) }),
  ];
  it("groups by court type with circuit-number order by default", () => {
    expect(sortRows(rows, "court", "asc", NOW).map((r) => r.courtCode)).toEqual(["scotus", "ca2", "ca11", "nysd"]);
  });
  it("sorts by a metric and keeps never-updated courts last in both directions", () => {
    expect(sortRows(rows, "cases", "desc", NOW).map((r) => r.courtCode)).toEqual(["nysd", "ca2", "scotus", "ca11"]);
    expect(sortRows(rows, "lag", "asc", NOW).map((r) => r.courtCode)).toEqual(["nysd", "scotus", "ca11", "ca2"]);
    expect(sortRows(rows, "lag", "desc", NOW).at(-1)?.courtCode).toBe("ca2");
  });
  it("filters by type, status and search text", () => {
    expect(filterRows(rows, { courtType: "appellate", status: "all", query: "" }, NOW).map((r) => r.courtCode)).toEqual(["ca11", "ca2"]);
    expect(filterRows(rows, { courtType: "all", status: "fresh", query: "" }, NOW).map((r) => r.courtCode)).toEqual(["nysd", "scotus"]);
    expect(filterRows(rows, { courtType: "all", status: "all", query: "eleventh" }, NOW).map((r) => r.courtCode)).toEqual(["ca11"]);
  });
  it("summarizes totals", () => {
    const summary = summarize(rows, NOW);
    expect(summary).toMatchObject({ courts: 4, fresh: 2, stale: 1, never: 1, cases: 84, published: 16, draft: 24 });
  });
});
