import { describe, expect, it } from "vitest";
import { DISTRICT_COURTS, courtFromField, findCourtMentions } from "./federal-courts";
import { findDistrictDockets, normalizedDocketKeys } from "./district-docket";
import { extractCaseReferences, restrictedReason } from "./extract";
import { documentKind } from "./item";

const now = new Date("2026-10-31T12:00:00Z");
const codes = (text: string) => findCourtMentions(text).map((mention) => mention.code);
const dockets = (text: string) => findDistrictDockets(text, now).map((docket) => docket.canonical);

describe("district courts", () => {
  it("covers all 94 districts with Bluebook abbreviations", () => {
    expect(DISTRICT_COURTS.size).toBe(94);
    expect(DISTRICT_COURTS.get("nysd")?.abbreviation).toBe("S.D.N.Y.");
    expect(DISTRICT_COURTS.get("caed")?.abbreviation).toBe("E.D. Cal.");
    expect(DISTRICT_COURTS.get("wvnd")?.name).toBe("Northern District of West Virginia");
  });

  it("reads courts by name and abbreviation, never a district that does not exist", () => {
    expect(codes("filed in the U.S. District Court for the District of South Carolina")).toEqual(["scd"]);
    expect(codes("(D.S.C. filed Oct. 29, 2026)")).toEqual(["scd"]);
    expect(codes("S.D.N.Y., E.D. Cal., D. Mass., N.D. Ohio, W.D. Va., D.D.C., S.D. N.Y.")).toEqual(["nysd", "caed", "mad", "ohnd", "vawd", "dcd", "nysd"]);
    expect(codes("Eastern District of North Carolina and the Northern District of West Virginia")).toEqual(["nced", "wvnd"]);
    expect(codes("District of California")).toEqual([]);
    expect(codes("Court of Appeals for the District of Columbia Circuit")).toEqual([]);
    expect(courtFromField("Northern District of Ohio")).toBe("ohnd");
    expect(courtFromField("Northern District of Ohio; Southern District of Ohio")).toBeNull();
  });
});

describe("district docket numbers", () => {
  it("normalizes the forms agencies write", () => {
    expect(dockets("Urich, 6:26-cv-05267-JDA (D.S.C.")).toEqual(["6:26-cv-05267"]);
    expect(dockets("No. 5:26-CR-194-FL-RJ. and No. 7:26-CR-25-FL-BM-1.")).toEqual(["5:26-cr-00194", "7:26-cr-00025"]);
    expect(dockets("case 26-cr-80031 and 25-CR-2060")).toEqual(["26-cr-80031", "25-cr-02060"]);
    expect(dockets("26 Civ. 1234 and 26 Cr. 55; CR 26-00123; 1:26cv2615")).toEqual(["26-cv-01234", "26-cr-00055", "26-cr-00123", "1:26-cv-02615"]);
  });

  it("ignores statutes, phone numbers and Court of Federal Claims numbers", () => {
    expect(dockets("18 U.S.C. 1343, call 555-123-4567, No. 16-259C, in 2026 cv")).toEqual([]);
  });

  it("only tries the stated office, and every office when none is stated", () => {
    expect(normalizedDocketKeys({ office: "5", year: "26", caseType: "cr", sequence: "00194" })).toContain("526cr00194");
    expect(normalizedDocketKeys({ office: "5", year: "26", caseType: "cr", sequence: "00194" })).not.toContain("126cr00194");
    expect(normalizedDocketKeys({ office: null, year: "26", caseType: "cr", sequence: "80031" })).toEqual(expect.arrayContaining(["926cr80031", "26cr80031"]));
  });
});

describe("court + docket references", () => {
  it("uses the Bluebook parenthetical after the docket", () => {
    const [reference] = extractCaseReferences("SEC v. Urich, 6:26-cv-05267-JDA (D.S.C. filed Oct. 29, 2026). Also the Southern District of New York.", now);
    expect(reference).toMatchObject({ courtCode: "scd", courtEvidence: "(D.S.C. filed Oct. 29, 2026)" });
  });

  it("uses the only court a document names", () => {
    const refs = extractCaseReferences("Heekin, United States Attorney for the Northern District of Florida. Case No. 4:26-cr-00012", now);
    expect(refs.map((ref) => [ref.courtCode, ref.docket.canonical])).toEqual([["flnd", "4:26-cr-00012"]]);
  });

  it("pairs each docket with the court named just before it", () => {
    const refs = extractCaseReferences("referrals in the Northern District of Texas, No. 3:26-cv-1979, and in the District of New Jersey, No. 3:26-cv-13625.", now);
    expect(refs.map((ref) => ref.courtCode)).toEqual(["txnd", "njd"]);
  });

  it("leaves the court empty when the document does not settle it", () => {
    const refs = extractCaseReferences("The Southern District of Texas and the Western District of Texas worked together. Charged in No. 4:26-cr-00001 and No. 5:26-cr-00002 respectively, the defendants were the subject of a long investigation by many agencies across several states, which took several years in total to complete before charges were brought.", now);
    expect(refs.map((ref) => ref.courtCode)).toEqual([null, null]);
  });

  it("flags sealed and juvenile material but not unsealed filings", () => {
    expect(restrictedReason("The indictment was unsealed today")).toBeNull();
    expect(restrictedReason("a federal grand jury returned an indictment")).toBeNull();
    expect(restrictedReason("the complaint was filed under seal")).toBe("sealed material referenced");
    expect(restrictedReason("Sealed indictment")).toBe("sealed material referenced");
    expect(restrictedReason("a juvenile defendant")).toBe("juvenile proceeding");
  });

  it("names a document kind only from its own label", () => {
    expect(documentKind("Plea Agreement")).toBe("plea_agreement");
    expect(documentKind("Complaint for Permanent Injunction")).toBe("complaint");
    expect(documentKind("Download", "https://www.justice.gov/media/1/dl")).toBe("document");
    expect(documentKind("Stipulated Order for Permanent Injunction and Monetary Judgment")).toBe("order");
    expect(documentKind("Memorandum in Support of Plaintiff's Motion for a Temporary Restraining Order")).toBe("motion");
  });
});
