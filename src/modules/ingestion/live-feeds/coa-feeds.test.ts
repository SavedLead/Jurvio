import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COA_FEED_SOURCES, COA_WITHOUT_FEED, cleanCaption, coaEntryDescription, dedupeCoaItems, feedDate,
  normalizeDocket, parseCoaFeed, precedentialFrom,
} from "./coa-feeds";

// Fixtures are real responses fetched on 2026-10-30 (cafc trimmed to 20 items).
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const parse = (court: string, index: number, file: string) => parseCoaFeed(fixture(file), court, COA_FEED_SOURCES[court]![index]!);

describe("court of appeals feed registry", () => {
  it("covers all 13 circuits, either with a feed or a documented reason", () => {
    const all = ["ca1", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9", "ca10", "ca11", "cadc", "cafc"];
    const covered = [...Object.keys(COA_FEED_SOURCES), ...Object.keys(COA_WITHOUT_FEED)].sort();
    expect(covered).toEqual([...all].sort());
    for (const sources of Object.values(COA_FEED_SOURCES)) {
      for (const source of sources) expect(source.url).toMatch(/^https:\/\/[a-z0-9.]+\.uscourts\.gov\//);
    }
  });
});

describe("court of appeals feed parsers", () => {
  it("ca5 RSS: docket, caption, released date and published flag", () => {
    const items = parse("ca5", 0, "ca5-opinions.rss.xml");
    expect(items).toHaveLength(59);
    expect(items[0]).toEqual({
      courtCode: "ca5", docketNumber: "25-60590", caption: "USA v. Seals", releasedOn: "2026-10-29",
      documentUrl: "https://www.ca5.uscourts.gov/opinions/unpub/25/25-60590.0.pdf",
      sourceId: "ca5:https://www.ca5.uscourts.gov/opinions/unpub/25/25-60590.0.pdf", kind: "opinion", precedential: false,
    });
    expect(items.some((item) => item.precedential === true)).toBe(true);
  });

  it("ca9 RSS: docket comes from the PDF file name; memoranda are unpublished", () => {
    const opinions = parse("ca9", 0, "ca9-opinions.rss.xml");
    expect(opinions.length).toBeGreaterThanOrEqual(24);
    expect(opinions[0]).toMatchObject({ docketNumber: "25-1888", caption: "COLVIN AND SON, LLC, ET AL. V. BURGUM, ET AL.",
      releasedOn: "2026-10-29", kind: "opinion", precedential: true });
    const memoranda = parse("ca9", 1, "ca9-memoranda.rss.xml");
    expect(memoranda[0]).toMatchObject({ docketNumber: "24-5837", kind: "memorandum", precedential: false });
  });

  it("cadc RSS: 'docket | caption' titles", () => {
    const items = parse("cadc", 0, "cadc-opinions.rss.xml");
    expect(items).toHaveLength(15);
    expect(items[0]).toMatchObject({ docketNumber: "24-5231", caption: "California Valley Miwok Tribe v. Douglas Burgum", releasedOn: "2026-10-23" });
  });

  it("cafc RSS: strips [ORDER] and precedential tags, marks orders", () => {
    const items = parse("cafc", 0, "cafc-feed.rss.xml");
    expect(items).toHaveLength(20);
    expect(items[0]).toMatchObject({ docketNumber: "26-2253", caption: "TITRE v. DEPARTMENT OF AGRICULTURE",
      kind: "order", precedential: false, releasedOn: "2026-10-29", sourceId: "cafc:https://www.cafc.uscourts.gov/?p=179314" });
  });

  it("ca3 RSS and list: caption from the description, docket from the title", () => {
    const precedential = parse("ca3", 0, "ca3-opinions.rss.xml");
    expect(precedential).toHaveLength(11);
    expect(precedential[0]).toMatchObject({ docketNumber: "26-2072",
      caption: "Holy Trinity Ukrainian Catholic Church v. Township of Collier", releasedOn: "2026-10-19", precedential: true });
    const nonPrecedential = parse("ca3", 1, "ca3-nonprec.html");
    expect(nonPrecedential.map((item) => item.docketNumber)).toEqual(["25-2735", "22-1499"]);
    expect(nonPrecedential[1]).toMatchObject({ precedential: false, releasedOn: "2026-10-29",
      documentUrl: "https://www2.ca3.uscourts.gov/opinarch/221499np.pdf" });
  });

  it("ca11 table: appeal number column, absolute PDF links", () => {
    const items = parse("ca11", 0, "ca11-pub.html");
    expect(items).toHaveLength(20);
    expect(items[0]).toMatchObject({ docketNumber: "23-12947", caption: "Dorian Frank O'Kelley v. Warden, Georgia Diagnostic Prison",
      releasedOn: "2026-10-27", documentUrl: "https://media.ca11.uscourts.gov/opinions/pub/files/202312947.pdf", precedential: true });
  });

  it("an empty channel (ca10 on a day with no decisions) is zero items, not an error", () => {
    expect(parse("ca10", 0, "ca10-daily.rss.xml")).toEqual([]);
  });
});

describe("feed helpers", () => {
  it("reads the date formats the circuits use", () => {
    expect(feedDate("Thu, 29 Oct 2026 18:05:05 -0500")).toBe("2026-10-29");
    expect(feedDate("10/29/2026")).toBe("2026-10-29");
    expect(feedDate("10-27-2026")).toBe("2026-10-27");
    expect(feedDate("October 9, 2026")).toBe("2026-10-09");
    expect(feedDate("soon")).toBeNull();
  });

  it("cleans captions and reads precedential status", () => {
    expect(cleanCaption("26-2253: TITRE v. USDA [ORDER], Nonprecedential", "26-2253")).toBe("TITRE v. USDA");
    expect(cleanCaption("24-5231 | A v. B", "24-5231")).toBe("A v. B");
    expect(precedentialFrom("Unpublished Opinion", null)).toBe(false);
    expect(precedentialFrom("Published Opinion", null)).toBe(true);
    expect(precedentialFrom("Opinion", true)).toBe(true);
  });

  it("matches dockets the way the appellate pipeline does", () => {
    expect(normalizeDocket("No. 25-60590")).toBe("no2560590");
    expect(normalizeDocket("25-60590")).toBe(normalizeDocket("25 60590"));
  });

  it("dedupes overlapping feeds and sorts newest first", () => {
    const base = { courtCode: "ca9", caption: "A v. B", kind: "opinion" as const, precedential: true };
    const items = dedupeCoaItems([
      { ...base, docketNumber: "25-1", releasedOn: "2026-10-01", documentUrl: "u1", sourceId: "s1" },
      { ...base, docketNumber: "25-2", releasedOn: "2026-10-29", documentUrl: "u2", sourceId: "s2" },
      { ...base, docketNumber: "25-1", releasedOn: "2026-10-01", documentUrl: "u1", sourceId: "s1-dup" },
    ]);
    expect(items.map((item) => item.docketNumber)).toEqual(["25-2", "25-1"]);
    expect(coaEntryDescription({ kind: "order", precedential: null })).toBe("Order released");
    expect(coaEntryDescription({ kind: "opinion", precedential: false })).toBe("Unpublished opinion released");
  });
});
