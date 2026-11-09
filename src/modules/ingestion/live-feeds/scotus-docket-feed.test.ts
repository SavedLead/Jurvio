import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOfficialDocket } from "../providers/scotus/official-docket";
import {
  discoverSeries, parseScotusCursor, parseScotusDocketJson, scotusDocketYear, scotusSeries,
  type ScotusDocket, type SeriesCursor,
} from "./scotus-docket-feed";

// Real supremecourt.gov RSS/Cases/JSON responses fetched on 2026-10-30.
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as unknown;

describe("SCOTUS docket JSON", () => {
  it("parses a paid petition with its proceedings", () => {
    const docket = parseScotusDocketJson(fixture("scotus-26-1.json"))!;
    expect(docket.docketNumber).toBe("26-1");
    expect(docket.docketedOn).toBe("2026-07-01");
    expect(docket.caption).not.toMatch(/Petitioners?$/);
    expect(docket.caption).toContain(" v. ");
    expect(docket.entries.length).toBeGreaterThan(0);
    expect(docket.entries[0]!.sourceRecordId).toMatch(/^26-1:event:\d{4}-\d{2}-\d{2}:1$/);
    expect(docket.entries.map((entry) => entry.entryNumber)).toEqual(docket.entries.map((_, index) => String(index + 1)));
  });

  it("parses IFP petitions and applications", () => {
    const ifp = parseScotusDocketJson(fixture("scotus-26-5900.json"))!;
    expect(ifp).toMatchObject({ docketNumber: "26-5900", caseType: "IFP", docketedOn: "2026-10-22",
      caption: "Anesh Gupta v. Walt Disney Company, et al." });
    const application = parseScotusDocketJson(fixture("scotus-26A400.json"))!;
    expect(application.docketNumber).toBe("26A400");
    expect(application.caption.length).toBeGreaterThan(3);
  });

  it("uses the same entry ids as the HTML docket enrichment, so neither duplicates the other", () => {
    const docket = parseScotusDocketJson(fixture("scotus-26-5900.json"))!;
    const html = `<table>${docket.entries.map((entry) => {
      const [y, m, d] = entry.filedOn.split("-");
      const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
      return `<tr><td>${month} ${d} ${y}</td><td>${entry.description}</td></tr>`;
    }).join("")}</table>`;
    const fromHtml = parseOfficialDocket(html, "26-5900", "https://www.supremecourt.gov/docket/docketfiles/html/public/26-5900.html");
    expect(fromHtml.events.map((event) => event.sourceRecordId)).toEqual(docket.entries.map((entry) => entry.sourceRecordId));
  });

  it("rejects things that are not dockets", () => {
    expect(parseScotusDocketJson(null)).toBeNull();
    expect(parseScotusDocketJson({ CaseNumber: "<html>" })).toBeNull();
    expect(parseScotusDocketJson({ CaseNumber: "26-1 ", PetitionerTitle: "" })).toBeNull();
  });
});

describe("SCOTUS series and cursor", () => {
  it("rolls the docket year on July 1", () => {
    expect(scotusDocketYear(new Date("2026-06-30T12:00:00Z"))).toBe(25);
    expect(scotusDocketYear(new Date("2026-07-01T12:00:00Z"))).toBe(26);
    expect(scotusSeries(new Date("2026-10-30T00:00:00Z")).map((series) => series.docket(series.first))).toEqual(["26-1", "26-5001", "26A1"]);
  });

  it("reads a stored cursor defensively", () => {
    expect(parseScotusCursor(null)).toEqual({});
    expect(parseScotusCursor("not json")).toEqual({});
    expect(parseScotusCursor('{"26-paid":{"high":575,"low":"x"}}')).toEqual({ "26-paid": { high: 575, low: null } });
  });
});

function fakeCourt(existing: Set<number>, options: { known?: Set<string>; budget?: number } = {}) {
  const series = scotusSeries(new Date("2026-10-30T00:00:00Z"))[0]!;
  const probed: string[] = [];
  const stored: string[] = [];
  let remaining = options.budget ?? 1_000;
  const deps = {
    canFetch: () => remaining > 0,
    probe: async (docketNumber: string): Promise<ScotusDocket | null> => {
      if (remaining <= 0) throw new Error("scotus_official: budget exhausted (max requests)");
      remaining -= 1;
      probed.push(docketNumber);
      const n = Number(docketNumber.split("-")[1]);
      return existing.has(n) ? { docketNumber, caption: "A v. B", docketedOn: null, caseType: "Paid", lowerCourt: null, entries: [], counsel: [], filings: [] } : null;
    },
    known: async (docketNumber: string) => options.known?.has(docketNumber) ?? false,
    persist: async (docket: ScotusDocket) => { stored.push(docket.docketNumber); },
  };
  return { series, deps, probed, stored };
}

const range = (from: number, to: number) => new Set(Array.from({ length: to - from + 1 }, (_, index) => from + index));

describe("SCOTUS new-docket discovery", () => {
  it("first run finds the frontier quickly and stores newest first", async () => {
    const court = fakeCourt(range(1, 575));
    const result = await discoverSeries(court.series, { high: null, low: null }, court.deps,
      { missesToStop: 5, backfillPerRun: 10, gapTolerance: 3 });
    expect(result.cursor.high).toBe(575);
    expect(court.stored.slice(0, 3)).toEqual(["26-575", "26-574", "26-573"]);
    expect(court.stored).toHaveLength(10);
    expect(result.cursor.low).toBe(566);
    expect(court.probed.length).toBeLessThan(80);
  });

  it("later runs pick up new filings above the watermark, then continue the backfill", async () => {
    const court = fakeCourt(range(1, 580));
    const start: SeriesCursor = { high: 575, low: 566 };
    const result = await discoverSeries(court.series, start, court.deps, { missesToStop: 5, backfillPerRun: 3, gapTolerance: 3 });
    expect(court.stored).toEqual(["26-580", "26-579", "26-578", "26-577", "26-576", "26-565", "26-564", "26-563"]);
    expect(result.cursor).toEqual({ high: 580, low: 563 });
    // 5 new + 5 misses + 3 backfill
    expect(court.probed).toHaveLength(13);
  });

  it("walks past a small gap in numbering above the watermark", async () => {
    const existing = range(1, 40);
    existing.delete(21);
    existing.delete(22);
    const court = fakeCourt(existing);
    const result = await discoverSeries(court.series, { high: 20, low: 1 }, court.deps, { missesToStop: 5, backfillPerRun: 0, gapTolerance: 3 });
    expect(result.cursor.high).toBe(40);
    expect(court.stored[0]).toBe("26-40");
    expect(court.stored).toHaveLength(18);
  });

  it("backfill skips dockets Jurvio already has without a request", async () => {
    const court = fakeCourt(range(1, 40), { known: new Set(["26-39", "26-38"]) });
    const result = await discoverSeries(court.series, { high: 40, low: 40 }, court.deps, { missesToStop: 1, backfillPerRun: 2, gapTolerance: 3 });
    expect(court.probed).toEqual(["26-41", "26-37", "26-36"]);
    expect(court.stored).toEqual(["26-37", "26-36"]);
    expect(result.cursor).toEqual({ high: 40, low: 36 });
  });

  it("keeps what it learned when the budget runs out mid-run", async () => {
    const court = fakeCourt(range(1, 600), { budget: 4 });
    const result = await discoverSeries(court.series, { high: 575, low: 500 }, court.deps);
    expect(result.cursor.high).toBe(579);
    expect(court.stored).toEqual(["26-579", "26-578", "26-577", "26-576"]);
  });

  it("an empty series (early July) costs a few probes and stores nothing", async () => {
    const court = fakeCourt(new Set());
    const result = await discoverSeries(court.series, { high: null, low: null }, court.deps);
    expect(result).toMatchObject({ found: 0, cursor: { high: null, low: null } });
    expect(court.probed).toHaveLength(3);
  });
});
