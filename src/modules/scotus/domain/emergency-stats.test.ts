import { describe, expect, it } from "vitest";
import {
  buildStatRows, daysToRuling, lowerCourtGroup, parseDashboardFilters, rate, summarize, termOfDocket, type StatSourceRow,
} from "./emergency-stats";

function app(overrides: Partial<StatSourceRow>): StatSourceRow {
  return {
    docketNumber: "24A1", kind: "stay", status: "denied", applicantKind: "private", administration: "Biden",
    lowerCourt: "United States Court of Appeals for the Ninth Circuit", submittedJustice: "Kagan", submittedOn: "2024-07-01",
    referredOn: null, ruledBy: "justice", rulingOn: "2024-07-03", responseRequested: false, adminStayOn: null, writtenReasons: false,
    notedVotes: [], ...overrides,
  };
}

describe("lowerCourtGroup", () => {
  it("maps courts of appeals, district courts (by state), state courts and others", () => {
    expect(lowerCourtGroup("United States Court of Appeals for the Fifth Circuit")).toBe("ca5");
    expect(lowerCourtGroup("United States Court of Appeals for the District of Columbia Circuit")).toBe("cadc");
    expect(lowerCourtGroup("United States District Court for the Northern District of California")).toBe("ca9");
    expect(lowerCourtGroup("United States District Court for the District of Columbia")).toBe("cadc");
    expect(lowerCourtGroup("United States District Court for the District of Maryland")).toBe("ca4");
    expect(lowerCourtGroup("Supreme Court of Texas")).toBe("state");
    expect(lowerCourtGroup("Court of Criminal Appeals of Alabama")).toBe("state");
    expect(lowerCourtGroup("United States Court of Appeals for the Armed Forces")).toBe("federal_other");
    expect(lowerCourtGroup(null)).toBe("unknown");
  });
});

describe("termOfDocket / daysToRuling", () => {
  it("reads the docket year and caps days", () => {
    expect(termOfDocket("17A1300")).toBe(2017);
    expect(termOfDocket("24-123")).toBeNull();
    expect(daysToRuling({ status: "denied", submittedOn: "2024-01-01", rulingOn: "2024-01-01" })).toBe(0);
    expect(daysToRuling({ status: "granted", submittedOn: "2024-01-01", rulingOn: "2024-06-01" })).toBe(61);
    expect(daysToRuling({ status: "withdrawn", submittedOn: "2024-01-01", rulingOn: "2024-01-05" })).toBeNull();
    expect(daysToRuling({ status: "denied", submittedOn: "2024-01-05", rulingOn: "2024-01-01" })).toBeNull();
  });
});

describe("buildStatRows + summarize", () => {
  const rows: StatSourceRow[] = [
    app({ docketNumber: "24A1", applicantKind: "federal", status: "granted", referredOn: "2024-07-02", ruledBy: "court", rulingOn: "2024-07-10",
      notedVotes: [{ justiceRef: "Sotomayor", position: "dissent", sentence: "" }, { justiceRef: "Kagan", position: "would_deny", sentence: "" }] }),
    app({ docketNumber: "24A2", applicantKind: "federal", status: "granted_in_part", responseRequested: true }),
    app({ docketNumber: "24A3" }),
    app({ docketNumber: "24A4" }),
    app({ docketNumber: "23A9", status: "pending", rulingOn: null, notedVotes: [{ justiceRef: "Sotomayor", position: "dissent", sentence: "" }] }),
    app({ docketNumber: "24A5", kind: "extension", status: "granted" }),
    app({ docketNumber: "24A6", lowerCourt: "Supreme Court of Ohio", status: "withdrawn", rulingOn: "2024-07-02" }),
  ];
  const { stats, votes } = buildStatRows(rows);

  it("collapses identical applications into one count row", () => {
    expect(stats.reduce((sum, row) => sum + row.applications, 0)).toBe(rows.length);
    expect(stats.find((row) => row.applications === 2)?.outcome).toBe("denied");
    expect(votes.map((row) => `${row.term}:${row.voter}:${row.position}`).sort()).toEqual(["2023:Sotomayor:dissent", "2024:Kagan:would_deny", "2024:Sotomayor:dissent"]);
  });

  it("sums totals without extensions by default", () => {
    const dashboard = summarize(stats, votes, { term: null, applicant: null, circuit: null, extensions: false });
    expect(dashboard.totals.applications).toBe(6);
    expect(dashboard.totals.decided).toBe(4);
    expect(dashboard.totals.granted).toBe(1);
    expect(dashboard.totals.grantedInPart).toBe(1);
    expect(dashboard.totals.pending).toBe(1);
    expect(dashboard.totals.closedOther).toBe(1);
    expect(dashboard.totals.referred).toBe(1);
    expect(dashboard.totals.grantedReferred).toBe(1);
    expect(dashboard.totals.responseRequested).toBe(1);
    expect(dashboard.totals.withVotes).toBe(2);
    expect(dashboard.totals.medianDays).toBe(2);
    expect(dashboard.byTerm.map((row) => [row.term, row.applications])).toEqual([[2023, 1], [2024, 5]]);
    expect(dashboard.byApplicant.map((cell) => [cell.key, cell.granted, cell.decided])).toEqual([["federal", 2, 2], ["private", 0, 2]]);
    expect(dashboard.votes.leaderboard[0]).toMatchObject({ voter: "Sotomayor", total: 2 });
    expect(dashboard.days.bins.find((bin) => bin.label === "2–3")?.justice).toBe(3);
    expect(dashboard.days.medianCourt).toBe(9);
  });

  it("applies filters but keeps the by-year chart and heatmap across years", () => {
    const dashboard = summarize(stats, votes, { term: 2024, applicant: "federal", circuit: "ca9", extensions: true });
    expect(dashboard.totals.applications).toBe(2);
    expect(dashboard.byTerm.map((row) => row.term)).toEqual([2024]);
    expect(dashboard.byApplicant.length).toBeGreaterThan(1);
    const all = summarize(stats, votes, { term: 2024, applicant: null, circuit: null, extensions: false });
    expect(all.byTerm.map((row) => row.term)).toEqual([2023, 2024]);
    expect(all.votes.heatmap.cells.Sotomayor).toEqual({ 2023: 1, 2024: 1 });
    expect(all.votes.leaderboard.find((row) => row.voter === "Sotomayor")?.total).toBe(1);
  });
});

describe("rate / parseDashboardFilters", () => {
  it("withholds rates below the minimum sample", () => {
    expect(rate(2, 4)).toBeNull();
    expect(rate(1, 5)).toBe(20);
  });
  it("accepts only known values", () => {
    expect(parseDashboardFilters({ term: "2024", applicant: "federal", circuit: "ca9", extensions: "1" }, [2023, 2024]))
      .toEqual({ term: 2024, applicant: "federal", circuit: "ca9", extensions: true });
    expect(parseDashboardFilters({ term: "1999", applicant: "x", circuit: "<script>", extensions: "yes" }, [2024]))
      .toEqual({ term: null, applicant: null, circuit: null, extensions: false });
  });
});
