import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CIRCUIT_ADAPTERS, circuitAdapter, dedupeAdapterItems, easternDate, type AdapterItem } from "./adapters";
import { trimToPdfHeader } from "../../../../../scripts/run-appellate-ingestion";

// Saved pages: circuits/* fetched 2026-10-31 (ca4 trimmed to 30 rows; ca10 is the
// Wayback copy of 2026-10-05 because the live feed is empty on weekends).
const FIXTURES = join(__dirname, "../../live-feeds/fixtures");
const page = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const NOW = new Date("2026-10-31T12:00:00Z");

const SAVED: Record<string, string[]> = {
  ca1: ["circuits/ca1-opinions.html"],
  ca2: ["circuits/ca2-search.html", "circuits/ca2-search.html"],
  ca3: ["circuits/ca3-recop.xml", "circuits/ca3-recprec.htm", "circuits/ca3-recnonprec.htm"],
  ca4: ["circuits/ca4-recent.html"],
  ca5: ["ca5-opinions.rss.xml"],
  ca6: ["circuits/ca6-week.html"],
  ca7: ["circuits/ca7-week.html"],
  ca8: ["circuits/ca8-todayopn.html"],
  ca9: ["circuits/ca9-ops.xml", "circuits/ca9-mem.xml"],
  ca10: ["circuits/ca10-daily-2026-10-05.rss.xml"],
  ca11: ["circuits/ca11-publog.html", "circuits/ca11-unpublog.html"],
  cadc: ["circuits/cadc-rss.xml"],
  cafc: ["cafc-feed.rss.xml"],
};

function run(court: string): { perRequest: number[]; items: AdapterItem[] } {
  const adapter = circuitAdapter(court)!;
  const requests = adapter.requests(NOW);
  expect(requests).toHaveLength(SAVED[court]!.length);
  const perRequest: number[] = [];
  const all: AdapterItem[] = [];
  requests.forEach((request, index) => {
    const items = adapter.parse(page(SAVED[court]![index]!), request);
    perRequest.push(items.length);
    all.push(...items);
  });
  return { perRequest, items: dedupeAdapterItems(all) };
}

const EXPECTED: Record<string, { perRequest: number[]; total: number; first: Partial<AdapterItem> }> = {
  ca1: { perRequest: [20], total: 20, first: { docketNumber: "25-1101", caption: "US v. Newton", releasedOn: "2026-10-29",
    documentUrl: "https://www.ca1.uscourts.gov/sites/ca1/files/opnfiles/25-1101P-01A.pdf", precedential: true } },
  ca2: { perRequest: [2, 2], total: 2, first: { docketNumber: "25-2652", releasedOn: "2026-10-27",
    documentUrl: "https://ww3.ca2.uscourts.gov/decisions/OPN/25-2652_opn.pdf" } },
  ca3: { perRequest: [11, 11, 77], total: 88, first: { docketNumber: "26-2072", releasedOn: "2026-10-19",
    caption: "Holy Trinity Ukrainian Catholic Church v. Township of Collier", documentUrl: "https://www2.ca3.uscourts.gov/opinarch/262072p.pdf" } },
  ca4: { perRequest: [26], total: 26, first: { docketNumber: "24-7194", caption: "Keith Moss v. Joseph Walters", releasedOn: "2026-10-30",
    documentUrl: "https://www.ca4.uscourts.gov/opinions/247194A.U.pdf", precedential: false } },
  ca5: { perRequest: [59], total: 59, first: { docketNumber: "25-60590", caption: "USA v. Seals", precedential: false } },
  ca6: { perRequest: [19], total: 19, first: { docketNumber: "25-3557", caption: "United States v. Jordan Dodd", releasedOn: "2026-10-26",
    documentUrl: "https://www.opn.ca6.uscourts.gov/opinions.pdf/26a0288p-06.pdf", precedential: true } },
  ca7: { perRequest: [20], total: 20, first: { docketNumber: "25-3106", releasedOn: "2026-10-30", precedential: false } },
  ca8: { perRequest: [2], total: 2, first: { docketNumber: "25-1374", caption: "Jarell Terry v. Dexter Payne", releasedOn: "2026-10-30",
    documentUrl: "https://ecf.ca8.uscourts.gov/opndir/26/10/251374P.pdf", precedential: true } },
  ca9: { perRequest: [23, 25], total: 48, first: { docketNumber: "24-5493", releasedOn: "2026-10-30", precedential: true } },
  ca10: { perRequest: [8], total: 8, first: { docketNumber: "22-2132", releasedOn: "2026-06-16", precedential: false,
    documentUrl: "https://ca10.uscourts.gov/sites/ca10/files/opinions/010111452742.pdf" } },
  ca11: { perRequest: [20, 20], total: 40, first: { docketNumber: "24-14049", caption: "USA v. Chadwick Lemaine", precedential: true } },
  cadc: { perRequest: [15], total: 15, first: { docketNumber: "24-5231", caption: "California Valley Miwok Tribe v. Douglas Burgum" } },
  cafc: { perRequest: [20], total: 20, first: { docketNumber: "26-2253", kind: "order",
    documentUrl: "https://www.cafc.uscourts.gov/opinions-orders/26-2253.ORDER.10-29-2026_2778960.pdf" } },
};

describe("per-court appellate adapters", () => {
  it("has an adapter for every court of appeals", () => {
    expect(Object.keys(CIRCUIT_ADAPTERS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const court of Object.keys(EXPECTED)) {
    it(`${court}: reads the saved listing`, () => {
      const { perRequest, items } = run(court);
      const expected = EXPECTED[court]!;
      expect(perRequest).toEqual(expected.perRequest);
      expect(items).toHaveLength(expected.total);
      expect(items.find((item) => item.docketNumber === expected.first.docketNumber)).toMatchObject(expected.first);
      for (const item of items) {
        expect(item.courtCode).toBe(court);
        expect(item.docketNumber).toMatch(/^\d{2}-\d{1,6}$/);
        expect(item.documentUrl).toMatch(/^https:\/\//);
        expect(item.releasedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(item.caption.length).toBeGreaterThan(2);
        // The old shared parser grabbed the next item's docket from 500 chars of context.
        expect(item.caption).not.toMatch(/\b\d{2}-\d{4,6}\b.*\.pdf/i);
      }
    });
  }

  it("ca3: the single-line precedential page keeps each docket with its own caption", () => {
    const { items } = run("ca3");
    const byUrl = new Map(items.map((item) => [item.documentUrl, item]));
    for (const item of byUrl.values()) {
      const digits = item.docketNumber.replace("-", "");
      if (/opinarch\/\d+[pn]\.pdf$/.test(item.documentUrl)) expect(item.documentUrl).toContain(digits);
    }
  });

  it("ca3: makes no conditional requests, so an unchanged-looking page is still read", () => {
    for (const request of circuitAdapter("ca3")!.requests(NOW)) expect(request).not.toHaveProperty("headers");
  });

  it("ca7: asks for the past week relative to now, not a fixed date", () => {
    const [request] = circuitAdapter("ca7")!.requests(NOW);
    expect(request!.url).toContain("Time=week");
    expect(request!.url).not.toMatch(/FromYear|2026/);
  });

  it("ca2: posts a dated search to both decision indexes", () => {
    const requests = circuitAdapter("ca2")!.requests(NOW);
    expect(requests.map((request) => request.method)).toEqual(["POST", "POST"]);
    expect(requests[0]!.body).toContain("OPN");
    expect(requests[1]!.body).toContain("SUM");
    expect(decodeURIComponent(requests[0]!.body!.replaceAll("+", " "))).toContain(`${easternDate(NOW, 7)}~~${easternDate(NOW)}`);
  });

  it("cafc: keys live-feed entries on the original post link so existing entries are not doubled", () => {
    const { items } = run("cafc");
    for (const item of items) {
      expect(item.documentUrl).toMatch(/\.pdf$/);
      expect(item.entryKeyUrl).toMatch(/^https:\/\/www\.cafc\.uscourts\.gov\/[^?]+\/$/);
    }
  });

  it("dedupes the same document listed by two listings", () => {
    const { items } = run("ca3");
    expect(new Set(items.map((item) => item.documentUrl)).size).toBe(items.length);
  });

  it("strips ca7's metadata line in front of the PDF header", () => {
    const body = Buffer.concat([Buffer.from("Cas:25-3106:Typ:ag:Cap:X v Y\n"), Buffer.from("%PDF-1.6\n...")]);
    expect(trimToPdfHeader(body).subarray(0, 5).toString()).toBe("%PDF-");
    const plain = Buffer.from("%PDF-1.4");
    expect(trimToPdfHeader(plain)).toBe(plain);
  });
});
