import { describe, expect, it } from "vitest";
import {
  classifyDirectEvent,
  isRestrictedDirectEvent,
  normalizeDocketNumber,
  shouldCreateCase,
  stableDirectEventIdentity,
  visitorFriendlyDescription,
} from "./direct-court";
import { parseCmecfRss } from "../providers/courts/cmecf-rss";
import {
  FEDERAL_COURT_REGISTRY,
  federalCourtByCode,
} from "../providers/courts/registry";

const court = federalCourtByCode("TXWD");
if (!court) throw new Error("TXWD fixture court missing");
const feed = `<?xml version="1.0"?><rss version="2.0"><channel><item>
<guid>txwd-100</guid>
<title>2:26-mj-00830 - United States v. VELEZ-Lopez</title>
<description><![CDATA[Document 7: ORDER entered by the court]]></description>
<link>https://ecf.txwd.uscourts.gov/doc1/18119999999</link>
<pubDate>Wed, 29 Jul 2026 18:30:00 GMT</pubDate>
</item></channel></rss>`;

describe("direct federal court ingestion", () => {
  it("covers the approved first direct-court cohort", () => {
    expect(FEDERAL_COURT_REGISTRY.map((entry) => entry.officialCourtCode))
      .toEqual(["txwd", "nysd", "njd", "cand", "casd", "wawd", "ded", "dcd", "mad", "flsd", "cacd", "txed"]);
    expect(federalCourtByCode("NYSD")).toMatchObject({
      rssCoverageWindowHours: 24,
      pollingMinutes: 5,
      adapterType: "cmecf-rss-v1",
    });
    expect(federalCourtByCode("njd")).toMatchObject({
      includedEventCategories: ["all"],
      timeZone: "America/New_York",
    });
    for (const code of ["cand", "casd", "wawd"]) {
      expect(federalCourtByCode(code)).toMatchObject({
        circuit: "9",
        rssCoverageWindowHours: 24,
        includedEventCategories: ["all"],
        adapterType: "cmecf-rss-v1",
      });
    }
  });
  it.each([
    ["2:26-mj-830", "2:26-mj-00830"],
    ["Case No. 2:26-MJ-00830-ABC", "2:26-mj-00830"],
  ])("normalizes docket %s", (input, expected) => {
    expect(normalizeDocketNumber(input)).toBe(expected);
  });
  it("parses and classifies CM/ECF RSS", () => {
    expect(parseCmecfRss(feed, court)[0]).toMatchObject({
      docketNumber: "2:26-mj-00830",
      eventType: "order_entered",
      visitorDescription: "Order entered",
      documentNumber: "7",
      restricted: false,
    });
  });
  it("deduplicates feed overlap", () => {
    const first = parseCmecfRss(feed, court)[0];
    const second = parseCmecfRss(feed, court)[0];
    expect(first?.deduplicationKey).toBe(second?.deduplicationKey);
  });
  it("recovers identity without a guid", () => {
    const input = {
      courtCode: "txwd",
      docketNumber: "2:26-mj-00830",
      officialEventId: null,
      filedAt: "2026-07-29T18:30:00.000Z",
      exactText: "ORDER entered",
      documentNumber: "7",
    };
    expect(stableDirectEventIdentity(input)).toEqual(stableDirectEventIdentity(input));
  });
  it("skips malformed items and tolerates missing optional fields", () => {
    expect(parseCmecfRss(feed.replace("<guid>txwd-100</guid>", ""), court)).toHaveLength(1);
    expect(parseCmecfRss("<rss><item><title>bad</title></item></rss>", court)).toEqual([]);
  });
  it("suppresses restricted events", () => {
    expect(isRestrictedDirectEvent("Restricted order entered under seal")).toBe(true);
    const sealed = feed.replace("ORDER entered by the court", "RESTRICTED order entered under seal");
    expect(parseCmecfRss(sealed, court)[0]?.restricted).toBe(true);
  });
  it("uses neutral visitor wording", () => {
    expect(classifyDirectEvent("Motion to dismiss filed")).toBe("motion_filed");
    expect(visitorFriendlyDescription("motion_filed")).toBe("Motion filed");
    expect(visitorFriendlyDescription("order_entered")).not.toMatch(/won|lost/i);
  });
  it("creates only strongly identified public cases", () => {
    expect(shouldCreateCase({
      docketNumber: "2:26-mj-00830",
      caption: "United States v. VELEZ-Lopez",
      restricted: false,
    })).toBe(true);
    expect(shouldCreateCase({
      docketNumber: "bad",
      caption: "United States v. X",
      restricted: false,
    })).toBe(false);
  });
});
