import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPELLATE_RSS_COURTS, APPELLATE_RSS_NOT_CONFIGURED, appellateRssUrl, entryKind, parseAppellateRss } from "./pacer-rss";

// The real cadc feed of 2026-10-31 (one entry) plus three entries in the same format.
const XML = readFileSync(join(__dirname, "../../live-feeds/fixtures/cadc-appellate-rss.xml"), "latin1");

describe("appellate CM/ECF public RSS", () => {
  it("covers all 13 circuits as configured or documented not configured", () => {
    expect([...APPELLATE_RSS_COURTS, ...APPELLATE_RSS_NOT_CONFIGURED].sort())
      .toEqual(["ca1", "ca10", "ca11", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9", "cadc", "cafc"]);
    expect(appellateRssUrl("cadc")).toBe("https://ecf.cadc.uscourts.gov/n/beam/servlet/TransportRoom?servlet=RSSGenerator");
  });

  it("reads docket, caption, entry text, kind and date; one item per entry (partId guid)", () => {
    const items = parseAppellateRss(XML, "cadc");
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ docketNumber: "26-1287", caption: "In re: Abd Al-Rahim Hussein Al-Nashiri",
      entryText: "Per Curiam Order Filed Special Panel", kind: "order", filedOn: "2026-10-31" });
    expect(items.map((item) => item.kind)).toEqual(["order", "opinion", "judgment", "order"]);
    expect(new Set(items.map((item) => item.entryKey)).size).toBe(4);
    for (const item of items) expect(item.entryText).not.toMatch(/docs1|href/);
  });

  it("classifies docket text", () => {
    expect(entryKind("Opinion Filed for the Court by Judge Pillard")).toBe("opinion");
    expect(entryKind("Judgment Filed")).toBe("judgment");
    expect(entryKind("Clerk's Order filed")).toBe("order");
    expect(entryKind("Brief filed")).toBe("other");
  });
});
