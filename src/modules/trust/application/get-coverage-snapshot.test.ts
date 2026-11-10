import { describe, expect, it } from "vitest";
import {
  classifyCourts,
  describeBlocker,
  formatCoverageRange,
  publishedCasesFromFamilies,
  summarizeFamily,
} from "./get-coverage-snapshot";

const court = (code: string, publishedCases: number, earliest?: string, latest?: string) => ({
  code,
  publishedCases,
  earliestFiledOn: earliest ?? null,
  latestFiledOn: latest ?? null,
});

describe("court family roll-up", () => {
  it("uses the sum of the family rows as the single published-case total", () => {
    const families = classifyCourts(
      [court("scotus", 40_082), court("ca9", 27_439), court("txwd", 24_035), court("cit", 572)],
      ["ca9"],
      ["txwd"],
    );
    expect(publishedCasesFromFamilies(families)).toBe(40_082 + 27_439 + 24_035 + 572);
  });

  it("reports the tracked roster as the denominator, not just what has records", () => {
    const families = classifyCourts(
      [court("scotus", 21_418, "1790-02-01", "2026-09-01"), court("txwd", 71_662, "1998-04-02", "2026-09-06")],
      ["ca1", "ca2"],
      ["txwd", "nysd", "akd"],
    );
    const district = families.find((family) => family.key === "district");
    // The honest shape: 1 of 3 covered, not "1 district court covered".
    expect(district).toMatchObject({ courtsWithRecords: 1, courtsTracked: 3, publishedCases: 71_662 });

    const appellate = families.find((family) => family.key === "appellate");
    expect(appellate).toMatchObject({ courtsWithRecords: 0, courtsTracked: 2, publishedCases: 0 });
  });

  it("keeps a tracked family visible even when it has no records at all", () => {
    const families = classifyCourts([], ["ca1"], ["akd"]);
    expect(families.map((family) => family.key)).toEqual(["supreme", "appellate", "district"]);
    expect(families.every((family) => family.publishedCases === 0)).toBe(true);
  });

  it("drops the unrostered 'other' bucket only when it is empty", () => {
    expect(classifyCourts([], [], []).some((family) => family.key === "other")).toBe(false);
    const withOther = classifyCourts([court("cit", 12)], [], []);
    expect(withOther.find((family) => family.key === "other")).toMatchObject({
      publishedCases: 12,
      courtsTracked: null,
    });
  });

  it("spans the earliest and latest filing across the family", () => {
    const family = summarizeFamily(
      "appellate",
      "Courts of Appeals",
      [court("ca5", 10, "1970-01-05", "2020-01-05"), court("ca9", 4, "1991-01-05", "2026-01-05")],
      13,
    );
    expect(family.earliestFiledOn).toBe("1970-01-05");
    expect(family.latestFiledOn).toBe("2026-01-05");
  });

  it("does not invent a range when no case carries a filing date", () => {
    const family = summarizeFamily("supreme", "SCOTUS", [court("scotus", 5)], 1);
    expect(family.earliestFiledOn).toBeNull();
    expect(formatCoverageRange(family.earliestFiledOn, family.latestFiledOn)).toBe("Unknown");
  });
});

describe("coverage presentation", () => {
  it("renders a range, a single year, or an honest unknown", () => {
    expect(formatCoverageRange("1791-08-01", "2026-09-06")).toBe("1791–2026");
    expect(formatCoverageRange("2026-01-01", "2026-09-06")).toBe("2026");
    expect(formatCoverageRange(null, "2026-09-06")).toBe("Unknown");
  });

  it("explains blockers in reader language and never drops an unknown code", () => {
    expect(describeBlocker("ocr_failed")).toMatch(/could not be read/);
    expect(describeBlocker("some_new_code")).toBe("some new code");
  });
});
