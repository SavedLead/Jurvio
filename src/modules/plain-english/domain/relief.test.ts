import { describe, expect, it } from "vitest";
import type { PartyRoles } from "./party-roles";
import { buildAppealRelief, buildDocketRelief, buildSupremeRelief, readMotion, readOpinionRequest, readRulings, requestedKinds, rulingFor } from "./relief";

const criminal: PartyRoles = {
  up: { name: "John Smith", role: "appellant", trialRole: "defendant" },
  down: { name: "United States", role: "appellee", trialRole: "prosecution" },
  cross: false,
  source: "opinion",
};

const civil: PartyRoles = {
  up: { name: "Jane Doe", role: "plaintiff", trialRole: "plaintiff" },
  down: { name: "Acme Corp.", role: "defendant", trialRole: "defendant" },
  cross: false,
  source: "caption",
};

describe("requested relief", () => {
  it("reads the kinds of relief named in a request", () => {
    expect(requestedKinds("vacate his conviction and remand for a new trial")).toEqual(["conviction", "new-trial"]);
    expect(requestedKinds("reverse the district court's judgment")).toEqual(["judgment"]);
    expect(requestedKinds("vacate his sentence and remand for resentencing")).toEqual(["sentence", "resentencing"]);
    expect(requestedKinds("direct the district court to enter a judgment of acquittal")).toEqual(["acquittal"]);
    expect(requestedKinds("consider the record as a whole")).toEqual([]);
  });

  it("finds the appellant's stated request in the opinion's opening", () => {
    const head = "OPINION. John Smith appeals his conviction for wire fraud. He asks us to vacate his conviction and order a new trial. We affirm.";
    expect(readOpinionRequest(head, criminal)).toMatchObject({ kinds: ["conviction", "new-trial"], side: "up" });
  });

  it("reads 'X appeals his conviction and sentence' as a challenge to both", () => {
    const request = readOpinionRequest("Defendant-Appellant John Smith appeals his conviction and sentence for bank robbery.", criminal);
    expect(request).toMatchObject({ kinds: ["conviction", "sentence"], side: "up" });
  });

  it("ignores requests it cannot tie to a side, negated requests, dissents and amici", () => {
    expect(readOpinionRequest("Someone else asks us to vacate the conviction.", criminal)).toBeNull();
    expect(readOpinionRequest("John Smith does not ask us to vacate his conviction.", criminal)).toBeNull();
    expect(readOpinionRequest("I would vacate the conviction. He asks us to vacate it.", criminal)).toBeNull();
    expect(readOpinionRequest("Amicus asks us to reverse the judgment.", criminal)).toBeNull();
    expect(readOpinionRequest("He asks us to vacate his conviction.", criminal)).toBeNull(); // pronoun with no appeal sentence before it
    expect(readOpinionRequest("John Smith asks us to vacate his conviction.", { ...criminal, cross: true })).toBeNull();
  });
});

describe("rulings in the court's closing words", () => {
  it("reads a ruling for each point", () => {
    const closing = "We AFFIRM Smith's conviction, VACATE his sentence, and REMAND for resentencing.";
    expect(rulingFor("conviction", closing)).toBe("denied");
    expect(rulingFor("sentence", closing)).toBe("granted");
    expect(rulingFor("resentencing", closing)).toBe("granted");
    expect(rulingFor("new-trial", closing)).toBeNull();
  });

  it("keeps 'affirm the denial of a new trial' apart from ordering one", () => {
    expect(rulingFor("new-trial", "We affirm the district court's denial of Smith's motion for a new trial.")).toBe("denied");
    expect(rulingFor("new-trial", "We reverse the denial of the motion for a new trial.")).toBe("granted");
    expect(rulingFor("new-trial", "The convictions are reversed and the case is remanded for a new trial.")).toBe("granted");
    expect(rulingFor("conviction", "The convictions are reversed and the case is remanded for a new trial.")).toBe("granted");
  });
});

describe("appeal relief summary", () => {
  const head = "John Smith appeals his conviction for wire fraud. He asks us to throw out the conviction and order a new trial.";

  it("writes the user's example: asked for two things, won one and lost one", () => {
    const summary = buildAppealRelief({
      courtKind: "appellate",
      roles: criminal,
      outcome: "mixed",
      closing: "We affirm the conviction. Because the jury was misinstructed on the forfeiture count, we remand for a new trial on that count.",
      closingSource: null,
      opinionHead: "John Smith appeals his conviction for wire fraud. He asks us to set aside the conviction and order a new trial.",
      opinionPath: "/case/jv-x/documents/jv-y",
    });
    expect(summary.text).toBe("John Smith (the appellant) asked the court to throw out the conviction and order a new trial. The court ordered a new trial but refused to throw out the conviction. So John Smith won on some points and lost on others.");
    expect(summary.items.map((item) => item.result)).toEqual(["denied", "granted"]);
  });

  it("an affirmance in full turns down every stated request", () => {
    const summary = buildAppealRelief({ courtKind: "appellate", roles: criminal, outcome: "affirmed", closing: "AFFIRMED.", closingSource: null, opinionHead: head, opinionPath: null });
    expect(summary.items.map((item) => item.result)).toEqual(["denied", "denied"]);
    expect(summary.text).toContain("refused to throw out the conviction and order a new trial");
    expect(summary.text).toContain("lost on every point");
  });

  it("a reversal sets aside the conviction but does not by itself say there will be a new trial", () => {
    const summary = buildAppealRelief({ courtKind: "appellate", roles: criminal, outcome: "reversed", closing: "REVERSED.", closingSource: null, opinionHead: head, opinionPath: null });
    expect(summary.items.map((item) => item.result)).toEqual(["granted", "not-shown"]);
    expect(summary.text).toContain("The court threw out the conviction.");
    expect(summary.text).toContain("don't say whether it agreed to order a new trial");
    expect(summary.text).not.toContain("So John Smith");
  });

  it("with no stated request, lists only the court's point-by-point rulings and says the request isn't spelled out", () => {
    const summary = buildAppealRelief({ courtKind: "appellate", roles: criminal, outcome: "mixed", closing: "We affirm the conviction but vacate the sentence and remand for resentencing.", closingSource: null, opinionHead: "Background facts only.", opinionPath: null });
    expect(summary.text).toContain("As the appellant, John Smith asked the appeals court to overturn the lower court's decision.");
    expect(summary.text).toContain("doesn't spell out the exact relief requested");
    expect(summary.text).toContain("it kept the conviction in place, threw out the sentence, and ordered a new sentencing");
    expect(summary.items.every((item) => item.askedBy === null)).toBe(true);
  });

  it("with no roles and no request, says so instead of guessing", () => {
    const summary = buildAppealRelief({ courtKind: "appellate", roles: null, outcome: "affirmed", closing: "AFFIRMED.", closingSource: null, opinionHead: null, opinionPath: null });
    expect(summary.text).toMatch(/^The opinion text we have doesn't say exactly what each side asked for/);
    expect(summary.items).toEqual([]);
  });
});

describe("docket motions and rulings", () => {
  it("reads a motion and who filed it", () => {
    expect(readMotion({ entryNumber: 12, filedOn: "2024-01-05", description: "MOTION to Dismiss for Failure to State a Claim by Acme Corp.. (Attachments: # 1 Exhibit)(Lee, Ann) (Entered: 01/05/2024)" }))
      .toMatchObject({ type: "dismiss", by: "Acme Corp.", entryNumber: 12 });
    expect(readMotion({ entryNumber: 20, filedOn: null, description: "MOTION for Summary Judgment filed by Plaintiff Jane Doe." })).toMatchObject({ type: "summary-judgment", by: "Jane Doe" });
    expect(readMotion({ entryNumber: 21, filedOn: null, description: "MOTION for Leave to File Excess Pages by Jane Doe" })).toBeNull();
    expect(readMotion({ entryNumber: 22, filedOn: null, description: "SEALED MOTION to Dismiss by Acme Corp." })).toBeNull();
  });

  it("reads orders granting or denying motions by number", () => {
    expect(readRulings({ entryNumber: 30, filedOn: "2024-03-01", description: "ORDER granting in part and denying in part 12 Motion to Dismiss; denying 20 Motion for Summary Judgment. Signed by Judge X." }))
      .toMatchObject([{ refersTo: 12, result: "partly", type: "dismiss" }, { refersTo: 20, result: "denied", type: "summary-judgment" }]);
    expect(readRulings({ entryNumber: 31, filedOn: null, description: "ORDER: Defendant's Motion to Dismiss [12] is GRANTED." })).toMatchObject([{ refersTo: 12, result: "granted" }]);
    expect(readRulings({ entryNumber: 32, filedOn: null, description: "NOTICE of appearance granting nothing" })).toEqual([]);
    expect(readRulings({ entryNumber: 33, filedOn: null, description: "ORDER granting 5 Motion to Seal." })).toEqual([]);
  });

  it("pairs motions with rulings and writes plain sentences", () => {
    const summary = buildDocketRelief({
      roles: civil,
      docketPath: "/case/jv-d/docket",
      entries: [
        { entryNumber: 30, filedOn: "2024-03-01", description: "ORDER granting in part and denying in part 12 Motion to Dismiss. Signed by Judge X." },
        { entryNumber: 20, filedOn: "2024-02-01", description: "MOTION for Summary Judgment by Jane Doe." },
        { entryNumber: 12, filedOn: "2024-01-05", description: "MOTION to Dismiss for Failure to State a Claim by Acme Corp." },
      ],
    });
    expect(summary?.text).toBe("Jane Doe (the plaintiff) asked the court to decide the case without a trial (summary judgment). The records we have show no ruling on it yet. Acme Corp. (the defendant) asked the court to dismiss the case (a motion to dismiss). The court granted it in part and denied it in part.");
    expect(summary?.items.map((item) => item.result)).toEqual(["pending", "partly"]);
  });

  it("returns nothing when the docket shows no motions", () => {
    expect(buildDocketRelief({ roles: civil, docketPath: null, entries: [{ entryNumber: 1, filedOn: null, description: "COMPLAINT against Acme Corp." }] })).toBeNull();
  });
});

describe("Supreme Court relief", () => {
  const roles: PartyRoles = { up: { name: "Loper Bright Enterprises", role: "petitioner", trialRole: null }, down: { name: "Raimondo", role: "respondent", trialRole: null }, cross: false, source: "court-record" };
  const questions = { questions: ["Whether, under a proper application of Chevron, …", "Whether the Court should overrule Chevron …"], grantedLimitedTo: [2], sourceUrl: "https://www.supremecourt.gov/qp/22-00451qp.pdf" };

  it("lists the questions, the limited grant, and who got what", () => {
    const summary = buildSupremeRelief({ roles, lowerCourt: "the United States Court of Appeals for the District of Columbia Circuit", questions, status: "decided", outcome: "vacated" });
    expect(summary.text).toContain("Loper Bright Enterprises (the petitioner) asked the Supreme Court to review and overturn the decision of the United States Court of Appeals for the District of Columbia Circuit.");
    expect(summary.text).toContain("decide 2 questions");
    expect(summary.text).toContain("agreed to decide only question 2");
    expect(summary.text).toContain("Loper Bright Enterprises won, at least for now");
    expect(summary.quotes).toHaveLength(2);
  });

  it("cert denied: the petitioner got nothing and the questions were not answered", () => {
    const summary = buildSupremeRelief({ roles, lowerCourt: null, questions: null, status: "denied", outcome: null });
    expect(summary.text).toContain("refused to take the case (denied certiorari)");
    expect(summary.items[0]?.result).toBe("denied");
  });

  it("says when the questions presented are missing", () => {
    expect(buildSupremeRelief({ roles: null, lowerCourt: null, questions: null, status: "decided", outcome: "affirmed" }).text)
      .toContain("We don't have the petition's questions presented");
  });
});
