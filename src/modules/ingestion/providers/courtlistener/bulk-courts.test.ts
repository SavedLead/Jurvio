import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { BulkCsvSource } from "./bulk";
import {
  isFederalCourtJurisdiction,
  readFederalCourtCodes,
  selectFederalCourtCodes,
} from "./bulk-courts";

// A representative slice of real courts-<snapshot>.csv rows: two circuits (F), two
// districts (FD), one special (FS), one bankruptcy (FB), one bankruptcy panel (FBP),
// and three non-federal rows (state supreme S, state appellate SA, state special SS).
const SAMPLE_COURTS = [
  { id: "ca9", jurisdiction: "F" },
  { id: "cadc", jurisdiction: "F" },
  { id: "cand", jurisdiction: "FD" },
  { id: "nysd", jurisdiction: "FD" },
  { id: "cit", jurisdiction: "FS" },
  { id: "ganb", jurisdiction: "FB" },
  { id: "ca9bap", jurisdiction: "FBP" },
  { id: "nc", jurisdiction: "S" },
  { id: "arkctapp", jurisdiction: "SA" },
  { id: "ariztaxct", jurisdiction: "SS" },
];

function fakeSource(csv: string): BulkCsvSource {
  const stream = Readable.from(csv);
  return {
    stream,
    close: () => stream.destroy(),
    completion: Promise.resolve(),
  };
}

describe("isFederalCourtJurisdiction", () => {
  it("accepts appellate/district/special by default and excludes bankruptcy and state", () => {
    expect(isFederalCourtJurisdiction("F", false)).toBe(true);
    expect(isFederalCourtJurisdiction("FD", false)).toBe(true);
    expect(isFederalCourtJurisdiction("FS", false)).toBe(true);
    expect(isFederalCourtJurisdiction("FB", false)).toBe(false);
    expect(isFederalCourtJurisdiction("FBP", false)).toBe(false);
    expect(isFederalCourtJurisdiction("S", false)).toBe(false);
    expect(isFederalCourtJurisdiction("SA", false)).toBe(false);
    expect(isFederalCourtJurisdiction("", false)).toBe(false);
    expect(isFederalCourtJurisdiction(null, false)).toBe(false);
  });

  it("includes bankruptcy only when opted in, never state", () => {
    expect(isFederalCourtJurisdiction("FB", true)).toBe(true);
    expect(isFederalCourtJurisdiction("FBP", true)).toBe(true);
    expect(isFederalCourtJurisdiction("F", true)).toBe(true);
    expect(isFederalCourtJurisdiction("SS", true)).toBe(false);
  });

  it("normalizes case and whitespace", () => {
    expect(isFederalCourtJurisdiction(" fd ", false)).toBe(true);
    expect(isFederalCourtJurisdiction("fb", true)).toBe(true);
  });
});

describe("selectFederalCourtCodes", () => {
  it("returns appellate + district + special, excluding bankruptcy and state by default", () => {
    const codes = selectFederalCourtCodes(SAMPLE_COURTS, false);
    expect([...codes].sort()).toEqual(["ca9", "cadc", "cand", "cit", "nysd"]);
    expect(codes.has("ganb")).toBe(false);
    expect(codes.has("ca9bap")).toBe(false);
    expect(codes.has("nc")).toBe(false);
  });

  it("adds bankruptcy and bankruptcy panels when opted in", () => {
    const codes = selectFederalCourtCodes(SAMPLE_COURTS, true);
    expect([...codes].sort()).toEqual([
      "ca9",
      "ca9bap",
      "cadc",
      "cand",
      "cit",
      "ganb",
      "nysd",
    ]);
    expect(codes.has("nc")).toBe(false);
    expect(codes.has("arkctapp")).toBe(false);
  });
});

describe("readFederalCourtCodes", () => {
  const csv = [
    "id,pacer_court_id,short_name,full_name,url,jurisdiction,date_modified",
    '"ca9","","9th Cir.","United States Court of Appeals for the Ninth Circuit","http://ca9","F","2020-01-01"',
    '"nysd","","S.D.N.Y.","District Court, S.D. New York","http://nysd","FD","2020-01-01"',
    '"cit","","CIT","United States Court of International Trade","http://cit","FS","2020-01-01"',
    '"ganb","54","Bankr. N.D. Ga.","United States Bankruptcy Court, N.D. Georgia","http://ganb","FB","2020-01-01"',
    '"nc","","N.C.","Supreme Court of North Carolina","http://nc","S","2020-01-01"',
  ].join("\n");

  it("streams the courts file and selects federal codes (bankruptcy off)", async () => {
    const codes = await readFederalCourtCodes(fakeSource(csv), { includeBankruptcy: false });
    expect([...codes].sort()).toEqual(["ca9", "cit", "nysd"]);
  });

  it("streams the courts file and includes bankruptcy when opted in", async () => {
    const codes = await readFederalCourtCodes(fakeSource(csv), { includeBankruptcy: true });
    expect([...codes].sort()).toEqual(["ca9", "cit", "ganb", "nysd"]);
  });
});
