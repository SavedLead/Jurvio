import { describe, expect, it } from "vitest";
import { buildCaseStanding, readDispositionLine, readDocketOutcome, readOpinionClosing, readOverruledParenthetical, readTrialDismissal, type CaseStandingInput } from "./case-standing";

const base: CaseStandingInput = {
  courtKind: "supreme", courtName: "Supreme Court of the United States", caption: "Miranda v. Arizona",
  decidedOn: "1966-06-13", filedOn: null, terminatedOn: null, dispositionScope: "none", verified: true,
  exactDisposition: null, dispositionSourceUrl: null, exactHolding: null, holdingSourceUrl: null, lowerCourtName: null,
  clusterDisposition: null, precedentialStatus: null, opinionTail: null, opinionPath: null, opinionIsMajority: true,
  overruled: null, citedByCount: 0,
};

describe("readDispositionLine", () => {
  it.each([
    ["Judgment REVERSED and case REMANDED. Barrett, J., delivered the opinion for a unanimous Court.", "reversed", true, "Judgment REVERSED and case REMANDED."],
    ["Judgment VACATED and case REMANDED. Thomas, J., delivered the opinion for a unanimous Court.", "vacated", true, undefined],
    ["The judgment of the Court of Appeals is reversed.", "reversed", false, undefined],
    ["Certiorari granted; 529 F. 3d 834, reversed and remanded.", "reversed", true, undefined],
    ["Affirmed.", "affirmed", false, undefined],
    ["[Affirmed.]", "affirmed", false, "Affirmed."],
    ["Modified and affirmed.", "affirmed", false, undefined],
    ["Appeal dismissed.", "dismissed", false, undefined],
    ["Affirmed in part, reversed in part, and remanded.", "mixed", true, undefined],
  ])("%s", (text, kind, remanded, quote) => {
    const reading = readDispositionLine(text, "case-data");
    expect(reading?.kind).toBe(kind);
    expect(reading?.remanded).toBe(remanded);
    if (quote) expect(reading?.quote).toBe(quote);
  });

  it.each([
    "the judgment below should be reversed on this ground.",
    "the judgment ought to be reversed.",
    "Certiorari granted; No. 9, 357 F. 2d 257; No. 14, 361 F. 2d 153;",
    "Decision will be entered under Rule 50.",
    "Decree for complainant.",
    "",
  ])("returns nothing for %j", (text) => {
    expect(readDispositionLine(text, "case-data")).toBeNull();
  });
});

describe("readOpinionClosing", () => {
  it("reads a plain affirmance with trailing boilerplate", () => {
    const reading = readOpinionClosing("ence is substantively reasonable. We therefore affirm the judgment. We dispense with oral argument because the facts and legal contentions are adequately presented. AFFIRMED 3");
    expect(reading?.kind).toBe("affirmed");
  });
  it("joins a reversal with the remand sentence after it", () => {
    const reading = readOpinionClosing("Consequently, the district court's grant of summary judgment for Atlas Air is reversed and this case is remanded for further proceedings consistent with this opinion. It is so ordered.");
    expect(reading).toMatchObject({ kind: "reversed", remanded: true });
  });
  it("reads a mixed result", () => {
    const reading = readOpinionClosing("III. CONCLUSION We affirm the judgment of conviction. We remand the case to the District Court, however, with instructions to vacate appellant's sentence and to resentence appellant.");
    expect(reading?.kind).toBe("mixed");
  });
  it("reads petition-for-review outcomes", () => {
    expect(readOpinionClosing("For the foregoing reasons, Scepter's petition for review is denied and the Board's cross-application for enforcement of its Order is granted.")?.kind).toBe("review-denied");
    expect(readOpinionClosing("Accordingly, Felix's petition for review is granted, the Board's application for enforcement is denied, and this matter is remanded to the Board. So ordered.")?.kind).toBe("review-granted");
  });
  it("ignores dissents, hedges and negations", () => {
    expect(readOpinionClosing("EPA's orders should therefore be vacated. For those reasons, I respectfully dissent.")).toBeNull();
    expect(readOpinionClosing("I would reverse the district court and direct DoD to make these documents public.")).toBeNull();
    expect(readOpinionClosing("We need not reverse on this ground. The remaining issues are not before us.")).toBeNull();
    expect(readOpinionClosing("the disclosure rules are severable from the anti-discrimination rules.")).toBeNull();
  });
});

describe("readOverruledParenthetical", () => {
  it("accepts a leading overruled-by", () => {
    expect(readOverruledParenthetical("overruled by Mapp v. Ohio, 367 U.S. 643 (1961)")).toBe("overruled by Mapp v. Ohio, 367 U.S. 643 (1961)");
  });
  it("rejects negations and statements about other cases", () => {
    expect(readOverruledParenthetical("declining to reach the question of whether Morgan overruled the rule")).toBeNull();
    expect(readOverruledParenthetical("recognizing Jones overruled Steele and Ross")).toBeNull();
    expect(readOverruledParenthetical("prior panel decisions are binding unless overruled by the court en banc")).toBeNull();
  });
});

describe("readTrialDismissal", () => {
  it("finds dismissals and prejudice", () => {
    expect(readTrialDismissal("For these reasons, the motion is granted. The complaint is DISMISSED with prejudice.")).toMatchObject({ withPrejudice: true });
    expect(readTrialDismissal("Plaintiff's claims are hereby dismissed without prejudice. IT IS SO ORDERED.")).toMatchObject({ withPrejudice: false });
    expect(readTrialDismissal("The motion to dismiss is denied.")).toBeNull();
    expect(readTrialDismissal("The complaint should not be dismissed.")).toBeNull();
  });
});

describe("buildCaseStanding", () => {
  it("summarizes a reversed Supreme Court case from the verified record", () => {
    const standing = buildCaseStanding({
      ...base,
      exactDisposition: "The judgment of the Supreme Court of Arizona in No. 759 is reversed.",
      lowerCourtName: "Supreme Court of Arizona",
      exactHolding: "The prosecution may not use statements stemming from custodial interrogation unless it demonstrates procedural safeguards.",
      citedByCount: 12,
    });
    expect(standing?.headline).toBe("The Supreme Court reversed the Supreme Court of Arizona.");
    const text = standing?.points.map((point) => `${point.label} ${point.text} ${point.quote ?? ""}`).join("\n") ?? "";
    expect(text).toContain("usually the party named first (here, Miranda)");
    expect(text).toContain("bind every court");
    expect(text).toContain("What rule did it set?");
    expect(text).toContain("12 later opinions on Jurvio cite it");
    expect(text).toContain("not a guarantee");
  });

  it("does not trust unverified enrichment and says plainly when the judgment is unknown", () => {
    const standing = buildCaseStanding({ ...base, verified: false, exactDisposition: "The judgment is reversed." });
    expect(standing?.headline).toBe("The Supreme Court has decided this case.");
    expect(standing?.points[0]?.text).toContain("cannot say who won");
  });

  it("adds the Supreme Court Database vote when known", () => {
    const standing = buildCaseStanding({ ...base, votes: { majority: 5, minority: 4 } });
    expect(standing?.points[0]?.text).toContain("The Justices voted 5–4, according to the Supreme Court Database.");
    const unanimous = buildCaseStanding({ ...base, exactDisposition: "Affirmed.", votes: { majority: 9, minority: 0 } });
    expect(unanimous?.points[0]?.text).toContain("9–0 (unanimous)");
  });

  it("hides when there is nothing to say", () => {
    expect(buildCaseStanding({ ...base, decidedOn: null })).toBeNull();
    expect(buildCaseStanding({ ...base, courtKind: "district", decidedOn: null })).toBeNull();
  });

  it("uses an appellate opinion's closing line and precedential status, without naming parties", () => {
    const standing = buildCaseStanding({
      ...base, courtKind: "appellate", caption: "United States v. Smith", decidedOn: "2020-01-02",
      opinionTail: "For these reasons, we AFFIRM.", opinionPath: "/case/x/documents/y", precedentialStatus: "Published",
    });
    expect(standing?.headline).toBe("The appeals court upheld the lower court's decision.");
    const text = standing?.points.map((point) => point.text).join(" ") ?? "";
    expect(text).toContain("binding precedent");
    expect(text).not.toContain("United States");
    expect(standing?.points.find((point) => point.id === "decided")?.sourceHref).toBe("/case/x/documents/y");
  });

  it("ignores a dissent's closing line", () => {
    const standing = buildCaseStanding({ ...base, courtKind: "appellate", opinionIsMajority: false, opinionTail: "We reverse." });
    expect(standing?.points[0]?.text).toContain("cannot say who won");
  });

  it("reports overruled signals with attribution", () => {
    const standing = buildCaseStanding({ ...base, exactDisposition: "Affirmed.", overruled: { text: "overruled by Mapp v. Ohio, 367 U.S. 643 (1961)", citingCaption: "Freeman v. Watkins", citingPath: "/case/jv-1" } });
    const point = standing?.points.find((item) => item.id === "good-law");
    expect(point?.text).toContain("Probably not");
    expect(point?.sourceLabel).toBe("Quoted in Freeman v. Watkins");
  });

  it("district: closed date, no guessed winner", () => {
    const standing = buildCaseStanding({ ...base, courtKind: "district", decidedOn: null, filedOn: "2024-01-01", terminatedOn: "2024-06-01" });
    expect(standing?.headline).toBe("This case is closed.");
    expect(standing?.points.map((point) => point.text).join(" ")).toContain("Jun 1, 2024");
    expect(standing?.points.map((point) => point.text).join(" ")).toContain("cannot say who won");
  });

  it("district criminal case: asks how it ended, not who won", () => {
    const standing = buildCaseStanding({ ...base, courtKind: "district", caption: "USA v. Doe", decidedOn: null, filedOn: "2024-01-01" });
    expect(standing?.points.find((point) => point.id === "who-won")?.label).toBe("How did it end?");
    expect(standing?.headline).toBe("No final ruling in Jurvio's records.");
  });

  it("district: quotes a dismissal from the court's opinion", () => {
    const standing = buildCaseStanding({ ...base, courtKind: "district", decidedOn: null, filedOn: "2024-01-01", opinionTail: "The complaint is DISMISSED with prejudice.", opinionPath: "/d" });
    expect(standing?.points.find((point) => point.id === "decided")?.text).toContain("cannot be filed again");
  });
});

describe("readDocketOutcome", () => {
  const entries = [
    { filedOn: "2024-01-15", description: "COMPLAINT filed by Jane Doe against Acme Corp." },
    { filedOn: "2024-03-01", description: "MOTION to Dismiss for Failure to State a Claim by Acme Corp." },
    { filedOn: "2024-09-30", description: "MEMORANDUM OPINION and ORDER granting motion to dismiss. Claims are dismissed with prejudice. Civil case terminated." },
    { filedOn: "2024-09-30", description: "JUDGMENT entered in favor of Acme Corp. and against Jane Doe." },
  ];
  it("prefers a same-day judgment naming the winner", () => {
    expect(readDocketOutcome(entries)).toMatchObject({ kind: "judgment", winner: "Acme Corp.", filedOn: "2024-09-30" });
  });
  it("falls back to the dismissal order", () => {
    expect(readDocketOutcome(entries.slice(0, 3))).toMatchObject({ kind: "dismissal", withPrejudice: true });
  });
  it("ignores motions and denials", () => {
    expect(readDocketOutcome(entries.slice(0, 2))).toBeNull();
    expect(readDocketOutcome([{ filedOn: "2024-01-01", description: "ORDER: the complaint will not be dismissed." }])).toBeNull();
    expect(readDocketOutcome([{ filedOn: "2024-01-01", description: "MOTION for judgment in favor of plaintiff" }])).toBeNull();
  });
  it("trims the winner's name", () => {
    expect(readDocketOutcome([{ filedOn: "2024-01-01", description: "JUDGMENT in favor of John Roe. Signed by Judge X." }])).toMatchObject({ winner: "John Roe" });
    expect(readDocketOutcome([{ filedOn: "2024-01-01", description: "CLERK'S JUDGMENT in favor of Defendants, against Plaintiff" }])).toMatchObject({ winner: "Defendants" });
  });
  it("reads voluntary dismissals", () => {
    expect(readDocketOutcome([{ filedOn: "2024-01-01", description: "NOTICE of Voluntary Dismissal by Jane Doe" }])?.kind).toBe("voluntary");
  });
  it("feeds the district summary", () => {
    const standing = buildCaseStanding({ ...base, courtKind: "district", decidedOn: null, filedOn: "2024-01-15", terminatedOn: "2024-09-30", docketEntries: entries, docketPath: "/case/x/docket" });
    const won = standing?.points.find((point) => point.id === "who-won");
    expect(won?.text).toContain("judgment in favor of Acme Corp. In the docket's words:");
    expect(won?.sourceLabel).toBe("From the court's docket, Sep. 30, 2024");
  });
});
