import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScotusDocketJson } from "./scotus-docket-feed";
import {
  HISTORY_MISS_LIMIT, estimateHistoryHours, historyDocket, initialHistoryCursor, noteProbe, noteSkip, plannedHistoryRanges,
} from "./scotus-official-history";

describe("SCOTUS official history cursor", () => {
  it("plans paid, IFP, and application ranges from 2017 through the given year", () => {
    expect(plannedHistoryRanges(17)).toEqual(["17-1..17-4999", "17-5001..17-9999", "17A1..17A4999"]);
    expect(historyDocket(26, "app", 660)).toBe("26A660");
  });

  it("ends a series after 15 consecutive misses and does not treat a stored docket as a miss", () => {
    let cursor = initialHistoryCursor();
    for (let n = 0; n < HISTORY_MISS_LIMIT; n += 1) cursor = noteProbe(cursor, false, 26);
    expect(cursor.done).toContain("17-paid");
    expect(cursor.series).toBe("ifp");
    expect(cursor.next).toBe(5001);
    expect(cursor.misses).toBe(0);
    cursor = noteSkip(cursor, 26);
    expect(cursor.counts.skipped).toBe(1);
    expect(cursor.misses).toBe(0);
    expect(cursor.next).toBe(5002);
  });

  it("does not invent a completion time before it has sampled a year", () => {
    expect(estimateHistoryHours(initialHistoryCursor(), 26)).toBeNull();
  });
});

describe("SCOTUS docket JSON counsel and filing links", () => {
  it("keeps counsel and Court PDF links and does not invent a checksum", () => {
    const docket = parseScotusDocketJson(JSON.parse(readFileSync(
      "src/modules/ingestion/live-feeds/fixtures/scotus-26-1.json", "utf8",
    )))!;
    expect(docket.counsel).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: "petitioner", name: "Erin E. Murphy", counselOfRecord: true }),
    ]));
    expect(docket.filings[0]?.sourceUrl).toMatch(/^https:\/\/www\.supremecourt\.gov\//);
    expect(JSON.stringify(docket.filings)).not.toMatch(/sha256|checksum/i);
  });
});

describe("history load cannot notify", () => {
  it("does not write alerts or publish cases", () => {
    const source = readFileSync("src/modules/ingestion/live-feeds/scotus-official-history.ts", "utf8");
    expect(source).not.toMatch(/INSERT INTO (entity_alert|docket_entry|direct_court_event|case_follow)/);
    expect(source).not.toMatch(/publication = 'published'/);
    expect(source).toContain("alertsQueued: 0");
    expect(source).toContain("pdfsDownloaded: 0");
  });
});
