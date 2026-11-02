import { describe, expect, it } from "vitest";
import { buildCaseStanding, readDispositionLine, readSyllabusDisposition, readDocketOutcome, readOpinionClosing, readOverruledParenthetical, readTrialDismissal, type CaseStandingInput } from "./case-standing";

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

const ZHAO_HEAD = "Case: 19-3071 Document: 40 Filed: 06/29/2020 Pages: 15 In the United States Court of Appeals For the Seventh Circuit ____________________ No. 19‐3071 YONG JUAN ZHAO, on behalf of her minor son, Plaintiff‐Appellee, v. UNITED STATES OF AMERICA, Defendant‐Appellant. ____________________ Appeal from the United States District Court for the Southern District of Illinois. No. 3:17‐cv‐00454‐NJR‐GCS — Nancy J. Rosenstengel, Chief Judge. ____________________ ARGUED JUNE 5, 2020 — DECIDED JUNE 29, 2020 ____________________ Before EASTERBROOK, HAMILTON, and SCUDDER, Circuit Judges. HAMILTON, Circuit Judge. This is an appeal from a Federal Tort Claims Act judgment in favor of the plaintiff. When plaintiff Yong Juan Zhao gave birth to her son, he suffered an avoidable injury.";

const CELOTEX_HEAD = "477 U.S. 317 (1986) CELOTEX CORP. v. CATRETT, ADMINISTRATRIX OF THE ESTATE OF CATRETT No. 85-198. Supreme Court of United States. Argued April 1, 1986 Decided June 25, 1986 CERTIORARI TO THE UNITED STATES COURT OF APPEALS FOR THE DISTRICT OF COLUMBIA CIRCUIT Leland S. Van Koten argued the cause for petitioner. JUSTICE REHNQUIST delivered the opinion of the Court. The United States District Court for the District of Columbia granted the motion of petitioner Celotex Corporation for summary judgment against respondent Catrett because the latter was unable to produce evidence in support of her allegation. The Court of Appeals for the District of Columbia Circuit reversed, however, holding that petitioner's failure to support its motion with evidence tending to negate such exposure precluded the entry of summary judgment in its favor.";

const CELOTEX_REAL = "CELOTEX CORP. v. CATRETT Syllabus CELOTEX CORP. v. CATRETT, ADMINISTRATRIX OF THE ESTATE OF CATRETT CERTIORARI TO THE UNITED STATES COURT OF APPEALS FOR THE DISTRICT OF COLUMBIA CIRCUIT No. 85-198. Argued April 1, 1986-Decided June 25, 1986 In September 1980, respondent administratrix filed this wrongful-death action in Federal District Court. In July 1982, the court granted the motion because there was no showing of exposure to petitioner's products, but the Court of Appeals reversed, holding that summary judgment in peti- tioner's favor was precluded. Held: 1. The Court of Appeals' position is inconsistent with the standard for summary judgment. Pp. 322-326. 2. The question should be determined by the Court of Appeals in the first instance. Pp. 326- 327. 244 U. S. App. D. C. 160 , 756 F. 2d 181 , reversed and remanded. REHNQUIST, J., delivered the opinion of the Court, in which WHITE, MARSHALL, POWELL, and O'CONNOR, JJ., joined.";

describe("readSyllabusDisposition", () => {
  it("reads the judgment words that end a U.S. Reports syllabus", () => {
    expect(readSyllabusDisposition(CELOTEX_REAL)).toMatchObject({ kind: "reversed", remanded: true, quote: "Reversed and remanded.", source: "syllabus" });
    expect(readSyllabusDisposition("Held: the statute applies. Pp. 3-9. 500 F. 3d 1, affirmed. SCALIA, J., delivered the opinion of the Court.")).toMatchObject({ kind: "affirmed" });
    expect(readSyllabusDisposition("Certiorari granted. SCALIA, J., delivered the opinion of the Court.")).toBeNull();
  });

  it("feeds a Supreme Court summary when the closing line is missing, with the lower court's ruling", () => {
    const standing = buildCaseStanding({ ...base, verified: false, caption: "Celotex Corp. v. Catrett", decidedOn: "1986-06-25", opinionHead: CELOTEX_REAL, opinionPath: "/o" });
    expect(standing?.headline).toBe("The Supreme Court overturned the lower court's decision — a win for Celotex Corp., at least for now.");
    expect(standing?.points.find((point) => point.id === "decided")?.sourceLabel).toBe("From the official syllabus (U.S. Reports)");
    expect(standing?.points.find((point) => point.id === "lower")?.quote).toContain("but the Court of Appeals reversed, holding that summary judgment in petitioner's favor was precluded");
  });
});

describe("readOpinionClosing (reporter hyphenation)", () => {
  it("joins words split across lines", () => {
    expect(readOpinionClosing("The judgment of the Court of Appeals is accordingly re- versed, and the case is remanded for further proceedings consistent with this opinion. It is so ordered.")).toMatchObject({ kind: "reversed", remanded: true });
  });
});

describe("buildCaseStanding", () => {
  it("summarizes a reversed Supreme Court case from the verified record, naming who won", () => {
    const standing = buildCaseStanding({
      ...base,
      exactDisposition: "The judgment of the Supreme Court of Arizona in No. 759 is reversed.",
      lowerCourtName: "Supreme Court of Arizona",
      exactHolding: "The prosecution may not use statements stemming from custodial interrogation unless it demonstrates procedural safeguards.",
      citedByCount: 12,
      citedByPath: "#cited-by",
    });
    expect(standing?.headline).toBe("The Supreme Court overturned the lower court's decision — a win for Miranda.");
    const text = standing?.points.map((point) => `${point.label} ${point.text} ${point.quote ?? ""}`).join("\n") ?? "";
    expect(text).toContain("A win for Miranda (the petitioner, the side that asked the Supreme Court to review the lower court's decision)");
    expect(text).toContain("reversed (overturned) the lower court's decision, a loss for Arizona (the respondent, the side that won in the lower court)");
    expect(text).toContain("The case came from the Supreme Court of Arizona.");
    expect(text).toContain("bind every court");
    expect(text).toContain("What rule did it set?");
    const law = standing?.points.find((point) => point.id === "good-law");
    expect(law?.text).toBe("We found no later Supreme Court decision overruling this case in Jurvio's records. Only the Supreme Court itself can overrule one of its decisions. Our records may be incomplete, so this is not a guarantee.");
    expect(law?.text).not.toMatch(/\d/);
    const cited = standing?.points.find((point) => point.id === "cited");
    expect(cited?.text).toContain("At least 12 later court opinions on Jurvio cite this case.");
    expect(cited?.text).toContain("aren't complete");
    expect(cited?.sourceHref).toBe("#cited-by");
  });

  it("does not trust unverified enrichment and says plainly when the judgment is unknown", () => {
    const standing = buildCaseStanding({ ...base, verified: false, exactDisposition: "The judgment is reversed." });
    expect(standing?.headline).toBe("The Supreme Court has decided this case.");
    expect(standing?.points[0]?.text).toContain("we can't say yet who won");
    expect(standing?.points[0]?.text).not.toMatch(/Jurvio/);
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

  it("Supreme Court from opinion text: cert roles, the lower court's ruling quoted", () => {
    const standing = buildCaseStanding({
      ...base, verified: false, caption: "Celotex Corp. v. Catrett", decidedOn: "1986-06-25",
      clusterDisposition: "Reversed and remanded.", opinionHead: CELOTEX_HEAD, opinionPath: "/case/c/documents/d",
    });
    expect(standing?.headline).toBe("The Supreme Court overturned the lower court's decision — a win for Celotex Corp., at least for now.");
    const won = standing?.points.find((point) => point.id === "who-won")?.text ?? "";
    expect(won).toContain("A win for Celotex Corp. (the petitioner");
    expect(won).toContain("and remanded the case (sent it back to the lower court for more proceedings), a loss for Catrett (the respondent, the side that won in the lower court)");
    const lower = standing?.points.find((point) => point.id === "lower");
    expect(lower?.text).toContain("The case came from the United States Court of Appeals for the District of Columbia Circuit.");
    expect(lower?.quote).toMatch(/^The Court of Appeals for the District of Columbia Circuit reversed, however/);
  });

  it("appeals: names the winner and loser from the opinion's caption block", () => {
    const standing = buildCaseStanding({
      ...base, courtKind: "appellate", courtName: "United States Court of Appeals for the Seventh Circuit", caption: "Yong Juan Zhao v. USA",
      decidedOn: "2020-06-29", opinionHead: ZHAO_HEAD, opinionTail: "The judgment of the district court is AFFIRMED.", opinionPath: "/case/x/documents/y", precedentialStatus: "Published",
    });
    expect(standing?.headline).toBe("The appeals court agreed with the lower court — a win for Yong Juan Zhao.");
    const won = standing?.points.find((point) => point.id === "who-won")?.text;
    expect(won).toBe("A win for Yong Juan Zhao (the appellee, the side that won in the lower court, and the plaintiff in the trial court). The appeals court affirmed (agreed with the lower court and left its ruling in place), so the United States (the appellant, the side that appealed, and the defendant in the trial court) lost the appeal.");
    const lower = standing?.points.find((point) => point.id === "lower");
    expect(lower?.text).toBe("The case came from the United States District Court for the Southern District of Illinois. In the opinion's words:");
    expect(lower?.quote).toBe("This is an appeal from a Federal Tort Claims Act judgment in favor of the plaintiff.");
    const law = standing?.points.find((point) => point.id === "good-law");
    expect(law?.text).toContain("We found no later decision by the Supreme Court or the full Seventh Circuit (sitting en banc) overruling this case");
    expect(standing?.points.map((point) => point.text).join(" ")).toContain("binding precedent");
  });

  it("appeals without a caption block: says what we know and that the record doesn't name sides", () => {
    const standing = buildCaseStanding({
      ...base, courtKind: "appellate", caption: "United States v. Smith", decidedOn: "2020-01-02",
      opinionTail: "For these reasons, we AFFIRM.", opinionPath: "/case/x/documents/y",
    });
    expect(standing?.headline).toBe("The appeals court agreed with the lower court.");
    const won = standing?.points.find((point) => point.id === "who-won")?.text ?? "";
    expect(won).toContain("A win for the appellee (the side that won in the lower court)");
    expect(won).toContain("Our records don't say which party is on which side.");
    expect(won).not.toContain("Smith");
  });

  it("cross-appeals have no single winner", () => {
    const head = "No. 18-1234 ACME CORP., Plaintiff-Appellant, Cross-Appellee, v. BETA LLC, Defendant-Appellee, Cross-Appellant. Appeal from the United States District Court for the District of Delaware.";
    const standing = buildCaseStanding({ ...base, courtKind: "appellate", caption: "Acme Corp. v. Beta LLC", opinionHead: head, opinionTail: "AFFIRMED." });
    expect(standing?.points.find((point) => point.id === "who-won")?.text).toMatch(/^Both sides appealed \(cross-appeals\)/);
    expect(standing?.headline).toBe("The appeals court agreed with the lower court.");
  });

  it("ignores a dissent's closing line", () => {
    const standing = buildCaseStanding({ ...base, courtKind: "appellate", opinionIsMajority: false, opinionTail: "We reverse." });
    expect(standing?.points[0]?.text).toContain("can't say yet who won");
  });

  it("counts an overruling only from a court that can overrule the case", () => {
    const supremeHit = { text: "overruled by Mapp v. Ohio, 367 U.S. 643 (1961)", citingCaption: "Freeman v. Watkins", citingPath: "/case/jv-1" };
    const lowerCourt = { text: "overruled by Smith v. Jones, 123 F.3d 456 (9th Cir. 1997)", citingCaption: "X v. Y", citingPath: "/case/jv-2" };
    const standing = buildCaseStanding({ ...base, exactDisposition: "Affirmed.", overruled: [lowerCourt, supremeHit] });
    const point = standing?.points.find((item) => item.id === "good-law");
    expect(point?.text).toContain("Probably not");
    expect(point?.quote).toBe(supremeHit.text);
    expect(point?.sourceLabel).toBe("Quoted in Freeman v. Watkins");
    const onlyLower = buildCaseStanding({ ...base, exactDisposition: "Affirmed.", overruled: [lowerCourt] });
    expect(onlyLower?.points.find((item) => item.id === "good-law")?.text).toMatch(/^We found no later Supreme Court decision overruling this case/);
    const appellate = buildCaseStanding({ ...base, courtKind: "appellate", courtName: "United States Court of Appeals for the Ninth Circuit", opinionTail: "AFFIRMED.", overruled: [{ ...lowerCourt, text: "overruled by Smith v. Jones, 123 F.3d 456 (9th Cir. 1997) (en banc)" }] });
    expect(appellate?.points.find((item) => item.id === "good-law")?.text).toContain("Probably not");
  });

  it("district: closed date, no guessed winner", () => {
    const standing = buildCaseStanding({ ...base, courtKind: "district", decidedOn: null, filedOn: "2024-01-01", terminatedOn: "2024-06-01" });
    expect(standing?.headline).toBe("This case is closed, but the court records we have don't say how it ended.");
    expect(standing?.points.map((point) => point.text).join(" ")).toContain("Jun 1, 2024");
    expect(standing?.points.map((point) => point.text).join(" ")).toContain("don't say how it ended or who won");
  });

  it("district criminal case: asks how it ended, not who won", () => {
    const standing = buildCaseStanding({ ...base, courtKind: "district", caption: "USA v. Doe", decidedOn: null, filedOn: "2024-01-01" });
    expect(standing?.points.find((point) => point.id === "who-won")?.label).toBe("How did it end?");
    expect(standing?.headline).toBe("This case is still open — no final decision yet.");
  });

  it("district: quotes a dismissal from the court's opinion", () => {
    const standing = buildCaseStanding({ ...base, courtKind: "district", caption: "Jane Doe v. Acme Corp.", decidedOn: null, filedOn: "2024-01-01", opinionTail: "The complaint is DISMISSED with prejudice.", opinionPath: "/d" });
    const decided = standing?.points.find((point) => point.id === "decided")?.text;
    expect(decided).toContain("cannot be filed again");
    expect(decided).toContain("a loss for Jane Doe (the plaintiff)");
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
    const standing = buildCaseStanding({ ...base, courtKind: "district", caption: "Jane Doe v. Acme Corp.", decidedOn: null, filedOn: "2024-01-15", terminatedOn: "2024-09-30", docketEntries: entries, docketPath: "/case/x/docket" });
    const won = standing?.points.find((point) => point.id === "who-won");
    expect(won?.text).toBe("Acme Corp. (the defendant). The court entered judgment (its final decision) in favor of Acme Corp., against Jane Doe. In the docket's words:");
    expect(standing?.headline).toBe("The court ruled for Acme Corp. (the defendant).");
    expect(won?.sourceLabel).toBe("From the court's docket, Sep. 30, 2024");
  });
});

describe("official outcome sources", () => {
  const docket = {
    certStatus: "denied" as const, certStatusOn: "2020-04-06", certEntry: "Petition DENIED.", judgmentOn: null, judgmentEntry: null,
    petitioner: "Jeffrey Lance Hill, Sr.", respondent: "Leandra G. Johnson, et al.",
    lowerCourt: "United States Court of Appeals for the Eleventh Circuit", lowerCourtDecidedOn: "2019-09-20",
    lastEntryOn: "2020-06-01", fetchedAt: "2026-11-01 19:00:00-05", sourceUrl: "https://www.supremecourt.gov/search.aspx?filename=/docket/docketfiles/html/public/19-994.html",
  };
  const cert: CaseStandingInput = { ...base, caption: "Jeffrey Lance Hill, Sr., Petitioner v. Leandra G. Johnson, et al.", decidedOn: null, verified: false, scotusDocket: docket };

  it("cert denied: the lower court's ruling stands, named sides, official docket quoted", () => {
    const standing = buildCaseStanding(cert);
    expect(standing?.headline).toBe("The Supreme Court declined to hear this case, so the lower court's ruling stands.");
    const who = standing?.points.find((point) => point.id === "who-won")?.text ?? "";
    expect(who).toContain("A win for Leandra G. Johnson and others (the respondent, the side that won in the lower court)");
    expect(who).toContain("denied certiorari (refused to review the case) on Apr 6, 2020");
    expect(who).toContain("the decision of the United States Court of Appeals for the Eleventh Circuit stands");
    expect(who).toContain("a loss for Jeffrey Lance Hill, Sr. (the petitioner");
    const decided = standing?.points.find((point) => point.id === "decided");
    expect(decided).toMatchObject({ quote: "Petition DENIED.", sourceHref: docket.sourceUrl });
    expect(standing?.points.find((point) => point.id === "means")?.text).toContain("not a ruling on who was right");
    expect(standing?.points.some((point) => point.id === "good-law")).toBe(false);
    expect(standing?.points.find((point) => point.id === "lower")?.text).toContain("which decided it on Sep. 20, 2019");
  });

  it("judgment from the official docket when the opinion line is missing", () => {
    const standing = buildCaseStanding({ ...cert, caption: "Philip Morris USA v. Williams", scotusDocket: { ...docket, certStatus: "granted", judgmentOn: "2007-02-20",
      judgmentEntry: "Judgment VACATED and case REMANDED.", petitioner: "Philip Morris USA", respondent: "Mayola Williams, Personal Representative of the Estate of Jesse D. Williams, Deceased", lowerCourt: "Supreme Court of Oregon" } });
    expect(standing?.headline).toBe("The Supreme Court canceled the lower court's decision — a win for Philip Morris USA, at least for now.");
    expect(standing?.points.find((point) => point.id === "decided")).toMatchObject({ quote: "Judgment VACATED and case REMANDED.", sourceLabel: "From the Supreme Court's official docket, Feb. 20, 2007" });
    expect(standing?.points.some((point) => point.id === "good-law")).toBe(true);
  });

  it("granted and not yet decided; a stale pending petition says nothing", () => {
    const granted = buildCaseStanding({ ...cert, scotusDocket: { ...docket, certStatus: "granted", certStatusOn: "2026-10-10", certEntry: "Petition GRANTED.", lastEntryOn: "2026-10-10" } });
    expect(granted?.headline).toBe("The Supreme Court agreed to hear this case and has not decided it yet.");
    expect(buildCaseStanding({ ...cert, scotusDocket: { ...docket, certStatus: "pending", lastEntryOn: "2004-01-01" } })).toBeNull();
  });

  const fjcBase: CaseStandingInput = { ...base, courtKind: "district", courtName: "District Court, E.D. Pennsylvania", caption: "Wild Leitz USA, Inc. v. Affordable Instruments Supply",
    decidedOn: null, filedOn: "1989-10-11", terminatedOn: null, verified: false, opinionIsMajority: false };
  const fjc = { terminatedOn: "1989-11-24", disposition: 4, judgment: 1, plaintiff: "WILD LEITZ USA, INC.", defendant: "AFFORDABLE INSTRUMENTS SUPPLY", snapshotDate: "2026-09-30" };

  it("district: FJC disposition and judgment name the winner", () => {
    const standing = buildCaseStanding({ ...fjcBase, fjcOutcome: fjc });
    expect(standing?.headline).toBe("The court ruled for Wild Leitz USA, Inc. (the plaintiff).");
    const who = standing?.points.find((point) => point.id === "who-won");
    expect(who?.text).toContain("by default judgment (the defendant did not respond to the lawsuit), against Affordable Instruments Supply (the defendant)");
    expect(who?.sourceHref).toBe("https://www.fjc.gov/research/idb");
    expect(standing?.points.find((point) => point.id === "status")?.text).toBe("No. The court closed this case on Nov. 24, 1989.");
  });

  it("district: an FJC match names the winner even when the case record has no filed or closed date", () => {
    const standing = buildCaseStanding({ ...fjcBase, filedOn: null, terminatedOn: null, fjcOutcome: { ...fjc, judgment: 2, disposition: 6 } });
    expect(standing?.headline).toBe("The court ruled for Affordable Instruments Supply (the defendant).");
    expect(standing?.points.find((point) => point.id === "who-won")?.sourceHref).toBe("https://www.fjc.gov/research/idb");
    expect(standing?.points.find((point) => point.id === "status")?.text).toBe("No. The court closed this case on Nov. 24, 1989.");
    expect(buildCaseStanding({ ...fjcBase, filedOn: null, terminatedOn: null })).toBeNull();
  });

  it("district: a dateless record with an FJC row that yields no outcome stays hidden (never 'still open')", () => {
    expect(buildCaseStanding({ ...fjcBase, caption: "United States v. Dobson", filedOn: null, terminatedOn: null, fjcOutcome: { ...fjc, judgment: 2, disposition: 6 } })).toBeNull();
    expect(buildCaseStanding({ ...fjcBase, filedOn: null, terminatedOn: null, fjcOutcome: { ...fjc, disposition: null } })).toBeNull();
  });

  it("district: settlement, and names withheld when the IDB parties don't match the caption", () => {
    expect(buildCaseStanding({ ...fjcBase, fjcOutcome: { ...fjc, disposition: 13, judgment: null } })?.headline).toBe("The case was settled.");
    const unmatched = buildCaseStanding({ ...fjcBase, fjcOutcome: { ...fjc, judgment: 2, plaintiff: "SOMEONE ELSE", defendant: "OTHER PARTY" } });
    expect(unmatched?.headline).toBe("The court ruled for the defendant.");
    const swapped = buildCaseStanding({ ...fjcBase, fjcOutcome: { ...fjc, judgment: 2, plaintiff: "AFFORDABLE INSTRUMENTS SUPPLY", defendant: "WILD LEITZ USA, INC." } });
    expect(swapped?.headline).toBe("The court ruled for Wild Leitz USA, Inc. (the defendant).");
  });

  it("district: a docket judgment still wins over the FJC statistics", () => {
    const standing = buildCaseStanding({ ...fjcBase, fjcOutcome: { ...fjc, judgment: 2 }, docketEntries: [{ filedOn: "1989-11-24", description: "JUDGMENT entered in favor of Wild Leitz USA, Inc. against Affordable Instruments Supply." }] });
    expect(standing?.headline).toBe("The court ruled for Wild Leitz USA (the plaintiff).");
    expect(standing?.points.find((point) => point.id === "who-won")?.sourceHref).not.toBe("https://www.fjc.gov/research/idb");
  });
});

describe("phase 6: what each side asked for, and what they got", () => {
  const appeal: CaseStandingInput = {
    ...base, courtKind: "appellate", courtName: "United States Court of Appeals for the Seventh Circuit", caption: "United States v. Smith",
    decidedOn: "2020-05-01", verified: false, dispositionScope: null,
    opinionHead: "UNITED STATES OF AMERICA, Plaintiff-Appellee, v. JOHN SMITH, Defendant-Appellant. Appeal from the United States District Court. John Smith appeals his conviction for wire fraud. He asks us to set aside his conviction and order a new trial.",
    opinionTail: "For these reasons, we AFFIRM Smith's conviction. Because the jury was misinstructed on forfeiture, we REMAND for a new trial on the forfeiture count.",
    opinionPath: "/case/jv-a/documents/jv-b",
  };

  it("appeals: lists the request and the ruling on each point, right after who won", () => {
    const standing = buildCaseStanding(appeal);
    const ids = standing?.points.map((point) => point.id);
    expect(ids?.indexOf("asked")).toBe(ids!.indexOf("who-won") + 1);
    const asked = standing?.points.find((point) => point.id === "asked");
    expect(asked?.text).toContain("Smith (the appellant) asked the court to throw out the conviction and order a new trial.");
    expect(asked?.text).toContain("The court ordered a new trial but refused to throw out the conviction.");
    expect(asked?.items?.map((item) => [item.label, item.badge])).toEqual([["Throw out the conviction", "Lost"], ["Order a new trial", "Won"]]);
    expect(asked?.quotes?.[0]?.text).toBe("He asks us to set aside his conviction and order a new trial.");
    // Won one request, lost the other: the summary does not call it a plain affirmance.
    expect(standing?.headline).toBe("The appeals court gave each side part of what it wanted.");
    expect(standing?.points.find((point) => point.id === "who-won")?.text).toMatch(/^Neither side won completely/);
    expect(standing?.points.find((point) => point.id === "means")?.text).toMatch(/^Part of the lower court's ruling stands and part was changed/);
  });

  it("district: motions and rulings from the public docket; sealed entries are never read", () => {
    const standing = buildCaseStanding({
      ...base, courtKind: "district", courtName: "District Court, N.D. Ill.", caption: "Jane Doe v. Acme Corp.", decidedOn: null, filedOn: "2023-01-01", terminatedOn: "2024-03-02",
      verified: false, opinionIsMajority: false, docketPath: "/case/jv-d/docket",
      docketEntries: [
        { entryNumber: "40", filedOn: "2024-03-02", description: "ORDER granting 12 Motion to Dismiss. Civil case terminated." },
        { entryNumber: "15", filedOn: "2024-01-10", description: "SEALED MOTION for Preliminary Injunction by Jane Doe." },
        { entryNumber: "12", filedOn: "2024-01-05", description: "MOTION to Dismiss for Failure to State a Claim by Acme Corp." },
      ],
    });
    const asked = standing?.points.find((point) => point.id === "asked");
    expect(asked?.text).toBe("Acme Corp. (the defendant) asked the court to dismiss the case (a motion to dismiss). The court granted it.");
    expect(JSON.stringify(standing)).not.toMatch(/SEALED|Preliminary Injunction/i);
  });

  it("district with an outcome but no motions says so plainly", () => {
    const standing = buildCaseStanding({
      ...base, courtKind: "district", courtName: "District Court, D. Mass.", caption: "Jane Doe v. Acme Corp.", decidedOn: null, filedOn: "2023-01-01", terminatedOn: "2024-03-02",
      verified: false, opinionIsMajority: false,
      docketEntries: [{ entryNumber: 30, filedOn: "2024-03-02", description: "JUDGMENT entered in favor of Acme Corp. against Jane Doe." }],
    });
    expect(standing?.points.find((point) => point.id === "asked")?.text).toMatch(/^The court records we have don't show the requests each side made/);
  });

  it("Supreme Court: questions presented and the Court's answer to the request", () => {
    const standing = buildCaseStanding({
      ...base, caption: "Loper Bright Enterprises v. Raimondo", exactDisposition: "Judgment VACATED and case REMANDED.",
      questionsPresented: { questions: ["Whether the MSA implicitly grants NMFS the power …", "Whether the Court should overrule Chevron …"], grantedLimitedTo: [2], sourceUrl: "https://www.supremecourt.gov/qp/22-00451qp.pdf" },
      scotusDocket: { certStatus: "granted", certStatusOn: "2023-05-01", certEntry: null, judgmentOn: "2024-06-28", judgmentEntry: null, petitioner: "Loper Bright Enterprises, et al.", respondent: "Gina Raimondo, Secretary of Commerce, et al.", lowerCourt: "United States Court of Appeals for the District of Columbia Circuit", lowerCourtDecidedOn: null, lastEntryOn: null, fetchedAt: null, sourceUrl: "https://www.supremecourt.gov/docket" },
    });
    const asked = standing?.points.find((point) => point.id === "asked");
    expect(asked?.text).toContain("asked the Supreme Court to review and overturn the decision of the United States Court of Appeals for the District of Columbia Circuit");
    expect(asked?.text).toContain("agreed to decide only question 2");
    expect(asked?.quotes?.map((quote) => quote.sourceHref)).toEqual(["https://www.supremecourt.gov/qp/22-00451qp.pdf", "https://www.supremecourt.gov/qp/22-00451qp.pdf"]);
  });
});
