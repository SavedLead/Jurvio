import { describe, expect, it } from "vitest";
import { CourtListenerRateLimited } from "../providers/courtlistener/client";
import type { CourtListenerDocket } from "../providers/courtlistener/schema";
import { courtCodeFromUrl, parseTailCursor, tailFirstPageUrl, walkTail, type TailPage } from "./courtlistener-tail";

// CourtListener's v4 API needs a token, so these records are built to the
// documented docket schema (the fields courtListenerDocketSchema reads).
function docket(id: number, court: string, modified: string, docketNumber = `1:26-cv-${id}`): CourtListenerDocket {
  return {
    id, resource_uri: `https://www.courtlistener.com/api/rest/v4/dockets/${id}/`, absolute_url: `/docket/${id}/x/`,
    docket_number: docketNumber, case_name: `Plaintiff ${id} v. Defendant`, date_filed: "2026-10-29",
    cause: "", nature_of_suit: "", jury_demand: "", assigned_to_str: "", referred_to_str: "",
    court: `https://www.courtlistener.com/api/rest/v4/courts/${court}/`, date_modified: modified,
  } as CourtListenerDocket;
}
const page = (records: CourtListenerDocket[], next: string | null): TailPage => ({
  records: records.map((record) => ({ record, rawBody: JSON.stringify(record), sourceUri: record.resource_uri })), next,
});
const now = new Date("2026-10-30T12:00:00Z");

describe("CourtListener tail helpers", () => {
  it("starts 48 hours back without a watermark and reads a stored one defensively", () => {
    expect(parseTailCursor(null, now)).toEqual({ modifiedAfter: "2026-10-28T12:00:00.000Z", modifiedBefore: null, next: null });
    expect(parseTailCursor("garbage", now).modifiedAfter).toBe("2026-10-28T12:00:00.000Z");
    expect(parseTailCursor(JSON.stringify({ modifiedAfter: "2026-10-30T00:00:00Z", modifiedBefore: "2026-10-30T06:00:00Z",
      next: "https://evil.example/x" }), now)).toEqual({ modifiedAfter: "2026-10-30T00:00:00Z", modifiedBefore: null, next: null });
  });

  it("reads court codes from court URLs and builds a federal-only first page", () => {
    expect(courtCodeFromUrl("https://www.courtlistener.com/api/rest/v4/courts/nysd/")).toBe("nysd");
    expect(courtCodeFromUrl("nonsense")).toBeNull();
    const url = new URL(tailFirstPageUrl("https://www.courtlistener.com/api/rest/v4", {
      modifiedAfter: "2026-10-30T00:00:00Z", modifiedBefore: "2026-10-30T06:00:00Z" }));
    expect(url.pathname).toBe("/api/rest/v4/dockets/");
    expect(url.searchParams.get("court__jurisdiction__in")).toBe("F,FD,FS");
    expect(url.searchParams.get("order_by")).toBe("date_modified,id");
    expect(url.searchParams.get("date_modified__gte")).toBe("2026-10-30T00:00:00Z");
  });
});

describe("walkTail", () => {
  const tracked = new Set(["nysd", "ca2", "scotus"]);

  it("stores tracked courts only, follows next pages and closes the window when caught up", async () => {
    const pages = [
      page([docket(1, "nysd", "2026-10-30T01:00:00Z"), docket(2, "nyb", "2026-10-30T01:01:00Z")], "https://www.courtlistener.com/api/rest/v4/dockets/?cursor=p2"),
      page([docket(3, "ca2", "2026-10-30T02:00:00Z")], null),
    ];
    const urls: string[] = [];
    const stored: string[] = [];
    const outcome = await walkTail({ modifiedAfter: "2026-10-30T00:00:00Z", modifiedBefore: null, next: null }, now, {
      tracked: (court) => tracked.has(court),
      fetchPage: async (url) => { urls.push(url); return pages.shift()!; },
      persist: async (court, record) => { stored.push(`${court}:${record.id}`); return record.id === 3 ? "created" : "existing"; },
    }, 5);
    expect(stored).toEqual(["nysd:1", "ca2:3"]);
    expect(urls[1]).toBe("https://www.courtlistener.com/api/rest/v4/dockets/?cursor=p2");
    expect(outcome.stoppedBy).toBe("caught_up");
    expect(outcome.itemsFetched).toBe(3);
    expect(outcome.newCases).toBe(1);
    expect(outcome.cursor).toEqual({ modifiedAfter: "2026-10-30T11:55:00.000Z", modifiedBefore: null, next: null });
    expect(outcome.perCourt.get("ca2")).toEqual({ items: 1, newCases: 1 });
  });

  it("stops at the page limit mid-window and resumes from the stored next URL", async () => {
    const next = "https://www.courtlistener.com/api/rest/v4/dockets/?cursor=p2";
    const outcome = await walkTail({ modifiedAfter: "2026-10-30T00:00:00Z", modifiedBefore: null, next: null }, now, {
      tracked: () => true,
      fetchPage: async () => page([docket(1, "nysd", "2026-10-30T01:00:00Z")], next),
      persist: async () => "existing",
    }, 1);
    expect(outcome.stoppedBy).toBe("page_limit");
    expect(outcome.cursor).toEqual({ modifiedAfter: "2026-10-30T00:00:00Z", modifiedBefore: "2026-10-30T11:55:00.000Z", next });
    expect(parseTailCursor(JSON.stringify(outcome.cursor), now)).toEqual(outcome.cursor);
  });

  it("stops on the first 429, records Retry-After and keeps the cursor", async () => {
    let calls = 0;
    const start = { modifiedAfter: "2026-10-30T00:00:00Z", modifiedBefore: null, next: null };
    const outcome = await walkTail(start, now, {
      tracked: () => true,
      fetchPage: async () => { calls += 1; throw new CourtListenerRateLimited(120_000); },
      persist: async () => "existing",
    }, 5);
    expect(calls).toBe(1);
    expect(outcome.stoppedBy).toBe("rate_limited");
    expect(outcome.rateLimitedUntil!.getTime()).toBeGreaterThan(Date.now() + 100_000);
    expect(outcome.cursor.modifiedAfter).toBe("2026-10-30T00:00:00Z");
    expect(outcome.cursor.next).toBeNull();
  });
});
