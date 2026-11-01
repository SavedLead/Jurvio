import { describe, expect, it } from "vitest";
import { caseNewsTerms, courtFamily, courtTermsFor, describeParty, docketPatterns, searchable } from "./case-terms";

describe("describeParty", () => {
  it("reduces organizations to their headline name", () => {
    expect(describeParty("UBER TECHNOLOGIES, INC., ET AL.")).toMatchObject({ key: "Uber Technologies", kind: "organization", distinctiveness: 1 });
    expect(describeParty("PRESIDENT AND FELLOWS OF HARVARD COLLEGE")).toMatchObject({ anchor: "Harvard", kind: "organization" });
  });
  it("treats governments and serial official defendants as weak evidence", () => {
    expect(describeParty("USA")).toMatchObject({ key: null, kind: "government" });
    expect(describeParty("USA").aliases).toContain("Justice Department");
    expect(describeParty("CITY OF SEATTLE")).toMatchObject({ key: "Seattle", kind: "government", distinctiveness: 0.3 });
    expect(describeParty("STATE OF CALIFORNIA")).toMatchObject({ key: "California", distinctiveness: 0.2 });
    expect(describeParty("Donald J. Trump").distinctiveness).toBe(0.3);
    expect(describeParty("BONTA").distinctiveness).toBe(0.3);
  });
  it("ranks common surnames below rare ones and drops pseudonyms", () => {
    expect(describeParty("John Smith").distinctiveness).toBe(0.3);
    expect(describeParty("Maria Ordaz-Cortes").distinctiveness).toBe(0.6);
    expect(describeParty("John Doe").key).toBeNull();
  });
  it("recognizes agencies", () => {
    expect(describeParty("SECURITIES AND EXCHANGE COMMISSION")).toMatchObject({ kind: "agency", key: "Securities and Exchange Commission" });
    expect(describeParty("UNITED STATES BUREAU OF RECLAMATION, ET AL.")).toMatchObject({ kind: "agency", key: "Bureau of Reclamation" });
  });
});

describe("courts and dockets", () => {
  it("names courts the way news does", () => {
    expect(courtTermsFor("scotus", "scotus")).toEqual(["Supreme Court"]);
    expect(courtTermsFor("ca9", "United States Court of Appeals for the Ninth Circuit")).toEqual(["Ninth Circuit", "9th Circuit"]);
    expect(courtTermsFor("cadc", "D.C. Circuit")).toEqual(["D.C. Circuit"]);
    expect(courtTermsFor("cand", "United States District Court for the Northern District of California")).toEqual(["Northern District of California"]);
    expect(courtFamily("ca10")).toBe("appeals");
    expect(courtFamily("cand")).toBe("district");
  });
  it("matches district dockets in their common spellings only", () => {
    const { patterns, distinctive } = docketPatterns("3:24-cv-01234-JD");
    expect(distinctive).toBe(true);
    expect(patterns[0]!.test("Case No. 3:24-cv-01234")).toBe(true);
    expect(patterns[0]!.test("filed as 24-cv-1234 in San Francisco")).toBe(true);
    expect(patterns[0]!.test("24-cv-12345")).toBe(false);
  });
  it("needs a No. prefix for short appellate dockets", () => {
    const { patterns, distinctive } = docketPatterns("25-228");
    expect(distinctive).toBe(false);
    expect(patterns[0]!.test("in No. 25-228, the court")).toBe(true);
    expect(patterns[0]!.test("won 25-228 points")).toBe(false);
  });
});

describe("caseNewsTerms", () => {
  it("builds searchable terms for distinctive captions only", () => {
    const uber = caseNewsTerms({ caption: "UBER TECHNOLOGIES, INC., ET AL. V. CITY OF SEATTLE", docketNumber: "25-228", courtCode: "ca9", courtName: "Ninth Circuit" });
    expect(uber.shortName).toBe("Uber Technologies v. Seattle");
    expect(searchable(uber)).toBe(true);
    const criminal = caseNewsTerms({ caption: "USA V. SMITH", docketNumber: "1:26-cr-00012", courtCode: "nysd", courtName: "Southern District of New York" });
    expect(searchable(criminal)).toBe(false);
    const oneSided = caseNewsTerms({ caption: "In re Acme Corp.", docketNumber: "26-1", courtCode: "ca3", courtName: "Third Circuit" });
    expect(searchable(oneSided)).toBe(false);
  });
});
