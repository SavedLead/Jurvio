/**
 * One Supreme Court term, broken down from SCDB rows only. Pure functions: the
 * application layer reads the rows from Postgres, the unit test reads them
 * from the committed SCDB release file, and both get the same numbers.
 *
 * Every count keeps its denominator; nothing is scored or inferred.
 */

/** SCDB decision types for orally argued cases: 1 opinion of the Court, 6 argued per curiam, 7 judgment of the Court. */
export const ARGUED_DECISION_TYPES: readonly number[] = [1, 6, 7];
/** SCDB vote codes that are dissents: 2 dissent, 6 dissent from a denial or dismissal of cert, 7 jurisdictional dissent. */
export const DISSENT_VOTES: readonly number[] = [2, 6, 7];
/** SCDB vote codes that are concurrences: 3 regular, 4 special (agreed with the result only). */
export const CONCURRENCE_VOTES: readonly number[] = [3, 4];

export interface TermCaseRow {
  scdbCaseId: string;
  caseName: string;
  docket: string | null;
  usCite: string | null;
  decidedOn: string | null;
  decisionType: number | null;
  issueArea: number | null;
  decisionDirection: number | null;
  majVotes: number | null;
  minVotes: number | null;
  majOpinWriter: number | null;
}

export interface TermVoteRow {
  scdbCaseId: string;
  scdbJusticeId: number;
  /** SCDB justiceName code, e.g. "JGRoberts". */
  code: string;
  vote: number | null;
  opinion: number | null;
  /** 1 conservative, 2 liberal, null = no direction (SCDB). */
  direction: number | null;
  /** 1 dissent, 2 majority, null = not recorded. */
  majority: number | null;
}

export interface SplitCount { split: string; decisions: number }
export interface FiveFourDecision {
  scdbCaseId: string; caseName: string; docket: string | null; usCite: string | null; decidedOn: string | null;
  argued: boolean; opinionBy: number | null; majority: number[]; dissent: number[];
}
export interface IssueCell { liberal: number; withDirection: number; withoutDirection: number }
export interface JusticeOpinionCounts {
  scdbJusticeId: number; code: string; votesCast: number;
  majorityOpinions: number; concurrencesWritten: number; dissentsWritten: number;
  liberal: number; withDirection: number; withoutDirection: number; inMajority: number; inDissent: number; didNotVote: number;
}
export interface UsualLines {
  /** The three justices with the highest SCDB-coded liberal share in argued cases this term. */
  minority: number[];
  /** Argued 6-3 decisions whose three dissenters are exactly those three. */
  decisions: number;
  /** Denominator: all argued 6-3 decisions. */
  sixThree: number;
}
export interface ScopeBreakdown {
  decisions: number;
  splits: SplitCount[];
  /** No dissenting vote (9-0, 8-0, ...). */
  unanimous: number;
  /** Decisions with no vote split recorded. */
  splitUnknown: number;
  fiveFour: number;
  sixThree: number;
}
export interface TermBreakdown {
  term: number;
  coverage: { decisions: number; argued: number; byDecisionType: Record<string, number>; firstDecided: string | null; lastDecided: string | null; withoutDirection: number };
  all: ScopeBreakdown;
  argued: ScopeBreakdown;
  usualLines: UsualLines | null;
  fiveFourDecisions: FiveFourDecision[];
  justices: JusticeOpinionCounts[];
  /** issueArea -> scdbJusticeId -> cell, argued cases only. */
  issues: Record<number, Record<number, IssueCell>>;
}

const SPLIT_ORDER = ["9-0", "8-0", "7-0", "8-1", "7-1", "7-2", "6-1", "6-2", "6-3", "5-2", "5-3", "5-4", "4-4"];

export function splitKey(row: Pick<TermCaseRow, "majVotes" | "minVotes">): string | null {
  return row.majVotes === null || row.minVotes === null ? null : `${row.majVotes}-${row.minVotes}`;
}

export function isArgued(row: Pick<TermCaseRow, "decisionType">): boolean {
  return row.decisionType !== null && ARGUED_DECISION_TYPES.includes(row.decisionType);
}

function scopeBreakdown(cases: TermCaseRow[]): ScopeBreakdown {
  const counts = new Map<string, number>();
  let splitUnknown = 0;
  for (const row of cases) {
    const key = splitKey(row);
    if (key === null) { splitUnknown += 1; continue; }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const order = (key: string) => { const i = SPLIT_ORDER.indexOf(key); return i < 0 ? SPLIT_ORDER.length : i; };
  const splits = [...counts].map(([split, decisions]) => ({ split, decisions }))
    .sort((a, b) => order(a.split) - order(b.split) || a.split.localeCompare(b.split));
  return {
    decisions: cases.length,
    splits,
    unanimous: cases.filter((row) => row.minVotes === 0).length,
    splitUnknown,
    fiveFour: counts.get("5-4") ?? 0,
    sixThree: counts.get("6-3") ?? 0,
  };
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

export function buildTermBreakdown(term: number, cases: TermCaseRow[], votes: TermVoteRow[]): TermBreakdown {
  const argued = cases.filter(isArgued);
  const arguedIds = new Set(argued.map((row) => row.scdbCaseId));
  const byCase = new Map<string, TermVoteRow[]>();
  for (const vote of votes) byCase.set(vote.scdbCaseId, [...(byCase.get(vote.scdbCaseId) ?? []), vote]);

  const byDecisionType: Record<string, number> = {};
  for (const row of cases) {
    const key = row.decisionType === null ? "unknown" : String(row.decisionType);
    byDecisionType[key] = (byDecisionType[key] ?? 0) + 1;
  }
  const dates = cases.map((row) => row.decidedOn).filter((d): d is string => Boolean(d)).sort();

  // Per-justice counts, argued cases only.
  const justices = new Map<number, JusticeOpinionCounts>();
  const issues: Record<number, Record<number, IssueCell>> = {};
  const issueOf = new Map(argued.map((row) => [row.scdbCaseId, row.issueArea]));
  for (const vote of votes) {
    if (!arguedIds.has(vote.scdbCaseId)) continue;
    const j = justices.get(vote.scdbJusticeId) ?? {
      scdbJusticeId: vote.scdbJusticeId, code: vote.code, votesCast: 0, majorityOpinions: 0, concurrencesWritten: 0,
      dissentsWritten: 0, liberal: 0, withDirection: 0, withoutDirection: 0, inMajority: 0, inDissent: 0, didNotVote: 0,
    };
    justices.set(vote.scdbJusticeId, j);
    if (vote.vote === null) { j.didNotVote += 1; continue; }
    j.votesCast += 1;
    const wrote = vote.opinion === 2 || vote.opinion === 3;
    if (wrote && CONCURRENCE_VOTES.includes(vote.vote)) j.concurrencesWritten += 1;
    if (wrote && DISSENT_VOTES.includes(vote.vote)) j.dissentsWritten += 1;
    if (vote.majority === 2) j.inMajority += 1;
    if (vote.majority === 1) j.inDissent += 1;
    const issueArea = issueOf.get(vote.scdbCaseId) ?? null;
    const cell = issueArea === null ? null : ((issues[issueArea] ??= {})[vote.scdbJusticeId] ??= { liberal: 0, withDirection: 0, withoutDirection: 0 });
    if (vote.direction === 1 || vote.direction === 2) {
      j.withDirection += 1;
      if (vote.direction === 2) j.liberal += 1;
      if (cell) { cell.withDirection += 1; if (vote.direction === 2) cell.liberal += 1; }
    } else {
      j.withoutDirection += 1;
      if (cell) cell.withoutDirection += 1;
    }
  }
  for (const row of argued) {
    if (row.majOpinWriter !== null) {
      const j = justices.get(row.majOpinWriter);
      if (j) j.majorityOpinions += 1;
    }
  }

  const sides = (id: string) => {
    const caseVotes = byCase.get(id) ?? [];
    return {
      majority: caseVotes.filter((v) => v.majority === 2).map((v) => v.scdbJusticeId),
      dissent: caseVotes.filter((v) => v.majority === 1).map((v) => v.scdbJusticeId),
    };
  };

  // "Usual lines": only defined for a full nine-member Court with coded shares.
  const ranked = [...justices.values()].filter((j) => j.withDirection > 0)
    .sort((a, b) => b.liberal / b.withDirection - a.liberal / a.withDirection || a.scdbJusticeId - b.scdbJusticeId);
  let usualLines: UsualLines | null = null;
  if (ranked.length === 9) {
    const third = ranked[2]!, fourth = ranked[3]!;
    // A tie between 3rd and 4th means there is no clear trio; say so instead of picking one.
    if (third.liberal / third.withDirection > fourth.liberal / fourth.withDirection) {
      const minority = ranked.slice(0, 3).map((j) => j.scdbJusticeId);
      const sixThree = argued.filter((row) => splitKey(row) === "6-3");
      usualLines = { minority, sixThree: sixThree.length, decisions: sixThree.filter((row) => sameSet(sides(row.scdbCaseId).dissent, minority)).length };
    }
  }

  const fiveFourDecisions = cases.filter((row) => splitKey(row) === "5-4")
    .sort((a, b) => (a.decidedOn ?? "").localeCompare(b.decidedOn ?? "") || a.scdbCaseId.localeCompare(b.scdbCaseId))
    .map((row) => ({
      scdbCaseId: row.scdbCaseId, caseName: row.caseName, docket: row.docket, usCite: row.usCite, decidedOn: row.decidedOn,
      argued: isArgued(row), opinionBy: row.majOpinWriter, ...sides(row.scdbCaseId),
    }));

  return {
    term,
    coverage: {
      decisions: cases.length, argued: argued.length, byDecisionType,
      firstDecided: dates[0] ?? null, lastDecided: dates.at(-1) ?? null,
      withoutDirection: cases.filter((row) => row.decisionDirection !== 1 && row.decisionDirection !== 2).length,
    },
    all: scopeBreakdown(cases),
    argued: scopeBreakdown(argued),
    usualLines,
    fiveFourDecisions,
    justices: [...justices.values()],
    issues,
  };
}

/**
 * Independent published tallies a term was checked against. Only terms we have
 * actually checked appear here; every other term says "not independently checked".
 */
export interface ExternalTermCheck {
  term: number;
  decisions: number;
  argued: number;
  fiveFour: number;
  sixThreeArgued: number;
  unanimous: number;
  source: string;
  sourceUrl: string;
  checkedOn: string;
  note: string;
}

export const EXTERNAL_TERM_CHECKS: readonly ExternalTermCheck[] = [{
  term: 2025,
  decisions: 66,
  argued: 57,
  fiveFour: 7,
  sixThreeArgued: 17,
  unanimous: 29,
  source: "SCOTUSblog, Final Stat Pack for the 2025-26 Term",
  sourceUrl: "https://media.scotusblog.com/embeds/e37a2a9c101cfbe5392c107e1996d090f449f2d9/2025-26-term-stat-pack.pdf",
  checkedOn: "2026-11-01",
  note: "SCOTUSblog lists 66 opinions released (56 signed and 10 per curiam). Its headline count of 67 most likely counts West Virginia v. B.P.J. and Little v. Hecox, decided in one opinion, as two cases; the Supreme Court Database counts them as one.",
}];

export function externalCheck(term: number): ExternalTermCheck | null {
  return EXTERNAL_TERM_CHECKS.find((row) => row.term === term) ?? null;
}

/** Plain-English names for SCDB decision types, for the coverage note. */
export const DECISION_TYPE_LABELS: Record<string, string> = {
  "1": "signed opinions after oral argument",
  "2": "decided without oral argument",
  "4": "decrees",
  "5": "equally divided votes",
  "6": "unsigned (per curiam) opinions after oral argument",
  "7": "judgments of the Court",
  "8": "seriatim opinions",
  unknown: "decision type not recorded",
};
