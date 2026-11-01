import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STATE_AGS, parseStateListing, stateReleaseItem, stateSourceCode } from "./state-ag";
import { jndItem, parseJndCases, settlementDeadlines, settlementSiteItem } from "./settlements";

const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", name), "utf8");
const now = new Date("2026-10-31T12:00:00Z");
const config = (state: string) => STATE_AGS.find((entry) => entry.state === state)!;

describe("state attorneys general", () => {
  it("registers the ten largest-state and multistate newsrooms", () => {
    expect(STATE_AGS.map(stateSourceCode)).toEqual([
      "state-ag-ca", "state-ag-ny", "state-ag-tx", "state-ag-fl", "state-ag-il", "state-ag-pa", "state-ag-ma", "state-ag-wa", "state-ag-nj", "state-ag-multistate",
    ]);
  });

  it("reads RSS newsrooms (CA) and full-text feeds (PA)", () => {
    const ca = parseStateListing(fixture("state-ag-ca.rss.xml"), config("CA"));
    expect(ca.length).toBeGreaterThan(5);
    expect(ca.every((link) => link.url.startsWith("https://oag.ca.gov/news/press-releases/") && link.publishedAt)).toBe(true);
    const pa = parseStateListing(fixture("state-ag-pa.rss.xml"), config("PA"));
    expect(pa.length).toBeGreaterThan(5);
    expect(pa.every((link) => typeof link.body === "string" && link.body.length > 100)).toBe(true);
  });

  it("reads release links from an HTML newsroom (NY) and nothing else", () => {
    const ny = parseStateListing(fixture("state-ag-ny-listing.html"), config("NY"));
    expect(ny.length).toBeGreaterThan(5);
    expect(ny.every((link) => /^https:\/\/ag\.ny\.gov\/press-release\/\d{4}\//.test(link.url))).toBe(true);
    expect(new Set(ny.map((link) => link.url)).size).toBe(ny.length);
  });

  it("keeps a release naming a federal court for review, without a docket it never states", () => {
    const url = "https://illinoisattorneygeneral.gov/news/story/attorney-general-raoul-seeks-court-approval-for-400-million-nationwide-settlement-with-sandoz-over-conspiracy-to-raise-prices-and-limit-competition";
    const item = stateReleaseItem(config("IL"), { url, title: "Attorney General Raoul Seeks Court Approval For $400 Million Nationwide Settlement With Sandoz", publishedAt: null }, fixture("state-ag-il-release.html"), now);
    expect(item.notCourt).toBeUndefined();
    expect(item.statedCourts).toEqual(["ctd"]);
    expect(item.references).toEqual([]);
    expect(item.itemKind).toBe("press_release_multistate");
    expect(item.sourceRecordId).toBe(new URL(url).pathname);
  });

  it("reads the court a WA release names", () => {
    const url = "https://www.atg.wa.gov/news/news-releases/win-washington-judge-blocks-unlawful-federal-implementation-medicaid-work";
    const item = stateReleaseItem(config("WA"), { url, title: "Win for Washington", publishedAt: null }, fixture("state-ag-wa-release.html"), now);
    expect(item.statedCourts).toEqual(["mad"]);
    expect(item.publishedAt).toMatch(/^2026-10-29/);
  });
});

describe("settlement administrators", () => {
  it("reads JND's case list payload and keeps only district dockets", () => {
    const cases = parseJndCases(fixture("settlement-admin-jnd.html"));
    expect(cases.map((entry) => entry.projectCode)).toEqual(["CEL", "NAR", "HRI"]);
    const celgene = jndItem(cases[0]!, now)!;
    expect(celgene.references.map((ref) => [ref.courtCode, ref.docket.canonical])).toEqual([["njd", "2:18-cv-04772"]]);
    expect(celgene).toMatchObject({ settlementAmount: "$239M", officialExcerpt: null, documents: [{ url: "https://www.celgenesecuritieslitigation.com/", kind: "settlement_website" }] });
    // Three dockets, no court stated: kept for review, never matched.
    expect(jndItem(cases[1]!, now)!.references.map((ref) => ref.courtCode)).toEqual([null, null, null]);
    // Court of Federal Claims number: not a district docket.
    expect(jndItem(cases[2]!, now)).toBeNull();
  });

  it("reads the settlement website's stated case, deadlines and documents", () => {
    const [entry] = parseJndCases(fixture("settlement-admin-jnd.html"));
    const item = settlementSiteItem(entry!, fixture("settlement-site-celgene.html"), now);
    expect(item.sourceRecordId).toBe("celgenesecuritieslitigation.com");
    expect(item.references.map((ref) => [ref.courtCode, ref.docket.canonical])).toEqual([["njd", "2:18-cv-04772"]]);
    expect(item.keyDates.map((date) => date.label)).toContain("Objection deadline");
    expect(item.officialExcerpt).toBeNull();
  });

  it("only takes a deadline date that follows its label", () => {
    expect(settlementDeadlines("The Claim Deadline is March 3, 2027. The Final Approval Hearing will be held on April 10, 2027 at 9:00 a.m."))
      .toEqual([{ label: "Claim deadline", date: "2027-03-03" }, { label: "Final approval hearing", date: "2027-04-10" }]);
    expect(settlementDeadlines("Updated January 2, 2026. Learn about the settlement.")).toEqual([]);
  });
});
