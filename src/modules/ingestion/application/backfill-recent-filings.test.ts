import { describe, expect, it } from "vitest";
import type { CourtListenerDocket } from "../providers/courtlistener/schema";
import { CourtListenerRateLimited } from "../providers/courtlistener/client";
import { recentDocketListUrl, recentFilingBounds, walkRecentDocketPages } from "./backfill-recent-filings";

const docket = { id: 1, resource_uri: "https://www.courtlistener.com/api/rest/v4/dockets/1/", absolute_url: "/docket/1/", docket_number: "24-1", case_name: "Alpha v. Beta", court: "https://www.courtlistener.com/api/rest/v4/courts/ca9/", date_filed: "2026-10-02", date_modified: "2026-10-03T00:00:00Z", cause: "", nature_of_suit: "", jury_demand: "", assigned_to_str: "", referred_to_str: "" } as CourtListenerDocket;

describe("filings after the snapshot", () => {
  it("starts the day after the snapshot and stops before today", () => {
    expect(recentFilingBounds("2026-09-30", "2026-11-18", 365)).toEqual({
      filedOnOrAfter: "2026-10-01", filedBefore: "2026-11-18",
    });
    expect(recentFilingBounds("2026-09-30", "2026-11-18", 30)).toEqual({
      filedOnOrAfter: "2026-10-19", filedBefore: "2026-11-18",
    });
    expect(recentFilingBounds("2026-11-18", "2026-11-18", 365)).toBeNull();
  });

  it("asks CourtListener for that family's filing dates only", () => {
    const appeals = recentDocketListUrl("https://www.courtlistener.com/api/rest/v4", "appeals", {
      filedOnOrAfter: "2026-10-01", filedBefore: "2026-11-18",
    });
    expect(appeals).toContain("date_filed__gte=2026-10-01");
    expect(appeals).toContain("date_filed__lt=2026-11-18");
    expect(appeals).toContain("court__jurisdiction__in=F");
    const district = new URL(recentDocketListUrl("https://www.courtlistener.com/api/rest/v4", "district", {
      filedOnOrAfter: "2026-10-01", filedBefore: "2026-11-18",
    }));
    expect(district.searchParams.get("court__jurisdiction__in")).toBe("FD");
  });

  it("stops at the request budget and keeps the next page", async () => {
    const seen: string[] = [];
    const result = await walkRecentDocketPages({
      startUrl: "https://example.test/page-1",
      quota: 1,
      family: "appeals",
      today: "2026-11-18",
      windowDays: 365,
      sleep: async () => undefined,
      fetchPage: async (url) => {
        seen.push(url);
        return { records: [docket], next: "https://example.test/page-2" };
      },
      persist: async () => ({ inserted: 1, filledDate: 0, alreadyPresent: 0 }),
    });
    expect(seen).toEqual(["https://example.test/page-1"]);
    expect(result).toMatchObject({ requests: 1, inserted: 1, nextUrl: "https://example.test/page-2", stopped: "quota" });
  });

  it("finishes when the list ends and does not spend a request after a 429", async () => {
    const done = await walkRecentDocketPages({
      startUrl: "https://example.test/page-1",
      quota: 5,
      family: "appeals",
      today: "2026-11-18",
      windowDays: 365,
      sleep: async () => undefined,
      fetchPage: async () => ({ records: [], next: null }),
      persist: async () => ({ inserted: 0, filledDate: 0, alreadyPresent: 0 }),
    });
    expect(done.stopped).toBe("complete");
    const paused = await walkRecentDocketPages({
      startUrl: "https://example.test/page-9",
      quota: 5,
      family: "district",
      today: "2026-11-18",
      windowDays: 365,
      sleep: async () => undefined,
      fetchPage: async () => { throw new CourtListenerRateLimited(null); },
      persist: async () => ({ inserted: 0, filledDate: 0, alreadyPresent: 0 }),
    });
    expect(paused).toMatchObject({ requests: 0, nextUrl: "https://example.test/page-9", stopped: "quota" });
  });
});
