import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RateLimitedError } from "@/modules/ingestion/live-feeds/polite-fetcher";
import { caseNewsTerms } from "../domain/case-terms";
import { CASE_NEWS_SOURCES } from "../domain/sources";
import { buildDocketQuery, buildGdeltUrl, buildPartiesQuery, GdeltQueryError, parseGdeltArtList } from "./gdelt";
import { parseRssItems, shortSnippet } from "./rss";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("GDELT", () => {
  it("builds a full-text query with both parties and the court", () => {
    const terms = caseNewsTerms({ caption: "UBER TECHNOLOGIES, INC., ET AL. V. CITY OF SEATTLE", docketNumber: "25-228", courtCode: "ca9", courtName: "Ninth Circuit" });
    expect(buildPartiesQuery(terms)).toBe('Uber Seattle ("Ninth Circuit" OR "9th Circuit") sourcelang:english');
    const learning = caseNewsTerms({ caption: "Learning Resources, Inc. v. Trump", docketNumber: "24-1287", courtCode: "scotus", courtName: "scotus" });
    expect(buildPartiesQuery(learning)).toBe('"Learning Resources" Trump "Supreme Court" sourcelang:english');
    expect(buildDocketQuery("25-228", terms)).toBeNull();
    const harvard = caseNewsTerms({ caption: "PRESIDENT AND FELLOWS OF HARVARD COLLEGE V. U.S. DEPARTMENT OF HEALTH AND HUMAN SERVICES", docketNumber: "25-1611", courtCode: "ca1", courtName: "First Circuit" });
    expect(buildPartiesQuery(harvard)).toContain("Harvard");
  });
  it("builds docket queries for district dockets", () => {
    const terms = caseNewsTerms({ caption: "SEC V. ACME CRYPTO LLC", docketNumber: "1:26-cv-04411-ABC", courtCode: "nysd", courtName: "Southern District of New York" });
    expect(buildDocketQuery("1:26-cv-04411-ABC", terms)).toBe('("26-cv-04411" OR "26-cv-4411") sourcelang:english');
  });
  it("asks for a date-sorted article list", () => {
    const url = new URL(buildGdeltUrl("x", { start: new Date("2026-08-01T00:00:00Z") }));
    expect(url.searchParams.get("mode")).toBe("artlist");
    expect(url.searchParams.get("startdatetime")).toBe("20260801000000");
  });
  it("parses an article list", () => {
    const articles = parseGdeltArtList(fixture("gdelt-uber-seattle.json"));
    expect(articles).toHaveLength(5);
    expect(articles[0]).toMatchObject({ domain: "reuters.com", title: "Ninth Circuit upholds Seattle gig worker law challenged by Uber" });
    expect(articles[0]!.publishedAt.toISOString()).toBe("2026-10-20T18:15:00.000Z");
  });
  it("treats the plain-text throttle notice as rate limiting and other text as a query error", () => {
    expect(() => parseGdeltArtList("Please limit requests to one every 5 seconds")).toThrow(RateLimitedError);
    expect(() => parseGdeltArtList("The specified phrase is too short.")).toThrow(GdeltQueryError);
    expect(parseGdeltArtList("{}")).toEqual([]);
  });
});

describe("Courthouse News RSS", () => {
  it("parses items with the feed's own short description", () => {
    const items = parseRssItems(fixture("cns-feed.xml"));
    expect(items.length).toBeGreaterThan(5);
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/www\.courthousenews\.com\//);
      expect(item.snippet === null || item.snippet.length <= 200).toBe(true);
      expect(item.title).not.toMatch(/&#\d+;/);
    }
  });
  it("cuts long descriptions at a word boundary", () => {
    const snippet = shortSnippet("word ".repeat(100));
    expect(snippet!.length).toBeLessThanOrEqual(200);
    expect(snippet!.endsWith("…")).toBe(true);
  });
});

describe("source registry", () => {
  it("keeps Google News RSS off and records terms for every source", () => {
    expect(CASE_NEWS_SOURCES.find((source) => source.id === "google_news_rss")?.enabled).toBe(false);
    expect(CASE_NEWS_SOURCES.filter((source) => source.enabled).map((source) => source.id).sort()).toEqual(["courthousenews_rss", "gdelt"]);
    for (const source of CASE_NEWS_SOURCES) expect(source.terms.length).toBeGreaterThan(40);
  });
});
