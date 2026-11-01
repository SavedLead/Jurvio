import { describe, expect, it } from "vitest";
import { caseNewsTerms } from "./case-terms";
import { distinctiveForSingleParty, matchNewsItem, PUBLISH_THRESHOLD, reviewStatusFor, withoutCourtNames, type MatchContext } from "./match";

const now = new Date("2026-10-31T12:00:00Z");
const uberTerms = caseNewsTerms({ caption: "UBER TECHNOLOGIES, INC., ET AL. V. CITY OF SEATTLE", docketNumber: "25-228", courtCode: "ca9", courtName: "Ninth Circuit" });
const ctx = (overrides: Partial<MatchContext> = {}): MatchContext => ({
  terms: uberTerms, filedOn: "2025-01-15", decidedOn: null, ambiguity: "none", courtInFullText: true, docketInFullText: false, now, ...overrides,
});
const item = (title: string, snippet: string | null = null, publishedAt = new Date("2026-10-20T00:00:00Z")) => ({ url: "https://www.reuters.com/x", title, snippet, publishedAt });

describe("matchNewsItem", () => {
  it("publishes a headline naming both parties and the court", () => {
    const result = matchNewsItem(item("Ninth Circuit upholds Seattle gig worker law challenged by Uber"), ctx());
    expect(result?.method).toBe("parties_court_timeframe");
    expect(reviewStatusFor(result!.score)).toBe("auto_published");
  });
  it("sends a both-parties headline without the court in it to review", () => {
    const result = matchNewsItem(item("Uber, Instacart lose appeal over Seattle delivery pay rules"), ctx());
    expect(result).not.toBeNull();
    expect(reviewStatusFor(result!.score)).toBe("pending_review");
  });
  it("publishes an exact case name with court evidence", () => {
    const result = matchNewsItem(item("Uber Technologies v. Seattle heads back to district court"), ctx());
    expect(result?.method).toBe("case_name_court");
    expect(result!.score).toBeGreaterThanOrEqual(0.9);
  });
  it("drops a headline that names only one party", () => {
    expect(matchNewsItem(item("Uber earnings preview: what to watch"), ctx())).toBeNull();
  });
  it("needs the court somewhere: an RSS headline without court evidence is dropped", () => {
    expect(matchNewsItem(item("Uber sues Seattle again"), ctx({ courtInFullText: false }))).toBeNull();
  });
  it("caps ambiguous party pairs below the publish threshold", () => {
    const same = matchNewsItem(item("Ninth Circuit upholds Seattle gig worker law challenged by Uber"), ctx({ ambiguity: "same_court" }));
    expect(reviewStatusFor(same!.score)).toBe("pending_review");
    const other = matchNewsItem(item("Uber v. Seattle: rulings so far"), ctx({ ambiguity: "other_court" }));
    expect(reviewStatusFor(other!.score)).toBe("pending_review");
    const named = matchNewsItem(item("Ninth Circuit rules for Seattle in Uber case"), ctx({ ambiguity: "other_court" }));
    expect(reviewStatusFor(named!.score)).toBe("auto_published");
  });
  it("rejects coverage before the case was filed", () => {
    expect(matchNewsItem(item("Ninth Circuit upholds Seattle law challenged by Uber", null, new Date("2024-06-01T00:00:00Z")), ctx())).toBeNull();
  });
  it("matches lowercase common words as names only when capitalized", () => {
    const rice = caseNewsTerms({ caption: "RICE V. ACME WIDGETS, INC.", docketNumber: "26-100", courtCode: "ca5", courtName: "Fifth Circuit" });
    // "rice" is not the party Rice: at most a one-party (Acme Widgets) review match, never two-party.
    const result = matchNewsItem(item("Fifth Circuit: Acme Widgets recalls rice cookers"), ctx({ terms: rice }));
    expect(result?.evidence.leftHit).toBeNull();
    expect(result?.method).toBe("single_party_court");
    expect(reviewStatusFor(result!.score)).toBe("pending_review");
  });
  it("matches all-caps company names and agency acronyms in headlines", () => {
    const att = caseNewsTerms({ caption: "AT&T INC. V. FEDERAL COMMUNICATIONS COMMISSION", docketNumber: "25-1001", courtCode: "ca5", courtName: "Fifth Circuit" });
    const result = matchNewsItem(item("Fifth Circuit tosses FCC fine against AT&T"), ctx({ terms: att, filedOn: "2026-01-10" }));
    expect(result?.method).toBe("parties_court_timeframe");
    expect(reviewStatusFor(result!.score)).toBe("auto_published");
  });
  it("publishes a docket number match with the court named", () => {
    const district = caseNewsTerms({ caption: "SECURITIES AND EXCHANGE COMMISSION V. ACME CRYPTO LLC", docketNumber: "1:26-cv-04411", courtCode: "nysd", courtName: "U.S. District Court for the Southern District of New York" });
    const result = matchNewsItem(item("SEC sues Acme Crypto", "The complaint (No. 1:26-cv-04411) was filed in the Southern District of New York."),
      ctx({ terms: district, courtInFullText: false, filedOn: "2026-10-01" }));
    expect(result?.method).toBe("docket_number");
    expect(reviewStatusFor(result!.score)).toBe("auto_published");
  });
  it("keeps a GDELT docket hit without a party in the headline for review", () => {
    const district = caseNewsTerms({ caption: "SECURITIES AND EXCHANGE COMMISSION V. ACME CRYPTO LLC", docketNumber: "1:26-cv-04411", courtCode: "nysd", courtName: "Southern District of New York" });
    const result = matchNewsItem(item("Crypto enforcement roundup"), ctx({ terms: district, courtInFullText: false, docketInFullText: true, filedOn: "2026-10-01" }));
    expect(reviewStatusFor(result!.score)).toBe("pending_review");
  });
  it("matches a SCOTUS case by name", () => {
    const scotus = caseNewsTerms({ caption: "Learning Resources, Inc. v. Trump", docketNumber: "24-1287", courtCode: "scotus", courtName: "scotus" });
    const result = matchNewsItem(item("Supreme Court hears Learning Resources v. Trump tariff challenge"), ctx({ terms: scotus, courtInFullText: true, filedOn: "2025-09-01" }));
    expect(result?.method).toBe("case_name_court");
    expect(reviewStatusFor(result!.score)).toBe("auto_published");
  });
});

describe("one-party matches go to review", () => {
  const scotus = (caption: string, docket = "24-5774") => caseNewsTerms({ caption, docketNumber: docket, courtCode: "scotus", courtName: "scotus" });
  const rss = (terms: ReturnType<typeof caseNewsTerms>, overrides: Partial<MatchContext> = {}) =>
    ctx({ terms, courtInFullText: false, filedOn: "2026-01-10", ...overrides });

  it("queues a headline naming one distinctive party and the court", () => {
    const result = matchNewsItem(item("Supreme Court weighs Ellingburg restitution appeal"), rss(scotus("Ellingburg v. United States", "24-482")));
    expect(result?.method).toBe("single_party_court");
    expect(reviewStatusFor(result!.score)).toBe("pending_review");
  });
  it("never auto-publishes a one-party match, even unambiguous with the court in the headline", () => {
    const org = caseNewsTerms({ caption: "Learning Resources, Inc. v. Trump", docketNumber: "24-1287", courtCode: "scotus", courtName: "scotus" });
    const result = matchNewsItem(item("Supreme Court hears Learning Resources tariff challenge"), rss(org));
    expect(result?.method).toBe("single_party_court");
    expect(result!.score).toBeLessThan(PUBLISH_THRESHOLD);
  });
  it("queues a one-party GDELT hit when the court is in the full text and the headline is about litigation", () => {
    const result = matchNewsItem(item("Ninth Circuit ruling: Uber loses gig pay appeal"), ctx({ courtInFullText: true }));
    expect(result).not.toBeNull();
    const queued = matchNewsItem(item("Uber loses appeal over driver pay"), ctx({ courtInFullText: true }));
    expect(queued?.method).toBe("single_party_court");
    expect(reviewStatusFor(queued!.score)).toBe("pending_review");
  });
  it("drops one party without the court (RSS) or without litigation context (GDELT)", () => {
    expect(matchNewsItem(item("Ellingburg family opens bakery"), rss(scotus("Ellingburg v. United States", "24-482")))).toBeNull();
    expect(matchNewsItem(item("Uber earnings preview: what to watch"), ctx({ courtInFullText: true }))).toBeNull();
  });
  it("does not treat 'Justice Barrett' as the party Barrett", () => {
    const barrett = scotus("Barrett v. United States");
    expect(distinctiveForSingleParty(barrett.left)).toBe(false);
    expect(matchNewsItem(item("Justice Barrett questions lawyers at the Supreme Court"), rss(barrett))).toBeNull();
    expect(matchNewsItem(item("Supreme Court: Justice Amy Coney Barrett says the United States must answer"), rss(barrett))).toBeNull();
    // The case name itself still matches.
    expect(matchNewsItem(item("Supreme Court decides Barrett v. United States"), rss(barrett))?.method).toBe("case_name_court");
  });
  it("excludes parties named like a sitting lower-court judge", () => {
    const terms = caseNewsTerms({ caption: "Ikuta v. Acme Corp.", docketNumber: "25-1001", courtCode: "ca9", courtName: "Ninth Circuit" });
    const judges = new Set(["ikuta"]);
    expect(matchNewsItem(item("Ninth Circuit Judge Ikuta writes dissent"), rss(terms, { judgeSurnames: judges }))).toBeNull();
    expect(matchNewsItem(item("Ninth Circuit: Ikuta's suit revived"), rss(terms, { judgeSurnames: judges }))).toBeNull();
    // Without the judge list, a titled mention still never counts.
    expect(matchNewsItem(item("Ninth Circuit Judge Ikuta writes dissent"), rss(terms))).toBeNull();
  });
  it("a generic party never counts as the distinctive one", () => {
    const usa = scotus("United States v. Texas", "25-1");
    expect(distinctiveForSingleParty(usa.left)).toBe(false);
    expect(distinctiveForSingleParty(usa.right!)).toBe(false);
    expect(matchNewsItem(item("Supreme Court rules for the United States"), rss(usa))).toBeNull();
    expect(matchNewsItem(item("Supreme Court rules on Texas immigration law"), rss(usa))).toBeNull();
  });
  it("'U.S. Supreme Court' does not name the United States as a party", () => {
    expect(withoutCourtNames("U.S. Supreme Court sides with Bowe")).not.toMatch(/U\.S\./);
    expect(withoutCourtNames("U.S. Justice Department sues Bowe")).toMatch(/U\.S\./);
    const bowe = scotus("Bowe v. United States", "24-5438");
    const result = matchNewsItem(item("U.S. Supreme Court sides with Bowe in habeas case"), rss(bowe));
    expect(result?.method).toBe("single_party_court");
    expect(reviewStatusFor(result!.score)).toBe("pending_review");
  });
  it("keeps auto-publish for both parties with the court", () => {
    const result = matchNewsItem(item("Ninth Circuit upholds Seattle gig worker law challenged by Uber"), ctx());
    expect(reviewStatusFor(result!.score)).toBe("auto_published");
  });
  it("rejects one-party coverage outside the case timeframe", () => {
    expect(matchNewsItem(item("Supreme Court weighs Ellingburg appeal", null, new Date("2024-01-01T00:00:00Z")),
      rss(scotus("Ellingburg v. United States", "24-482"), { filedOn: "2025-06-01" }))).toBeNull();
  });
});
