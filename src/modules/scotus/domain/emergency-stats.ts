/**
 * Emergency docket analytics: the precomputed count rows
 * (scotus_emergency_stat / _vote, migration 0196) and the pure functions that
 * build them from applications and sum them into the Pro dashboard. No I/O.
 */
import { ALLOTMENT, circuitOfCourtName, type CircuitId } from "./circuit-justice";
import type { ApplicantKind, ApplicationKind, ApplicationStatus, NotedVote } from "./emergency-application";

export type StatOutcome = ApplicationStatus | "no_ruling";

export type LowerGroup = CircuitId | "state" | "federal_other" | "unknown";

export const LOWER_GROUP_LABEL: Readonly<Record<LowerGroup, string>> = {
  ca1: "1st Circuit", ca2: "2nd Circuit", ca3: "3rd Circuit", ca4: "4th Circuit", ca5: "5th Circuit", ca6: "6th Circuit",
  ca7: "7th Circuit", ca8: "8th Circuit", ca9: "9th Circuit", ca10: "10th Circuit", ca11: "11th Circuit",
  cadc: "D.C. Circuit", cafc: "Federal Circuit", state: "State courts", federal_other: "Other federal courts", unknown: "Not stated",
};
export const LOWER_GROUPS = Object.keys(LOWER_GROUP_LABEL) as LowerGroup[];

const STATE_CIRCUIT = new Map<string, CircuitId>(ALLOTMENT.flatMap((row) => row.states.map((state) => [state.toLowerCase(), row.circuit] as const)));

/** Which court the application came from, grouped: a federal circuit (district courts by their state), state courts, other. */
export function lowerCourtGroup(name: string | null | undefined): LowerGroup {
  const text = (name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "unknown";
  const circuit = circuitOfCourtName(text);
  if (circuit) return circuit;
  const district = /United\s+States\s+District\s+Court\s+for\s+the\s+(?:(?:Northern|Southern|Eastern|Western|Middle|Central)\s+District\s+of\s+|District\s+of\s+)(?:the\s+)?([A-Za-z .]+?)\s*$/i.exec(text);
  if (district?.[1]) {
    const state = district[1].trim().toLowerCase();
    if (state === "columbia") return "cadc";
    return STATE_CIRCUIT.get(state) ?? "federal_other";
  }
  if (/\bUnited\s+States\b|\bFederal\b|\bArmed\s+Forces\b|\bTax\s+Court\b|\bBankruptcy\b|\bJudicial\s+Panel\b/i.test(text)) return "federal_other";
  return "state";
}

/** What one application contributes to the count rows. */
export interface StatSourceRow {
  docketNumber: string;
  kind: ApplicationKind;
  status: ApplicationStatus;
  applicantKind: ApplicantKind;
  administration: string | null;
  lowerCourt: string | null;
  submittedJustice: string | null;
  submittedOn: string | null;
  referredOn: string | null;
  ruledBy: "court" | "justice" | null;
  rulingOn: string | null;
  responseRequested: boolean;
  adminStayOn: string | null;
  writtenReasons: boolean;
  notedVotes: NotedVote[] | unknown;
}

export interface StatRow {
  term: number;
  administration: string | null;
  applicantKind: ApplicantKind;
  lowerGroup: LowerGroup;
  justice: string | null;
  extension: boolean;
  kind: ApplicationKind;
  outcome: StatOutcome;
  referred: boolean;
  responseRequested: boolean;
  adminStay: boolean;
  written: boolean;
  days: number | null;
  applications: number;
  withVotes: number;
}

export interface VoteRow {
  term: number;
  applicantKind: ApplicantKind;
  lowerGroup: LowerGroup;
  extension: boolean;
  voter: string;
  position: string;
  notes: number;
}

export const DECIDED: ReadonlySet<StatOutcome> = new Set(["granted", "granted_in_part", "denied"]);
export const DISSENT_POSITIONS: ReadonlySet<string> = new Set(["dissent", "would_grant", "would_deny"]);
export const DAYS_CAP = 61;

/** "17A1" -> 2017 (the docket year: applications numbered 17A.. were docketed from mid-2017 to mid-2018). */
export function termOfDocket(docketNumber: string): number | null {
  const match = /^(\d{2})A\d+$/i.exec(docketNumber);
  return match ? 2000 + Number(match[1]) : null;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function daysToRuling(row: Pick<StatSourceRow, "status" | "submittedOn" | "rulingOn">): number | null {
  if (!DECIDED.has(row.status) || !row.submittedOn || !row.rulingOn) return null;
  const days = daysBetween(row.submittedOn, row.rulingOn);
  return days < 0 ? null : Math.min(days, DAYS_CAP);
}

function votesOf(value: unknown): NotedVote[] {
  return Array.isArray(value) ? value.filter((vote): vote is NotedVote => Boolean(vote) && typeof (vote as NotedVote).justiceRef === "string" && typeof (vote as NotedVote).position === "string") : [];
}

/**
 * Outcome for the counts: "no_ruling" for an application still pending on its own
 * docket a year after filing (older dockets often end "Application completed."
 * with the ruling on the companion petition docket), so it is not counted as pending.
 */
export function statOutcome(row: Pick<StatSourceRow, "status" | "submittedOn">, today: string): StatOutcome {
  if (row.status !== "pending" || !row.submittedOn) return row.status;
  return daysBetween(row.submittedOn, today) > 365 ? "no_ruling" : "pending";
}

/** Collapse applications into count rows (one per distinct dimension combination). */
export function buildStatRows(rows: readonly StatSourceRow[], today = new Date().toISOString().slice(0, 10)): { stats: StatRow[]; votes: VoteRow[] } {
  const stats = new Map<string, StatRow>();
  const votes = new Map<string, VoteRow>();
  for (const row of rows) {
    const term = termOfDocket(row.docketNumber);
    if (!term) continue;
    const lowerGroup = lowerCourtGroup(row.lowerCourt);
    const extension = row.kind === "extension";
    const noted = votesOf(row.notedVotes);
    const dims: Omit<StatRow, "applications" | "withVotes"> = {
      term, administration: row.administration, applicantKind: row.applicantKind, lowerGroup, justice: row.submittedJustice,
      extension, kind: row.kind, outcome: statOutcome(row, today), referred: Boolean(row.referredOn) || row.ruledBy === "court",
      responseRequested: row.responseRequested, adminStay: Boolean(row.adminStayOn), written: row.writtenReasons,
      days: daysToRuling(row),
    };
    const key = JSON.stringify(dims);
    const current = stats.get(key) ?? { ...dims, applications: 0, withVotes: 0 };
    current.applications += 1;
    if (noted.some((vote) => DISSENT_POSITIONS.has(vote.position))) current.withVotes += 1;
    stats.set(key, current);
    const seen = new Set<string>();
    for (const vote of noted) {
      const voteKey = JSON.stringify([term, row.applicantKind, lowerGroup, extension, vote.justiceRef, vote.position]);
      if (seen.has(voteKey)) continue;
      seen.add(voteKey);
      const entry = votes.get(voteKey) ?? { term, applicantKind: row.applicantKind, lowerGroup, extension, voter: vote.justiceRef, position: vote.position, notes: 0 };
      entry.notes += 1;
      votes.set(voteKey, entry);
    }
  }
  return { stats: [...stats.values()], votes: [...votes.values()] };
}

export interface DashboardFilters {
  term: number | null;
  applicant: ApplicantKind | null;
  circuit: LowerGroup | null;
  extensions: boolean;
}

export interface RateCell { key: string; label: string; applications: number; decided: number; granted: number }

export interface Dashboard {
  filters: DashboardFilters;
  totals: {
    applications: number; decided: number; granted: number; grantedInPart: number; denied: number; closedOther: number; pending: number;
    referred: number; responseRequested: number; adminStay: number; written: number; withVotes: number; decidedByCourt: number;
    medianDays: number | null; grantedReferred: number;
  };
  byTerm: Array<{ term: number; applications: number; granted: number; grantedInPart: number; denied: number; closedOther: number; pending: number }>;
  byApplicant: RateCell[];
  byAdministration: RateCell[];
  byJustice: Array<RateCell & { referred: number }>;
  byLowerGroup: RateCell[];
  days: { bins: Array<{ label: string; from: number; to: number; justice: number; court: number }>; median: number | null; medianJustice: number | null; medianCourt: number | null; measured: number };
  votes: { leaderboard: Array<{ voter: string; dissents: number; wouldGrant: number; wouldDeny: number; total: number }>; heatmap: { voters: string[]; terms: number[]; cells: Record<string, Record<number, number>> } };
  termsAvailable: number[];
}

export const DAY_BINS: ReadonlyArray<{ label: string; from: number; to: number }> = [
  { label: "Same day", from: 0, to: 0 }, { label: "1 day", from: 1, to: 1 }, { label: "2–3", from: 2, to: 3 },
  { label: "4–7", from: 4, to: 7 }, { label: "8–14", from: 8, to: 14 }, { label: "15–30", from: 15, to: 30 },
  { label: "31–60", from: 31, to: 60 }, { label: "60+", from: 61, to: 61 },
];

export const APPLICANT_ORDER: readonly ApplicantKind[] = ["federal", "state", "private"];
export const ADMINISTRATION_ORDER = ["Trump (first term)", "Biden", "Trump (second term)"];

function median(counts: Map<number, number>): number | null {
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  const sorted = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  // Lower median, like percentile_disc(0.5).
  let seen = 0;
  for (const [days, count] of sorted) {
    seen += count;
    if (seen >= total / 2) return days;
  }
  return sorted.at(-1)![0];
}

function matches(row: { term: number; applicantKind: ApplicantKind; lowerGroup: LowerGroup; extension: boolean }, filters: DashboardFilters, skip: { term?: boolean; applicant?: boolean } = {}) {
  return (filters.extensions || !row.extension)
    && (skip.term || filters.term === null || row.term === filters.term)
    && (skip.applicant || filters.applicant === null || row.applicantKind === filters.applicant)
    && (filters.circuit === null || row.lowerGroup === filters.circuit);
}

function rateCells<K extends string>(rows: readonly StatRow[], keyOf: (row: StatRow) => K | null, labelOf: (key: K) => string): Map<K, RateCell> {
  const cells = new Map<K, RateCell>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const cell = cells.get(key) ?? { key, label: labelOf(key), applications: 0, decided: 0, granted: 0 };
    cell.applications += row.applications;
    if (DECIDED.has(row.outcome)) cell.decided += row.applications;
    if (row.outcome === "granted" || row.outcome === "granted_in_part") cell.granted += row.applications;
    cells.set(key, cell);
  }
  return cells;
}

const APPLICANT_LABEL: Record<ApplicantKind, string> = { federal: "Federal government", state: "State or local government", private: "Private party" };

/** Sum the precomputed rows into everything the page draws. */
export function summarize(allStats: readonly StatRow[], allVotes: readonly VoteRow[], filters: DashboardFilters, justiceLabel: (ref: string) => string = (ref) => ref): Dashboard {
  const stats = allStats.filter((row) => matches(row, filters));
  const totals: Dashboard["totals"] = { applications: 0, decided: 0, granted: 0, grantedInPart: 0, denied: 0, closedOther: 0, pending: 0, referred: 0,
    responseRequested: 0, adminStay: 0, written: 0, withVotes: 0, decidedByCourt: 0, medianDays: null, grantedReferred: 0 };
  const dayCounts = new Map<number, number>();
  const dayJustice = new Map<number, number>();
  const dayCourt = new Map<number, number>();
  for (const row of stats) {
    const n = row.applications;
    totals.applications += n;
    if (row.outcome === "granted") totals.granted += n;
    else if (row.outcome === "granted_in_part") totals.grantedInPart += n;
    else if (row.outcome === "denied") totals.denied += n;
    else if (row.outcome === "pending") totals.pending += n;
    else totals.closedOther += n;
    if (DECIDED.has(row.outcome)) totals.decided += n;
    if (row.referred) totals.referred += n;
    if (row.referred && (row.outcome === "granted" || row.outcome === "granted_in_part")) totals.grantedReferred += n;
    if (row.referred && DECIDED.has(row.outcome)) totals.decidedByCourt += n;
    if (row.responseRequested) totals.responseRequested += n;
    if (row.adminStay) totals.adminStay += n;
    if (row.written) totals.written += n;
    totals.withVotes += row.withVotes;
    if (row.days !== null) {
      dayCounts.set(row.days, (dayCounts.get(row.days) ?? 0) + n);
      const target = row.referred ? dayCourt : dayJustice;
      target.set(row.days, (target.get(row.days) ?? 0) + n);
    }
  }
  totals.medianDays = median(dayCounts);

  const termRows = allStats.filter((row) => matches(row, filters, { term: true }));
  const terms = new Map<number, Dashboard["byTerm"][number]>();
  for (const row of termRows) {
    const entry = terms.get(row.term) ?? { term: row.term, applications: 0, granted: 0, grantedInPart: 0, denied: 0, closedOther: 0, pending: 0 };
    entry.applications += row.applications;
    if (row.outcome === "granted") entry.granted += row.applications;
    else if (row.outcome === "granted_in_part") entry.grantedInPart += row.applications;
    else if (row.outcome === "denied") entry.denied += row.applications;
    else if (row.outcome === "pending") entry.pending += row.applications;
    else entry.closedOther += row.applications;
    terms.set(row.term, entry);
  }

  const applicantRows = allStats.filter((row) => matches(row, filters, { applicant: true }));
  const byApplicant = rateCells(applicantRows, (row) => row.applicantKind, (key) => APPLICANT_LABEL[key]);
  const byAdministration = rateCells(allStats.filter((row) => matches(row, filters, { applicant: true }) && row.applicantKind === "federal"),
    (row) => row.administration, (key) => key);
  const justiceCells = rateCells(stats, (row) => row.justice, (key) => justiceLabel(key));
  const referredByJustice = new Map<string, number>();
  for (const row of stats) if (row.justice && row.referred) referredByJustice.set(row.justice, (referredByJustice.get(row.justice) ?? 0) + row.applications);
  const byLowerGroup = rateCells(stats, (row) => row.lowerGroup, (key) => LOWER_GROUP_LABEL[key]);

  const voteRows = allVotes.filter((row) => matches(row, filters, { term: true }));
  const board = new Map<string, Dashboard["votes"]["leaderboard"][number]>();
  const heat: Record<string, Record<number, number>> = {};
  const heatTerms = new Set<number>(termRows.map((row) => row.term));
  for (const row of voteRows) {
    if (!DISSENT_POSITIONS.has(row.position)) continue;
    const inTerm = filters.term === null || row.term === filters.term;
    const entry = board.get(row.voter) ?? { voter: row.voter, dissents: 0, wouldGrant: 0, wouldDeny: 0, total: 0 };
    if (inTerm) {
      if (row.position === "dissent") entry.dissents += row.notes;
      else if (row.position === "would_grant") entry.wouldGrant += row.notes;
      else entry.wouldDeny += row.notes;
      entry.total += row.notes;
    }
    board.set(row.voter, entry);
    heat[row.voter] ??= {};
    heat[row.voter]![row.term] = (heat[row.voter]![row.term] ?? 0) + row.notes;
  }
  const leaderboard = [...board.values()].filter((row) => row.total > 0).sort((a, b) => b.total - a.total || a.voter.localeCompare(b.voter));
  const heatVoters = Object.keys(heat).sort((a, b) =>
    Object.values(heat[b]!).reduce((s, v) => s + v, 0) - Object.values(heat[a]!).reduce((s, v) => s + v, 0) || a.localeCompare(b));

  return {
    filters,
    totals,
    byTerm: [...terms.values()].sort((a, b) => a.term - b.term),
    byApplicant: APPLICANT_ORDER.map((key) => byApplicant.get(key)).filter((cell): cell is RateCell => Boolean(cell)),
    byAdministration: ADMINISTRATION_ORDER.map((key) => byAdministration.get(key)).filter((cell): cell is RateCell => Boolean(cell)),
    byJustice: [...justiceCells.values()].map((cell) => ({ ...cell, referred: referredByJustice.get(cell.key) ?? 0 }))
      .sort((a, b) => b.applications - a.applications).slice(0, 14),
    byLowerGroup: [...byLowerGroup.values()].sort((a, b) => b.applications - a.applications),
    days: {
      bins: DAY_BINS.map((bin) => {
        let justice = 0; let court = 0;
        for (let day = bin.from; day <= bin.to; day += 1) { justice += dayJustice.get(day) ?? 0; court += dayCourt.get(day) ?? 0; }
        return { ...bin, justice, court };
      }),
      median: totals.medianDays, medianJustice: median(dayJustice), medianCourt: median(dayCourt),
      measured: [...dayCounts.values()].reduce((sum, value) => sum + value, 0),
    },
    votes: { leaderboard, heatmap: { voters: heatVoters, terms: [...heatTerms].sort((a, b) => a - b), cells: heat } },
    termsAvailable: [...new Set(allStats.map((row) => row.term))].sort((a, b) => a - b),
  };
}

/** Percent, or null when the sample is too small to say anything (fewer than `min`). */
export function rate(part: number, whole: number, min = 5): number | null {
  return whole >= min ? Math.round((part / whole) * 1000) / 10 : null;
}

export function parseDashboardFilters(params: Record<string, string | string[] | undefined>, terms: readonly number[]): DashboardFilters {
  const one = (name: string) => { const value = params[name]; return Array.isArray(value) ? value[0] : value; };
  const termValue = Number.parseInt(one("term") ?? "", 10);
  const applicant = one("applicant");
  const circuit = one("circuit");
  return {
    term: Number.isInteger(termValue) && terms.includes(termValue) ? termValue : null,
    applicant: applicant === "federal" || applicant === "state" || applicant === "private" ? applicant : null,
    circuit: circuit && (LOWER_GROUPS as string[]).includes(circuit) ? circuit as LowerGroup : null,
    extensions: one("extensions") === "1",
  };
}
