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

type Point = CaseStanding["points"][number];

/** What the card shows for a stands point it took over entirely: its source, so the source still sits next to the fact. */
export interface CardLineSource { label: string; href: string }

export interface StandingAfterSummary {
  /** "Where this case stands" without what the summary card already says. */
  standing: CaseStanding;
  /** Sources of points the card took over completely (null when the point had none, or it stays below with its rest). */
  whoWonSource: CardLineSource | null;
  goingForwardSource: CardLineSource | null;
  /** Short names of the rows left, for the collapsed section's hint. */
  inside: string[];
}

const REST_LABEL: Partial<Record<Point["id"], string>> = {
  "who-won": "More on the outcome",
  means: "More on what it means",
  status: "More on the case status",
};

const SHORT_NAME: Record<Point["id"], string> = {
  "who-won": "more on the outcome",
  asked: "what each side asked for and got",
  decided: "what the court did",
  lower: "where the case came from",
  means: "more on what it means",
  rule: "the rule it set",
  "good-law": "whether it is still good law",
  cited: "how often it is cited",
  status: "case status",
};

/**
 * Each fact once: the card shows the stands headline and the first sentence of "Who won?" and of "What does it
 * mean?" (or of the open/closed status), so those leave "Where this case stands". A point keeps a row only for what
 * the card does not show: its remaining sentences, quotes, request lines and their sources.
 */
export function standingAfterSummary(standing: CaseStanding | null): StandingAfterSummary | null {
  if (!standing) return null;
  const means = standing.points.some((point) => point.id === "means");
  const forwardId: Point["id"] = means ? "means" : "status";
  let whoWonSource: CardLineSource | null = null;
  let goingForwardSource: CardLineSource | null = null;
  const points: Point[] = [];
  for (const point of standing.points) {
    if (point.id !== "who-won" && point.id !== forwardId) { points.push(point); continue; }
    const text = point.id === "status" ? point.text.replace(/^(No|Yes)\.\s+/, "") : point.text;
    const rest = text.slice(firstSentence(text).length).trim();
    const extra = Boolean(point.quote || point.items?.length || point.quotes?.length);
    if (rest || extra) {
      points.push({ ...point, label: REST_LABEL[point.id] ?? point.label, text: rest });
      continue;
    }
    const source = point.sourceLabel && point.sourceHref ? { label: point.sourceLabel, href: point.sourceHref } : null;
    if (point.id === "who-won") whoWonSource = source; else goingForwardSource = source;
  }
  return {
    standing: { headline: standing.headline, points },
    whoWonSource,
    goingForwardSource,
    inside: points.map((point) => SHORT_NAME[point.id]),
  };
}
