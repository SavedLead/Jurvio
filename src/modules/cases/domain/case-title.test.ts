import { describe, expect, it } from "vitest";
import { buildCaseTitle, caseCitationSuffix, cleanCaptionText, courtAbbreviation, displayCaption, docketNumberYear } from "./case-title";

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
    // Shortened by party and abbreviation, never cut with an ellipsis.
    expect(title).toBe("Nat'l Ass'n of Mfrs. v. Sec. & Exch. Comm'n, No. 24-60471 (5th Cir. 2025)");
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

describe("caption fixes (warrants, count prefixes, entities)", () => {
  it("does not build United States v. for warrant / in rem magistrate captions", () => {
    const raw = "1 One Electronic Device for Evidence of Violations of 18 U.S.C. &#x26;#167; 2252A";
    expect(displayCaption(raw, "5:26-mj-70358", "district")).toBe("1 One Electronic Device for Evidence of Violations of 18 U.S.C. § 2252A");
    expect(displayCaption("Black Apple iPhone", "2:26-mj-00001", "district")).toBe("Black Apple iPhone");
    expect(displayCaption("123 Main Street Premises", "2:26-mj-00001", "district")).toBe("123 Main Street Premises");
    expect(displayCaption("Google Account foo@example.com", "2:26-mj-00001", "district")).toBe("Google Account foo@example.com");
  });

  it("strips PACER defendant-number prefixes and normalizes USA", () => {
    expect(displayCaption("1 USA v. Nino-Rojas", "3:26-mj-04918", "district")).toBe("United States v. Nino-Rojas");
    expect(displayCaption("2 United States of America v. Doe", "1:26-cr-00001", "district")).toBe("United States v. Doe");
  });
});

describe("audit caption cleanup", () => {
  it("drops trailing provider tags, decodes entities once and drops a dangling leading v.", () => {
    expect(cleanCaptionText("ZENTIAN LTD. v. APPLE INC. [OPINION]")).toBe("ZENTIAN LTD. v. APPLE INC.");
    expect(cleanCaptionText("Doe v. Roe [UNPUBLISHED] [ORDER]")).toBe("Doe v. Roe");
    expect(cleanCaptionText("IN RE APPLE INC.&amp;#039;S APPLICATION")).toBe("IN RE APPLE INC.'S APPLICATION");
    expect(cleanCaptionText("IN RE APPLE INC.&#039;S APPLICATION")).toBe("IN RE APPLE INC.'S APPLICATION");
    expect(cleanCaptionText("v. IN RE APPLE INC.")).toBe("IN RE APPLE INC.");
    expect(cleanCaptionText("Smith v. [Redacted] Corp.")).toBe("Smith v. [Redacted] Corp.");
    expect(displayCaption("ZENTIAN LTD. v. APPLE INC. [OPINION]", "24-2205", "appellate")).toBe("ZENTIAN LTD. v. APPLE INC.");
  });

  it("falls back to the docket-number year when the record has no dates", () => {
    expect(docketNumberYear("1:20-cv-00706", new Date("2026-11-01T00:00:00Z"))).toBe("2020");
    expect(docketNumberYear("2:26-cv-12729", new Date("2026-11-01T00:00:00Z"))).toBe("2026");
    expect(docketNumberYear("1:98-cr-00001", new Date("2026-11-01T00:00:00Z"))).toBe("1998");
    expect(docketNumberYear("24-2205")).toBeNull();
  });

  it("does not put a future filed year in the title when the docket year is known", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(caseCitationSuffix({
      docketNumber: "1:83-cv-00594",
      courtName: "District of New Hampshire",
      filedOn: "2027-09-29",
      decidedOn: null,
    }, now)).toBe(", No. 1:83-cv-00594 (D.N.H. 1983)");
  });

  it("shortens agency captions by party, never with an ellipsis, and always keeps the year", () => {
    const title = buildCaseTitle({
      caption: "Federal Trade Commission et al v. Vyera Pharmaceuticals, LLC et al",
      docketNumber: "1:20-cv-00706",
      courtName: "Southern District of New York",
      providerCourtId: "nysd",
      filedOn: null,
      decidedOn: null,
    });
    expect(title).toBe("Federal Trade Comm'n v. Vyera Pharms., No. 1:20-cv-00706 (S.D.N.Y. 2020)");
    expect(title).not.toContain("…");
  });

  it("keeps a long two-party name whole up to the hard limit instead of cutting a party", () => {
    const title = buildCaseTitle({
      caption: "Acme Widget Holdings Group v. Metropolitan Transit Partners",
      docketNumber: "1:24-cv-01234",
      courtName: "Southern District of New York",
      filedOn: "2024-02-01",
      decidedOn: null,
    });
    expect(title).not.toContain("…");
    expect(title.endsWith(", No. 1:24-cv-01234 (S.D.N.Y. 2024)")).toBe(true);
  });
});
