import type { CaseStanding } from "@/modules/plain-english/domain/case-standing";

/**
 * The first sentence of a plain-English line. A period ends a sentence only after two lower-case
 * letters or a closing parenthesis, so "Feb. 24", "v. Arizona", "U.S." and "Jr." never cut it short.
 */
export function firstSentence(text: string): string {
  const match = /^(.+?(?:[a-z]{2}|\))[.!?])\s+(?=[A-Z“"])/.exec(text);
  return match?.[1] ?? text;
}

export interface CaseSummaryFacts {
  whatHappened: string | null;
  whoWon: string | null;
  goingForward: string | null;
  /** "Going forward" for the "What does it mean?" point; "Status" when only the open/closed point exists. */
  goingForwardLabel: "Going forward" | "Status";
}

/** The summary card's three lines, read from the page's own "Where this case stands" points (no new claims). */
export function summaryFromStanding(standing: CaseStanding | null): CaseSummaryFacts {
  if (!standing) return { whatHappened: null, whoWon: null, goingForward: null, goingForwardLabel: "Going forward" };
  const point = (id: string) => standing.points.find((candidate) => candidate.id === id)?.text ?? null;
  const whoWon = point("who-won");
  const means = point("means");
  // "Is the case still open?" answers start "No." / "Yes."; the card shows the statement after it.
  const forward = means ?? point("status")?.replace(/^(No|Yes)\.\s+/, "") ?? null;
  return {
    whatHappened: standing.headline,
    whoWon: whoWon ? firstSentence(whoWon) : null,
    goingForward: forward ? firstSentence(forward) : null,
    goingForwardLabel: means ? "Going forward" : "Status",
  };
}

export interface KeyDateInput {
  courtKind: string;
  decidedOn: string | null;
  terminatedOn: string | null;
  filedOn: string | null;
  fjcClosedOn: string | null;
  certStatus: string | null;
  certStatusOn: string | null;
}

/** The one date that best says where the case is: decided, review denied/granted, closed, else filed. */
export function keyDate(input: KeyDateInput): { label: string; date: string } | null {
  if (input.decidedOn) return { label: "Decided", date: input.decidedOn };
  if (input.courtKind === "supreme" && input.certStatusOn) {
    const label = input.certStatus === "denied" ? "Review denied" : input.certStatus === "granted" ? "Review granted"
      : input.certStatus === "dismissed" ? "Dismissed" : null;
    if (label) return { label, date: input.certStatusOn };
  }
  if (input.terminatedOn) return { label: "Closed", date: input.terminatedOn };
  if (input.fjcClosedOn) return { label: "Closed", date: input.fjcClosedOn };
  if (input.filedOn) return { label: "Filed", date: input.filedOn };
  return null;
}
