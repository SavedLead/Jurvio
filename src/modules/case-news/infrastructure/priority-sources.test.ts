import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FetchBudget, RateLimitedError } from "@/modules/ingestion/live-feeds/polite-fetcher";
import { caseNewsTerms } from "../domain/case-terms";
import { buildPriorityQuery, buildPriorityQueryCore, isTransientNetworkError, searchGdelt } from "./gdelt";
import { buildGoogleNewsUrl, parseGoogleNewsRss, searchGoogleNews } from "./google-news";

const terms = (caption: string, docketNumber: string, courtCode = "scotus", courtName = "scotus") =>
  caseNewsTerms({ caption, docketNumber, courtCode, courtName });

describe("priority (SCOTUS / appeals) queries", () => {
  it("searches 'X v. United States' by the distinctive party plus Supreme Court", () => {
    expect(buildPriorityQuery(terms("Barrett v. United States", "24-5774"), "24-5774")).toEqual({ query: 'Barrett "Supreme Court" sourcelang:english', kind: "parties" });
    expect(buildPriorityQueryCore(terms("Ellingburg v. United States", "24-482"), "24-482")?.query).toBe('Ellingburg "Supreme Court"');
  });
  it("drops State of X, the Commissioner and et al.", () => {
    expect(buildPriorityQueryCore(terms("STATE OF TEXAS v. Ordaz-Cortes, et al.", "25-10"), "25-10")?.query).toBe('"Ordaz-Cortes" "Supreme Court"');
    expect(buildPriorityQueryCore(terms("Zuch v. Commissioner of Internal Revenue", "24-1287", "ca3", "Third Circuit"), "24-1287")?.query)
      .toBe('Zuch ("Third Circuit" OR "3rd Circuit")');
  });
  it("uses the circuit name for appeals and both weak names when they are all there is", () => {
    expect(buildPriorityQueryCore(terms("Trump v. Cook", "25-A312"), "25-A312")?.query).toBe('Trump Cook "Supreme Court"');
    expect(buildPriorityQueryCore(terms("Uber Technologies, Inc. v. City of Seattle", "25-228", "ca9", "Ninth Circuit"), "25-228")?.query)
      .toBe('Uber ("Ninth Circuit" OR "9th Circuit")');
  });
  it("falls back to the docket number with the court when no party is usable", () => {
    expect(buildPriorityQuery(terms("Smith v. United States", "25-5123"), "25-5123")).toEqual({ query: '"25-5123" "Supreme Court" sourcelang:english', kind: "docket" });
  });
});

describe("transient GDELT failures back off like rate limiting", () => {
  it("classifies fetch failed and timeouts", () => {
    expect(isTransientNetworkError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientNetworkError(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toBe(true);
    expect(isTransientNetworkError(new Error("returned HTTP 500"))).toBe(false);
  });
  it("turns fetch failed into RateLimitedError and stops the budget", async () => {
    const budget = new FetchBudget({ source: "gdelt", maxRequests: 5, maxMs: 60_000, minIntervalMs: 0, fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    await expect(searchGdelt(budget, "x")).rejects.toBeInstanceOf(RateLimitedError);
    expect(budget.canFetch).toBe(false);
  });
});

describe("Google News RSS", () => {
  const xml = readFileSync(new URL("./fixtures/google-news-search.xml", import.meta.url), "utf8");
  it("builds a search URL", () => {
    const url = new URL(buildGoogleNewsUrl('Barrett "Supreme Court"'));
    expect(url.hostname).toBe("news.google.com");
    expect(url.searchParams.get("q")).toBe('Barrett "Supreme Court" when:90d');
    expect(url.searchParams.get("ceid")).toBe("US:en");
  });
  it("keeps headline, outlet, link and date; no duplicate snippet", () => {
    const items = parseGoogleNewsRss(xml);
    expect(items.length).toBe(3);
    expect(items[0]).toMatchObject({ title: "Who is Justice Barrett?", sourceName: "SCOTUSblog", sourceDomain: "scotusblog.com", snippet: null });
    expect(items[0]!.url).toMatch(/^https:\/\/news\.google\.com\//);
  });
  it("keeps a truncated description when it adds to the headline", () => {
    const long = "word ".repeat(80);
    const feed = `<rss><channel><item><title>Court rules - Reuters</title><link>https://news.google.com/a</link><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;${long}&lt;/p&gt;</description><source url="https://www.reuters.com">Reuters</source></item></channel></rss>`;
    const [item] = parseGoogleNewsRss(feed);
    expect(item!.title).toBe("Court rules");
    expect(item!.snippet!.length).toBeLessThanOrEqual(200);
  });
  it("stops on 503 like a rate limit", async () => {
    const budget = new FetchBudget({ source: "google_news_rss", maxRequests: 5, maxMs: 60_000, minIntervalMs: 0, fetchImpl: (async () => new Response("captcha", { status: 503 })) as typeof fetch });
    await expect(searchGoogleNews(budget, "x")).rejects.toBeInstanceOf(RateLimitedError);
    expect(budget.canFetch).toBe(false);
  });
});
