import { describe, expect, it } from "vitest";
import { fjcIdbCaseKey, fjcIdbParties, fjcIdbRowSchema } from "./bulk-fjc-idb";

function row(overrides: Record<string, string> = {}) {
  return fjcIdbRowSchema.parse({
    id: "17442742",
    office: "2",
    docket_number: "8907217",
    date_filed: "1989-10-05",
    date_terminated: "1989-11-15",
    plaintiff: "A.T. CHADWICK CO., INC.",
    defendant: "DEZCON CONTRACTORS, INC.",
    circuit_id: "ca3",
    district_id: "paed",
    ...overrides,
  });
}

describe("FJC Integrated Database bulk rows", () => {
  it("reads the district, office, docket core, and filing year a row addresses", () => {
    expect(fjcIdbCaseKey(row())).toEqual({
      districtCode: "paed",
      office: "2",
      docketCore: "8907217",
      filingYear: 1989,
    });
  });

  it("keeps both party names with the roles the FJC assigned", () => {
    expect(fjcIdbParties(row())).toEqual([
      { role: "plaintiff", nameAsFiled: "A.T. CHADWICK CO., INC." },
      { role: "defendant", nameAsFiled: "DEZCON CONTRACTORS, INC." },
    ]);
  });

  it("preserves a truncated historical name verbatim rather than expanding it", () => {
    expect(fjcIdbParties(row({ defendant: "SOUTH TEX SPOR" }))[1])
      .toEqual({ role: "defendant", nameAsFiled: "SOUTH TEX SPOR" });
  });

  it("omits a side the source left blank instead of inventing one", () => {
    expect(fjcIdbParties(row({ plaintiff: "" }))).toEqual([
      { role: "defendant", nameAsFiled: "DEZCON CONTRACTORS, INC." },
    ]);
  });

  it("rejects a row whose docket core contradicts its filing date", () => {
    // Core says 1989, date_filed says 1990: the row cannot address a case.
    expect(fjcIdbCaseKey(row({ date_filed: "1990-10-05" }))).toBeNull();
  });

  it("rejects rows that cannot address a case at all", () => {
    expect(fjcIdbCaseKey(row({ district_id: "" }))).toBeNull();
    expect(fjcIdbCaseKey(row({ docket_number: "89-7217" }))).toBeNull();
    expect(fjcIdbCaseKey(row({ date_filed: "" }))).toBeNull();
  });

  it("normalizes a padded office number and drops a non-numeric one", () => {
    expect(fjcIdbCaseKey(row({ office: "02" }))?.office).toBe("2");
    expect(fjcIdbCaseKey(row({ office: "" }))?.office).toBeNull();
  });
});
