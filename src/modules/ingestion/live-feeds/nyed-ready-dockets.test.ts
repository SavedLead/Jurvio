import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { courtSourceFromRow, type DirectRegistryRow } from "../application/direct-court-rotation";
import { shouldCreateCase } from "../domain/direct-court";
import { parseCmecfRss } from "../providers/courts/cmecf-rss";

// Real EDNY readyDockets.pl feed fetched 2026-10-31 23:50 ET (first 14 items),
// plus two sealed entries in the shape EDNY lists them ("[1 - Sealed Document]").
const xml = readFileSync(join(__dirname, "fixtures", "nyed-ready-dockets.rss.xml"), "latin1");
const migration = readFileSync(join(process.cwd(), "db/migrations/0144_nyed_ready_dockets_feed.sql"), "utf8");

const row: DirectRegistryRow = {
  court_code: "nyed", court_name: "United States District Court for the Eastern District of New York", jurvio_court_code: "nyed",
  court_type: "district", circuit: "02", official_website: "https://www.nyed.uscourts.gov", cmecf_base_url: "https://ecf.nyed.uscourts.gov",
  rss_url: "https://ecf.nyed.uscourts.gov/cgi-bin/readyDockets.pl", rss_coverage_hours: 24, included_event_categories: ["all"],
  pacer_court_id: "nyed", time_zone: "America/New_York", polling_minutes: 5,
};

describe("EDNY readyDockets.pl feed", () => {
  const court = courtSourceFromRow(row);
  const events = parseCmecfRss(xml, court);

  it("points the nyed registry row at readyDockets.pl and turns it on", () => {
    expect(court.rssUrl).toBe("https://ecf.nyed.uscourts.gov/cgi-bin/readyDockets.pl");
    expect(migration).toMatch(/rss_url = 'https:\/\/ecf\.nyed\.uscourts\.gov\/cgi-bin\/readyDockets\.pl'/);
    expect(migration).toMatch(/rss_available = true/);
    expect(migration).toMatch(/WHERE court_code = 'nyed'/);
  });

  it("parses every entry with docket, clean caption and document number", () => {
    expect(events).toHaveLength(16);
    expect(events[0]).toMatchObject({
      courtCode: "nyed", docketNumber: "1:26-cv-05320", caption: "DeRoche et al v. Carrington Mortgage Services, LLC", restricted: false,
    });
    const complaint = events.find((event) => event.docketNumber === "1:26-cv-07031");
    expect(complaint).toMatchObject({ documentNumber: "1", caption: "Sager v. Commissioner of Social Security Administration" });
    expect(events.find((event) => event.docketNumber === "1:25-cv-04796")?.documentNumber).toBe("25");
  });

  it("does not collapse several entries of one case that share the case-level guid", () => {
    // DktRpt.pl?548796 is the guid of three different entries in the sample.
    const sameCase = events.filter((event) => event.sourceUrl.endsWith("DktRpt.pl?548796"));
    expect(sameCase.length).toBe(3);
    expect(new Set(sameCase.map((event) => event.deduplicationKey)).size).toBe(3);
    expect(sameCase.every((event) => event.officialEventId === null)).toBe(true);
    // Same feed polled again: same keys (idempotent).
    const again = parseCmecfRss(xml, court).map((event) => event.deduplicationKey);
    expect(again).toEqual(events.map((event) => event.deduplicationKey));
  });

  it("flags sealed entries restricted and never creates a case for them", () => {
    const sealed = events.filter((event) => /Sealed/.test(event.exactText));
    expect(sealed).toHaveLength(2);
    for (const event of sealed) {
      expect(event.restricted).toBe(true);
      expect(shouldCreateCase(event)).toBe(false);
    }
    expect(sealed.find((event) => event.docketNumber === "1:26-mj-01180")?.caption).toBe("USA v. Sealed");
    // A sealed document in an otherwise public case is also restricted.
    expect(sealed.find((event) => event.docketNumber === "1:25-cr-00211")?.restricted).toBe(true);
    expect(events.filter((event) => !event.restricted)).toHaveLength(14);
  });
});
