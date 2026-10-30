import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { courtSourceFromRow, type DirectRegistryRow } from "../application/direct-court-rotation";
import { parseCmecfRss } from "../providers/courts/cmecf-rss";

// Real CM/ECF public RSS from two courts enabled by migration 0140, fetched
// 2026-10-30 (trimmed to the first items).
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "latin1");
const migration = readFileSync(join(process.cwd(), "db/migrations/0140_district_rss_cohort_all.sql"), "utf8");

function row(code: string, overrides: Partial<DirectRegistryRow> = {}): DirectRegistryRow {
  return {
    court_code: code, court_name: `District ${code}`, jurvio_court_code: code, court_type: "district", circuit: "09",
    official_website: null, cmecf_base_url: `https://ecf.${code}.uscourts.gov`,
    rss_url: `https://ecf.${code}.uscourts.gov/cgi-bin/rss_outside.pl`, rss_coverage_hours: null,
    included_event_categories: [], pacer_court_id: code, time_zone: "UTC", polling_minutes: 5, ...overrides,
  };
}

describe("district RSS cohort", () => {
  it("builds a feed source from a registry row, keeping checked-in entries as they are", () => {
    const akd = courtSourceFromRow(row("akd"));
    expect(akd).toMatchObject({ officialCourtCode: "akd", circuit: "9", rssAvailable: true, rssCoverageWindowHours: 24,
      includedEventCategories: ["all"], rssUrl: "https://ecf.akd.uscourts.gov/cgi-bin/rss_outside.pl" });
    expect(courtSourceFromRow(row("nysd")).name).toBe("United States District Court for the Southern District of New York");
  });

  it("parses real feeds from newly enabled courts", () => {
    const akd = parseCmecfRss(fixture("akd-cmecf.rss.xml"), courtSourceFromRow(row("akd")));
    expect(akd.length).toBeGreaterThan(15);
    expect(akd[0]).toMatchObject({ courtCode: "akd", docketNumber: "3:24-cv-00134" });
    expect(akd.every((event) => /^[a-f0-9]{64}$/.test(event.deduplicationKey))).toBe(true);
    const gud = parseCmecfRss(fixture("gud-cmecf.rss.xml"), courtSourceFromRow(row("gud")));
    expect(gud.length).toBeGreaterThan(0);
  });

  it("enables only courts whose feed answered with XML, and not the empty ones", () => {
    const enabled = [...migration.matchAll(/'([a-z]+)'/g)].map((match) => match[1]).filter((code) => /^[a-z]{2,5}$/.test(code!) && code !== "district");
    expect(enabled).toContain("akd");
    expect(enabled).toContain("txsd");
    for (const empty of ["alnd", "flnd", "gand", "mdd", "nyed", "vaed"]) expect(enabled).not.toContain(empty);
    expect(new Set(enabled).size).toBe(67);
  });
});
