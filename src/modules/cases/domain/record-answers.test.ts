import { describe, expect, it } from "vitest";
import {
  buildRecordAnswers,
  cleanCourtName,
  courtKindFromJurisdiction,
  docketCaseType,
  formatCauseOfAction,
  parseNatureOfSuit,
  type RecordAnswerInput,
} from "./record-answers";

const base: RecordAnswerInput = {
  caption: "Doe v. County of Fresno",
  docketNumber: "1:26-cv-08930",
  courtName: "Eastern District of California - Live System",
  courtKind: "district",
  filedOn: "2026-10-30",
  terminatedOn: null,
  decidedOn: null,
  natureOfSuit: "440",
  causeOfAction: "42:1983 Civil Rights Act",
  docketEntryCount: 0,
  citedByCount: 0,
  hasReadableOpinion: false,
};

describe("record answers", () => {
  it("cleans CM/ECF suffixes from court names", () => {
    expect(cleanCourtName("Eastern District of California - Live System")).toBe("Eastern District of California");
    expect(cleanCourtName("District of Columbia")).toBe("District of Columbia");
  });

  it("parses docket types, NOS and cause", () => {
    expect(docketCaseType("1:26-cv-08930")).toBe("cv");
    expect(docketCaseType("2:24-cr-00012-ABC")).toBe("cr");
    expect(docketCaseType("24-1234")).toBeNull();
    expect(parseNatureOfSuit("440")).toEqual({ code: "440", label: "Other civil rights", category: "civil rights" });
    expect(parseNatureOfSuit("830 Patent")?.code).toBe("830");
    expect(parseNatureOfSuit("Civil Rights: Other")).toEqual({ code: null, label: "Civil Rights: Other", category: null });
    expect(parseNatureOfSuit("0")).toBeNull();
    expect(parseNatureOfSuit(null)).toBeNull();
    expect(formatCauseOfAction("42:1983 Civil Rights Act")).toBe("42 U.S.C. § 1983 (Civil Rights Act)");
    expect(formatCauseOfAction("28:1332(a) Diversity-Breach of Contract")).toBe("28 U.S.C. § 1332(a) (Diversity-Breach of Contract)");
    expect(formatCauseOfAction("No cause code entered")).toBeNull();
  });

  it("maps jurisdictions", () => {
    expect(courtKindFromJurisdiction("FD")).toBe("district");
    expect(courtKindFromJurisdiction("F")).toBe("appellate");
    expect(courtKindFromJurisdiction("FS")).toBe("other");
    expect(courtKindFromJurisdiction("F", "Supreme Court of the United States")).toBe("supreme");
    expect(courtKindFromJurisdiction(null, "Court of Appeals for the Ninth Circuit")).toBe("appellate");
  });

  it("builds an open civil case from record fields only", () => {
    const answers = buildRecordAnswers(base);
    expect(answers.happened).toBe(
      "A civil rights case (nature of suit 440, other civil rights) filed on Oct. 30, 2026 in the Eastern District of California by Doe against County of Fresno. No closing date appears in the court record Jurvio holds.",
    );
    expect(answers.about).toBe(
      "The court record classifies this case under nature of suit 440: Other civil rights (civil rights). The cause of action listed is 42 U.S.C. § 1983 (Civil Rights Act).",
    );
    expect(answers.matters).toBeNull();
    expect(answers.outcome).toBeNull();
  });

  it("reports closure without inventing a disposition", () => {
    const answers = buildRecordAnswers({ ...base, terminatedOn: "2027-01-15", citedByCount: 3, docketEntryCount: 2 });
    expect(answers.happened).toContain("closed on Jan. 15, 2027");
    expect(answers.happened).toContain("docket entries Jurvio holds");
    expect(answers.outcome).toContain("closed on Jan. 15, 2027");
    expect(answers.outcome).not.toMatch(/won|lost|granted|dismissed|settled/i);
    expect(answers.matters).toBe("3 court opinions on Jurvio cite this case, which shows other courts have relied on or discussed it.");
  });

  it("describes criminal cases without charges it does not hold", () => {
    const answers = buildRecordAnswers({ ...base, caption: "United States v. Olsen", docketNumber: "2:24-cr-00012", natureOfSuit: null, causeOfAction: null });
    expect(answers.happened).toContain("A federal criminal case filed on Oct. 30, 2026 in the Eastern District of California in which the United States is prosecuting Olsen.");
    expect(answers.about).toContain("federal criminal prosecution");
  });

  it("uses the decision date for appellate opinions and never NOS", () => {
    const answers = buildRecordAnswers({
      ...base,
      caption: "Smith v. Jones",
      docketNumber: "24-1234",
      courtName: "Court of Appeals for the Ninth Circuit",
      courtKind: "appellate",
      filedOn: null,
      decidedOn: "2025-06-02",
      hasReadableOpinion: true,
    });
    expect(answers.happened).toBe("An appeal in the Court of Appeals for the Ninth Circuit between Smith and Jones. The court issued a decision on Jun 2, 2025.");
    expect(answers.about).toBeNull();
    expect(answers.outcome).toBe("The court issued its decision on Jun 2, 2025. The full text of the opinion is available on this page.");
  });

  it("returns nothing when no record fact exists", () => {
    const answers = buildRecordAnswers({ ...base, caption: "Olsen", docketNumber: "x", courtKind: "other", filedOn: null, natureOfSuit: null, causeOfAction: null });
    expect(answers).toEqual({ happened: null, about: null, matters: null, outcome: null });
  });
});

describe("real record shapes", () => {
  it("fills the E.D. Cal. habeas example from caption tag and dates", async () => {
    const { captionTag } = await import("./record-answers");
    const { displayCaption } = await import("./case-title");
    const raw = "(HC) Kumar v. Moss et al";
    const answers = buildRecordAnswers({
      ...base,
      caption: displayCaption(raw, "1:26-cv-08930", "district"),
      natureOfSuit: null,
      causeOfAction: null,
      captionCategory: captionTag(raw),
    });
    expect(answers.happened).toBe(
      "A habeas corpus case filed on Oct. 30, 2026 in the Eastern District of California by Kumar against Moss et al. No closing date appears in the court record Jurvio holds.",
    );
    expect(answers.about).toBe(
      "The court's docket caption marks this as a habeas corpus case: a petition asking the court to decide whether a person's detention is lawful.",
    );
  });

  it("handles PACER NOS prefixes and truncated causes", () => {
    expect(parseNatureOfSuit("2463 Habeas Corpus - Alien Detainees")?.code).toBe("463");
    expect(parseNatureOfSuit("3440 Other Civil Rights")?.label).toBe("Other civil rights");
    expect(parseNatureOfSuit("463 Prisoner: Alien Detainee - Habeas Corpus")?.code).toBe("463");
    expect(formatCauseOfAction("28:2241 Petition for Writ of Habeas Corpus (federa")).toBe("28 U.S.C. § 2241 (Petition for Writ of Habeas Corpus)");
    expect(formatCauseOfAction("28:2241fd Petition for Writ of Habeas Corpus (federal)")).toBe("28 U.S.C. § 2241 (Petition for Writ of Habeas Corpus (federal))");
    expect(formatCauseOfAction("42:2000e Job Discrimination (Employment)")).toBe("42 U.S.C. § 2000e (Job Discrimination (Employment))");
    expect(formatCauseOfAction("28:2241in - Habeas Corpus: INS")).toBe("28 U.S.C. § 2241 (Habeas Corpus: INS)");
  });

  it("uses the opinion date for CourtListener appellate opinions without case dates", () => {
    const answers = buildRecordAnswers({
      ...base, caption: "Smith v. Jones", docketNumber: "18-1234", courtName: "Court of Appeals for the Third Circuit",
      courtKind: "appellate", filedOn: null, natureOfSuit: null, causeOfAction: null, hasReadableOpinion: true, opinionFiledOn: "2019-03-04",
    });
    expect(answers.outcome).toBe("The court issued its decision on Mar 4, 2019. The full text of the opinion is available on this page.");
  });
});

describe("meta description", () => {
  it("puts type, judge and status in the description", async () => {
    const { buildCaseMetaDescription } = await import("./record-answers");
    expect(buildCaseMetaDescription({
      caption: "United States v. Olsen",
      docketNumber: "1:26-cr-00123",
      courtName: "Eastern District of California - Live System",
      courtKind: "district",
      natureOfSuit: null,
      judgeName: "Jane Q. Example",
      filedOn: "2026-10-30",
      terminatedOn: null,
      decidedOn: null,
    })).toBe("United States v. Olsen: federal criminal case in the Eastern District of California, docket 1:26-cr-00123. Judge: Jane Q. Example. Filed Oct. 30, 2026. Status: No closing date on record.");
  });
});

describe("meta description caption tags", () => {
  it("uses the PACER caption tag for the case type", async () => {
    const { buildCaseMetaDescription } = await import("./record-answers");
    expect(buildCaseMetaDescription({
      caption: "Kumar v. Moss et al", docketNumber: "1:26-cv-08930", courtName: "Eastern District of California",
      courtKind: "district", natureOfSuit: null, judgeName: null, filedOn: "2026-10-30", terminatedOn: null, decidedOn: null,
      captionCategory: "habeas corpus",
    })).toContain("Kumar v. Moss et al: habeas corpus case in the Eastern District of California");
  });
});

describe("court phrases and in rem wording", () => {
  it("reads CourtListener court names naturally", async () => {
    const { courtPhrase } = await import("./record-answers");
    expect(courtPhrase("District Court, W.D. Texas")).toBe("the U.S. District Court for the Western District of Texas");
    expect(courtPhrase("District Court, D. Massachusetts")).toBe("the U.S. District Court for the District of Massachusetts");
    expect(courtPhrase("United States Bankruptcy Court, S.D. Florida.")).toBe("the United States Bankruptcy Court for the Southern District of Florida");
    expect(courtPhrase("United States District Court for the Northern District of California")).toBe("the United States District Court for the Northern District of California");
    expect(courtPhrase("Eastern District of California")).toBe("the Eastern District of California");
    expect(courtPhrase("The Court of Federal Claims")).toBe("The Court of Federal Claims");
  });

  it("never says the United States is prosecuting a device", () => {
    const answers = buildRecordAnswers({
      ...base, caption: "United States v. One Electronic Device", docketNumber: "5:26-mj-70358",
      natureOfSuit: null, causeOfAction: null,
    });
    expect(answers.happened).not.toContain("prosecuting");
    expect(answers.happened).toContain("A federal magistrate judge matter");
  });
});
