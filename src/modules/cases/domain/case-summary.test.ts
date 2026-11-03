import { describe, expect, it } from "vitest";
import { firstSentence, keyDate, standingAfterSummary, summaryFromStanding } from "./case-summary";

describe("case summary card", () => {
  it("cuts at the first real sentence end, not at abbreviations or dates", () => {
    expect(firstSentence("A win for Estate of Jacob Dominguez (the respondent, the side that won in the lower court). The Supreme Court denied certiorari on Feb. 24, 2025, so it stands."))
      .toBe("A win for Estate of Jacob Dominguez (the respondent, the side that won in the lower court).");
    expect(firstSentence("Denied on Feb. 24, 2025 in Miranda v. Arizona by the U.S. Supreme Court.")).toBe("Denied on Feb. 24, 2025 in Miranda v. Arizona by the U.S. Supreme Court.");
    expect(firstSentence("No. The court closed this case on May 22, 2019.")).toBe("No. The court closed this case on May 22, 2019.");
  });

  it("reads who won and what it means from the stands points", () => {
    const summary = summaryFromStanding({ headline: "The court ruled for Toro (the defendant).", points: [
      { id: "status", label: "Is the case still open?", text: "No. The court closed this case on May 22, 2019." },
      { id: "who-won", label: "Who won?", text: "Toro (the defendant). The court entered judgment for the defendant." },
    ] });
    expect(summary).toEqual({ whatHappened: "The court ruled for Toro (the defendant).", whoWon: "Toro (the defendant).", goingForward: "The court closed this case on May 22, 2019.", goingForwardLabel: "Status" });
  });

  it("picks the key date", () => {
    const base = { courtKind: "supreme", decidedOn: null, terminatedOn: null, filedOn: "2024-08-15", fjcClosedOn: null, certStatus: "denied", certStatusOn: "2025-02-24" };
    expect(keyDate(base)).toEqual({ label: "Review denied", date: "2025-02-24" });
    expect(keyDate({ ...base, decidedOn: "2023-06-30" })).toEqual({ label: "Decided", date: "2023-06-30" });
    expect(keyDate({ ...base, courtKind: "district", certStatus: null, certStatusOn: null, fjcClosedOn: "2019-05-22" })).toEqual({ label: "Closed", date: "2019-05-22" });
    expect(keyDate({ ...base, courtKind: "district", certStatus: null, certStatusOn: null })).toEqual({ label: "Filed", date: "2024-08-15" });
  });
});

describe("each fact once: stands minus the summary card", () => {
  const pina = { headline: "The Supreme Court declined to hear this case, so the lower court's ruling stands.", points: [
    { id: "who-won" as const, label: "Who won?", text: "A win for Estate (the respondent). The Supreme Court denied certiorari on Feb. 24, 2025, so it stands. That is a loss for Pina." },
    { id: "lower" as const, label: "Where did the case come from?", text: "The Ninth Circuit." },
    { id: "decided" as const, label: "What did the Supreme Court do?", text: "In the docket:", quote: "Petition DENIED.", sourceLabel: "Docket", sourceHref: "https://www.supremecourt.gov/x" },
    { id: "means" as const, label: "What does it mean?", text: "Turning down a case is not a ruling on who was right. It only leaves the lower court's decision in place." },
  ] };

  it("keeps only what the card does not say, under a new label", () => {
    const after = standingAfterSummary(pina)!;
    const card = summaryFromStanding(pina);
    expect(after.standing.points.map((point) => [point.id, point.label, point.text])).toEqual([
      ["who-won", "More on the outcome", "The Supreme Court denied certiorari on Feb. 24, 2025, so it stands. That is a loss for Pina."],
      ["lower", "Where did the case come from?", "The Ninth Circuit."],
      ["decided", "What did the Supreme Court do?", "In the docket:"],
      ["means", "More on what it means", "It only leaves the lower court's decision in place."],
    ]);
    // Nothing is lost: card sentence + rest = the original text.
    expect(`${card.whoWon} ${after.standing.points[0]!.text}`).toBe(pina.points[0]!.text);
    expect(`${card.goingForward} ${after.standing.points[3]!.text}`).toBe(pina.points[3]!.text);
    expect(after.inside).toEqual(["more on the outcome", "where the case came from", "what the court did", "more on what it means"]);
  });

  it("drops a row the card shows completely, and hands its source to the card", () => {
    const after = standingAfterSummary({ headline: "Closed.", points: [
      { id: "status", label: "Is the case still open?", text: "No. The court closed this case on May 22, 2019." },
      { id: "who-won", label: "Who won?", text: "Toro won.", sourceLabel: "From the FJC", sourceHref: "https://www.fjc.gov/idb" },
    ] })!;
    expect(after.standing.points).toEqual([]);
    expect(after.whoWonSource).toEqual({ label: "From the FJC", href: "https://www.fjc.gov/idb" });
    expect(after.goingForwardSource).toBeNull();
  });

  it("keeps a quote under the outcome row even when the text is one sentence", () => {
    const after = standingAfterSummary({ headline: "h", points: [{ id: "who-won", label: "Who won?", text: "Toro.", quote: "Judgment for defendant." }] })!;
    expect(after.standing.points[0]).toMatchObject({ label: "More on the outcome", text: "", quote: "Judgment for defendant." });
  });
});
