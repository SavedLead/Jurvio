import { describe, expect, it } from "vitest";
import { buildCaseTitle, courtAbbreviation, displayCaption } from "./case-title";

describe("court abbreviations", () => {
  it.each([
    ["Eastern District of California", null, "E.D. Cal."],
    ["District Court, S.D. New York", "nysd", "S.D.N.Y."],
    ["Southern District of New York", null, "S.D.N.Y."],
    ["District of New Jersey", null, "D.N.J."],
    ["District of Massachusetts", null, "D. Mass."],
    ["District of Columbia", null, "D.D.C."],
    ["Northern District of West Virginia", null, "N.D. W. Va."],
    ["Court of Appeals for the Ninth Circuit", null, "9th Cir."],
    ["United States Court of Appeals for the Second Circuit", null, "2d Cir."],
    ["Court of Appeals for the D.C. Circuit", "cadc", "D.C. Cir."],
    ["Court of Appeals for the Federal Circuit", null, "Fed. Cir."],
    ["Supreme Court of the United States", null, "U.S."],
    ["Anything", "caed", "E.D. Cal."],
    ["Anything", "ca3", "3d Cir."],
    ["Anything", "prd", "D.P.R."],
    ["Anything", "nmd", "D.N.M."],
    ["United States Bankruptcy Court, District of Delaware", null, null],
    ["Court of Federal Claims", "uscfc", null],
  ])("%s / %s -> %s", (name, code, expected) => {
    expect(courtAbbreviation(name, code)).toBe(expected);
  });
});

describe("display captions", () => {
  it("builds United States v. <defendant> for bare criminal captions", () => {
    expect(displayCaption("Olsen", "1:26-cr-00123", "district")).toBe("United States v. Olsen");
    expect(displayCaption("USA v. Olsen", "1:26-cr-00123", "district")).toBe("United States v. Olsen");
    expect(displayCaption("United States of America v. Olsen et al", "1:26-cr-00123", "district")).toBe("United States v. Olsen et al");
  });

  it("leaves civil, appellate and non-name captions alone", () => {
    expect(displayCaption("Olsen", "1:26-cv-00123", "district")).toBe("Olsen");
    expect(displayCaption("Mendoza", "5:26-mj-01017", "district")).toBe("United States v. Mendoza");
    expect(displayCaption("(HC) Kumar v. Moss et al", "1:26-cv-08930", "district")).toBe("Kumar v. Moss et al");
    expect(displayCaption("Protest 867200-G of Nippon Trading Co.", "No. 40340", "other")).toBe("Protest 867200-G of Nippon Trading Co.");
    expect(displayCaption("Olsen", "24-1234", "appellate")).toBe("Olsen");
    expect(displayCaption("Sealed", "1:26-cr-00123", "district")).toBe("Sealed");
    expect(displayCaption("In re Grand Jury Subpoena", "1:26-cr-00123", "district")).toBe("In re Grand Jury Subpoena");
    expect(displayCaption("Doe v. Roe", "1:26-cv-1", "district")).toBe("Doe v. Roe");
  });
});

describe("case titles", () => {
  it("matches the requested format", () => {
    expect(buildCaseTitle({ caption: "United States v. Olsen", docketNumber: "1:26-cr-00123", courtName: "Eastern District of California", filedOn: "2026-10-30", decidedOn: null }))
      .toBe("United States v. Olsen, No. 1:26-cr-00123 (E.D. Cal. 2026)");
  });

  it("prefers the decision year and shortens the name before the court", () => {
    const title = buildCaseTitle({
      caption: "National Association of Manufacturers, et al. v. Securities and Exchange Commission, et al.",
      docketNumber: "24-60471",
      courtName: "Court of Appeals for the Fifth Circuit",
      filedOn: "2024-09-01",
      decidedOn: "2025-12-01",
    });
    expect(title.endsWith(", No. 24-60471 (5th Cir. 2025)")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(72);
    expect(title.startsWith("Nat'l Ass'n of")).toBe(true);
    expect(buildCaseTitle({ caption: "Securities and Exchange Commission v. Coinbase, Inc.", docketNumber: "1:23-cv-04738", courtName: "Southern District of New York", filedOn: "2023-06-06", decidedOn: null }))
      .toBe("Sec. & Exch. Comm'n v. Coinbase, No. 1:23-cv-04738 (S.D.N.Y. 2023)");
  });

  it("never cuts a defendant name mid-word", () => {
    expect(buildCaseTitle({ caption: "United States v. Gardea-Gutierrez", docketNumber: "2:26-cr-04445", courtName: "", providerCourtId: "nmd", filedOn: "2026-09-01", decidedOn: null }))
      .toBe("United States v. Gardea-Gutierrez, No. 2:26-cr-04445 (D.N.M. 2026)");
    const long = buildCaseTitle({ caption: "Supercalifragilisticexpialidocious Holdings v. Antidisestablishmentarianism Partners", docketNumber: "1:26-cv-00001", courtName: "", providerCourtId: "nysd", filedOn: "2026-01-01", decidedOn: null });
    expect(long).toMatch(/^Supercalifragilisticexpialidocious… v\. |^Supercalifragilisticexpialidocious Holdings v\. /);
    expect(long.endsWith("(S.D.N.Y. 2026)")).toBe(true);
  });

  it("omits an unknown court rather than guessing", () => {
    expect(buildCaseTitle({ caption: "A v. B", docketNumber: "1", courtName: "Court of Federal Claims", filedOn: "2020-01-01", decidedOn: null }))
      .toBe("A v. B, No. 1 (2020)");
  });
});
