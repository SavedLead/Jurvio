import type postgres from "postgres";
import { justiceSlugs } from "@/modules/scotus/domain/justice-slug";

type Sql = ReturnType<typeof postgres>;

/**
 * Read models for the public /justices pages and the SCDB lineup block on
 * SCOTUS case pages. Everything here reads the precomputed views from migration
 * 0186; nothing is scored or inferred at request time. Every rate is returned
 * with its numerator, its denominator and what was left out, so the pages can
 * show an Evidence Ledger next to each number.
 *
 * "argued" = SCDB decisionType 1, 6 or 7 (orally argued, signed or per curiam
 * opinions), the set most SCDB-based studies use. "all" = every SCDB decision.
 */
export type JusticeScope = "argued" | "all";
export const JUSTICE_SCOPES: readonly JusticeScope[] = ["argued", "all"];

export function parseScope(raw: string | string[] | undefined): JusticeScope {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "all" ? "all" : "argued";
}

/** Missing tables (before migration 0186 runs) read as "no data yet", never as a 500. */
async function orEmpty<T>(query: PromiseLike<readonly T[]>, empty: T[]): Promise<T[]> {
  try {
    return [...(await query)];
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return empty;
    throw error;
  }
}

export interface DatasetRelease {
  sourceSystem: string;
  version: string;
  fileName: string;
  sourceUrl: string;
  sha256: string;
  rowCount: number;
  citationText: string;
  licenseNote: string | null;
}

export async function listDatasetReleases(sql: Sql): Promise<DatasetRelease[]> {
  return orEmpty(sql<DatasetRelease[]>`
    SELECT source_system AS "sourceSystem", version, file_name AS "fileName", source_url AS "sourceUrl",
      sha256, row_count AS "rowCount", citation_text AS "citationText", license_note AS "licenseNote"
    FROM scotus_dataset_release
    ORDER BY CASE source_system WHEN 'scdb_modern' THEN 1 WHEN 'scdb_legacy' THEN 2 WHEN 'martin_quinn' THEN 3 ELSE 4 END, file_name
  `, []);
}

export interface Share {
  numerator: number;
  denominator: number;
  rate: number | null;
}

export interface DirectionLedger {
  rowsOnRecord: number;
  votesParticipating: number;
  votesWithDirection: number;
  votesWithoutDirection: number;
  liberal: Share;
}

export interface JusticeSummary {
  scdbJusticeId: number;
  slug: string;
  scdbCode: string;
  displayName: string;
  serviceStart: string | null;
  serviceEnd: string | null;
  appointmentTitle: string | null;
  appointingPresident: string | null;
  firstTerm: number | null;
  lastTerm: number | null;
  latestMartinQuinn: { term: number; mean: number; low: number; high: number } | null;
  direction: DirectionLedger | null;
  bioSourceUrl: string | null;
  judgeId: string | null;
}

interface RosterRow {
  scdbJusticeId: number;
  scdbCode: string;
  displayName: string;
  serviceStart: string | null;
  serviceEnd: string | null;
  appointmentTitle: string | null;
  appointingPresident: string | null;
  firstTerm: number | null;
  lastTerm: number | null;
  mqTerm: number | null;
  mqMean: string | null;
  mqLow: string | null;
  mqHigh: string | null;
  rowsOnRecord: number | null;
  votesParticipating: number | null;
  votesWithDirection: number | null;
  votesWithoutDirection: number | null;
  liberalVotes: number | null;
  liberalShare: string | null;
  bioSourceUrl: string | null;
  judgeId: string | null;
}

const num = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

function directionLedger(row: {
  rowsOnRecord: number | null; votesParticipating: number | null; votesWithDirection: number | null;
  votesWithoutDirection: number | null; liberalVotes: number | null; liberalShare: string | null;
}): DirectionLedger | null {
  if (row.rowsOnRecord === null) return null;
  return {
    rowsOnRecord: row.rowsOnRecord,
    votesParticipating: row.votesParticipating ?? 0,
    votesWithDirection: row.votesWithDirection ?? 0,
    votesWithoutDirection: row.votesWithoutDirection ?? 0,
    liberal: { numerator: row.liberalVotes ?? 0, denominator: row.votesWithDirection ?? 0, rate: num(row.liberalShare) },
  };
}

/** All 118 SCDB justices with their whole-career ledger for the given scope. */
export async function listJustices(sql: Sql, scope: JusticeScope): Promise<JusticeSummary[]> {
  const rows = await orEmpty(sql<RosterRow[]>`
    SELECT j.scdb_justice_id AS "scdbJusticeId", j.scdb_code AS "scdbCode", j.display_name AS "displayName",
      j.scdb_service_start::text AS "serviceStart", j.scdb_service_end::text AS "serviceEnd",
      appt.appointment_title AS "appointmentTitle", appt.appointing_president AS "appointingPresident",
      terms.first_term AS "firstTerm", terms.last_term AS "lastTerm",
      mq.term AS "mqTerm", mq.post_mn::text AS "mqMean", mq.post_025::text AS "mqLow", mq.post_975::text AS "mqHigh",
      d.rows_on_record AS "rowsOnRecord", d.votes_participating AS "votesParticipating",
      d.votes_with_direction AS "votesWithDirection", d.votes_without_direction AS "votesWithoutDirection",
      d.scdb_liberal_votes AS "liberalVotes", d.scdb_liberal_share::text AS "liberalShare",
      j.bio_source_url AS "bioSourceUrl", j.judge_id::text AS "judgeId"
    FROM scotus_justice j
    LEFT JOIN LATERAL (
      SELECT a.appointment_title, a.appointing_president
      FROM scotus_justice_appointment a
      WHERE a.scdb_justice_id = j.scdb_justice_id
      ORDER BY abs(coalesce(a.commission_date, a.confirmation_date) - coalesce(j.scdb_service_start, a.commission_date)) NULLS LAST
      LIMIT 1
    ) appt ON true
    LEFT JOIN LATERAL (
      SELECT min(term_key) AS first_term, max(term_key) AS last_term
      FROM scotus_justice_direction_mv
      WHERE scope = 'all' AND scdb_justice_id = j.scdb_justice_id AND term_key <> 0 AND issue_area_key = 0
    ) terms ON true
    LEFT JOIN LATERAL (
      SELECT term, post_mn, post_025, post_975 FROM martin_quinn_score
      WHERE scdb_justice_id = j.scdb_justice_id ORDER BY term DESC LIMIT 1
    ) mq ON true
    LEFT JOIN scotus_justice_direction_mv d
      ON d.scope = ${scope} AND d.scdb_justice_id = j.scdb_justice_id AND d.term_key = 0 AND d.issue_area_key = 0
    ORDER BY j.scdb_service_start DESC NULLS LAST, j.scdb_justice_id DESC
  `, []);
  const slugs = justiceSlugs(rows);
  return rows.map((row) => ({
    scdbJusticeId: row.scdbJusticeId,
    slug: slugs.get(row.scdbJusticeId)!,
    scdbCode: row.scdbCode,
    displayName: row.displayName,
    serviceStart: row.serviceStart,
    serviceEnd: row.serviceEnd,
    appointmentTitle: row.appointmentTitle,
    appointingPresident: row.appointingPresident,
    firstTerm: row.firstTerm,
    lastTerm: row.lastTerm,
    latestMartinQuinn: row.mqTerm === null ? null
      : { term: row.mqTerm, mean: Number(row.mqMean), low: Number(row.mqLow), high: Number(row.mqHigh) },
    direction: directionLedger(row),
    bioSourceUrl: row.bioSourceUrl,
    judgeId: row.judgeId,
  }));
}

export interface TermRow {
  term: number;
  casesOnRecord: number;
  votesParticipating: number;
  votesInMajority: number;
  votesInDissent: number;
  concurrences: number;
  opinionsWritten: number;
  majorityOpinionsWritten: number;
  direction: DirectionLedger | null;
  martinQuinn: { mean: number; low: number; high: number } | null;
}

export interface IssueRow {
  issueArea: number;
  label: string;
  direction: DirectionLedger;
}

export interface PairRow {
  otherJusticeId: number;
  otherName: string;
  otherSlug: string;
  casesBothOnRecord: number;
  casesTogether: number;
  casesExcluded: number;
  casesAgreed: number;
  rate: number | null;
}

export interface FiveFourCase {
  scdbCaseId: string;
  term: number;
  decidedOn: string | null;
  caseName: string;
  usCite: string | null;
  side: "majority" | "dissent";
  majority: string[];
  dissent: string[];
  scdbDirection: string | null;
  issueArea: string | null;
  jurvioCaseId: string | null;
}

export interface JusticeProfile {
  justice: JusticeSummary;
  terms: TermRow[];
  issues: IssueRow[];
  pairs: PairRow[];
  fiveFour: { total: number; inMajority: number; inDissent: number; recent: FiveFourCase[] };
}

export async function loadJusticeProfile(sql: Sql, slug: string, scope: JusticeScope): Promise<JusticeProfile | null> {
  const roster = await listJustices(sql, scope);
  const justice = roster.find((row) => row.slug === slug);
  if (!justice) return null;
  const id = justice.scdbJusticeId;
  const names = new Map(roster.map((row) => [row.scdbCode, row.displayName]));
  const [terms, issues, pairs, fiveFour] = await Promise.all([
    sql<Array<Omit<TermRow, "direction" | "martinQuinn"> & {
      rowsOnRecord: number | null; dirParticipating: number | null; votesWithDirection: number | null;
      votesWithoutDirection: number | null; liberalVotes: number | null; liberalShare: string | null;
      mqMean: string | null; mqLow: string | null; mqHigh: string | null;
    }>>`
      SELECT p.term, p.cases_on_record AS "casesOnRecord", p.votes_participating AS "votesParticipating",
        p.votes_in_majority AS "votesInMajority", p.votes_in_dissent AS "votesInDissent", p.concurrences,
        p.opinions_written AS "opinionsWritten", p.majority_opinions_written AS "majorityOpinionsWritten",
        d.rows_on_record AS "rowsOnRecord", d.votes_participating AS "dirParticipating",
        d.votes_with_direction AS "votesWithDirection", d.votes_without_direction AS "votesWithoutDirection",
        d.scdb_liberal_votes AS "liberalVotes", d.scdb_liberal_share::text AS "liberalShare",
        p.martin_quinn_post_mn::text AS "mqMean", p.martin_quinn_post_025::text AS "mqLow", p.martin_quinn_post_975::text AS "mqHigh"
      FROM scotus_justice_term_profile_v p
      LEFT JOIN scotus_justice_direction_mv d
        ON d.scope = ${scope} AND d.scdb_justice_id = p.scdb_justice_id AND d.term_key = p.term AND d.issue_area_key = 0
      WHERE p.scdb_justice_id = ${id}
      ORDER BY p.term
    `,
    sql<Array<{ issueArea: number; label: string | null; rowsOnRecord: number; votesParticipating: number; votesWithDirection: number;
      votesWithoutDirection: number; liberalVotes: number; liberalShare: string | null }>>`
      SELECT d.issue_area_key AS "issueArea", coalesce(l.label, 'Issue area not coded by SCDB') AS label,
        d.rows_on_record AS "rowsOnRecord", d.votes_participating AS "votesParticipating",
        d.votes_with_direction AS "votesWithDirection", d.votes_without_direction AS "votesWithoutDirection",
        d.scdb_liberal_votes AS "liberalVotes", d.scdb_liberal_share::text AS "liberalShare"
      FROM scotus_justice_direction_mv d
      LEFT JOIN scdb_code_label l ON l.variable = 'issueArea' AND l.code = d.issue_area_key
      WHERE d.scope = ${scope} AND d.scdb_justice_id = ${id} AND d.term_key = 0 AND d.issue_area_key <> 0
      ORDER BY d.votes_with_direction DESC, d.issue_area_key
    `,
    sql<Array<{ otherJusticeId: number; casesBothOnRecord: number; casesTogether: number; casesExcluded: number;
      casesAgreed: number; rate: string | null }>>`
      SELECT CASE WHEN justice_a = ${id} THEN justice_b ELSE justice_a END AS "otherJusticeId",
        cases_both_on_record AS "casesBothOnRecord", cases_together AS "casesTogether",
        cases_excluded AS "casesExcluded", cases_agreed AS "casesAgreed", agreement_rate::text AS rate
      FROM scotus_justice_pair_agreement_mv
      WHERE scope = ${scope} AND term_key = 0 AND (justice_a = ${id} OR justice_b = ${id}) AND cases_together > 0
      ORDER BY agreement_rate DESC NULLS LAST
    `,
    sql<Array<Omit<FiveFourCase, "majority" | "dissent" | "side"> & { majority: string[]; dissent: string[] }>>`
      SELECT f.scdb_case_id AS "scdbCaseId", f.term, f.decided_on::text AS "decidedOn", f.case_name AS "caseName",
        f.us_cite AS "usCite", f.majority_coalition AS majority, f.dissenting_coalition AS dissent,
        f.scdb_decision_direction_label AS "scdbDirection", f.issue_area_label AS "issueArea",
        c.public_id AS "jurvioCaseId"
      FROM scotus_five_four_decision_v f
      LEFT JOIN legal_case c ON c.id = f.legal_case_id AND c.publication = 'published'
      WHERE (${justice.scdbCode} = ANY(f.majority_coalition) OR ${justice.scdbCode} = ANY(f.dissenting_coalition))
        AND (${scope} = 'all' OR f.decision_type IN (1, 6, 7))
      ORDER BY f.decided_on DESC NULLS LAST, f.scdb_case_id DESC
    `,
  ]);
  const byId = new Map(roster.map((row) => [row.scdbJusticeId, row]));
  const named = (codes: string[]) => codes.map((code) => names.get(code) ?? code);
  const cases: FiveFourCase[] = fiveFour.map((row) => ({
    ...row,
    side: row.majority.includes(justice.scdbCode) ? "majority" : "dissent",
    majority: named(row.majority),
    dissent: named(row.dissent),
  }));
  return {
    justice,
    terms: terms.map((row) => ({
      term: row.term, casesOnRecord: row.casesOnRecord, votesParticipating: row.votesParticipating,
      votesInMajority: row.votesInMajority, votesInDissent: row.votesInDissent, concurrences: row.concurrences,
      opinionsWritten: row.opinionsWritten, majorityOpinionsWritten: row.majorityOpinionsWritten,
      direction: directionLedger({ ...row, votesParticipating: row.dirParticipating }),
      martinQuinn: row.mqMean === null ? null : { mean: Number(row.mqMean), low: Number(row.mqLow), high: Number(row.mqHigh) },
    })),
    issues: issues.map((row) => ({ issueArea: row.issueArea, label: row.label ?? "", direction: directionLedger(row)! })),
    pairs: pairs.flatMap((row) => {
      const other = byId.get(row.otherJusticeId);
      return other ? [{ ...row, otherName: other.displayName, otherSlug: other.slug, rate: num(row.rate) }] : [];
    }),
    fiveFour: {
      total: cases.length,
      inMajority: cases.filter((row) => row.side === "majority").length,
      inDissent: cases.filter((row) => row.side === "dissent").length,
      recent: cases.slice(0, 12),
    },
  };
}

export interface TermCoverage {
  term: number;
  scdbCases: number;
  arguedCases: number;
  casesWithDirection: number;
  casesDirectionUnspecifiableOrMissing: number;
  fiveFourCases: number;
  casesLinkedToJurvio: number;
  martinQuinnJustices: number;
  scdbVersion: string | null;
}

export async function listTermCoverage(sql: Sql): Promise<TermCoverage[]> {
  return orEmpty(sql<TermCoverage[]>`
    SELECT term, scdb_cases AS "scdbCases", argued_cases AS "arguedCases", cases_with_direction AS "casesWithDirection",
      cases_direction_unspecifiable_or_missing AS "casesDirectionUnspecifiableOrMissing", five_four_cases AS "fiveFourCases",
      cases_linked_to_jurvio AS "casesLinkedToJurvio", martin_quinn_justices AS "martinQuinnJustices", scdb_version AS "scdbVersion"
    FROM scotus_term_coverage_v ORDER BY term DESC
  `, []);
}

export interface MatrixCell {
  casesTogether: number;
  casesAgreed: number;
  casesExcluded: number;
  rate: number | null;
}

export interface UnusualAlignment {
  scdbCaseId: string;
  caseName: string;
  usCite: string | null;
  decidedOn: string | null;
  majority: string[];
  dissent: string[];
  pair: [string, string];
  pairRate: number;
  pairCasesTogether: number;
  jurvioCaseId: string | null;
}

export interface AgreementMatrix {
  term: number;
  scope: JusticeScope;
  justices: Array<{ scdbJusticeId: number; displayName: string; slug: string; scdbCode: string }>;
  cells: Record<string, MatrixCell>;
  coverage: TermCoverage | null;
  coalitions: Array<{ majority: string[]; decisions: number; liberal: number; conservative: number; unspecifiable: number }>;
  unusual: UnusualAlignment[];
}

export const matrixKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export async function loadAgreementMatrix(sql: Sql, term: number, scope: JusticeScope): Promise<AgreementMatrix> {
  const roster = await listJustices(sql, scope);
  const byId = new Map(roster.map((row) => [row.scdbJusticeId, row]));
  const byCode = new Map(roster.map((row) => [row.scdbCode, row.displayName]));
  const named = (codes: string[]) => codes.map((code) => byCode.get(code) ?? code);
  const [members, pairs, coverage, coalitions, unusual] = await Promise.all([
    sql<Array<{ id: number }>>`
      SELECT scdb_justice_id AS id FROM scotus_justice_direction_mv
      WHERE scope = 'all' AND term_key = ${term} AND issue_area_key = 0
    `,
    sql<Array<{ a: number; b: number; together: number; agreed: number; excluded: number; rate: string | null }>>`
      SELECT justice_a AS a, justice_b AS b, cases_together AS together, cases_agreed AS agreed,
        cases_excluded AS excluded, agreement_rate::text AS rate
      FROM scotus_justice_pair_agreement_mv WHERE scope = ${scope} AND term_key = ${term}
    `,
    listTermCoverage(sql).then((rows) => rows.find((row) => row.term === term) ?? null),
    sql<Array<{ majority: string[]; decisions: number; liberal: number; conservative: number; unspecifiable: number }>>`
      SELECT majority_coalition AS majority, decisions, scdb_liberal_decisions AS liberal,
        scdb_conservative_decisions AS conservative, scdb_unspecifiable_decisions AS unspecifiable
      FROM scotus_five_four_coalition_v WHERE term = ${term} ORDER BY decisions DESC, majority_coalition
    `,
    sql<Array<{ scdbCaseId: string; caseName: string; usCite: string | null; decidedOn: string | null; majority: string[];
      dissent: string[]; a: number; b: number; rate: string; together: number; jurvioCaseId: string | null }>>`
      SELECT u.scdb_case_id AS "scdbCaseId", u.case_name AS "caseName", u.us_cite AS "usCite", u.decided_on::text AS "decidedOn",
        u.majority_coalition AS majority, u.dissenting_coalition AS dissent, u.justice_a AS a, u.justice_b AS b,
        u.lowest_majority_pair_term_agreement::text AS rate, u.lowest_pair_cases_together AS together,
        c.public_id AS "jurvioCaseId"
      FROM scotus_unusual_alignment_v u
      LEFT JOIN legal_case c ON c.id = u.legal_case_id AND c.publication = 'published'
      WHERE u.term = ${term}
      ORDER BY u.lowest_majority_pair_term_agreement, u.decided_on
      LIMIT 5
    `,
  ]);
  const justices = members.map((row) => byId.get(row.id)).filter((row): row is JusticeSummary => Boolean(row))
    .sort((x, y) => (x.serviceStart ?? "").localeCompare(y.serviceStart ?? "") || x.scdbJusticeId - y.scdbJusticeId)
    .map(({ scdbJusticeId, displayName, slug, scdbCode }) => ({ scdbJusticeId, displayName, slug, scdbCode }));
  const cells: Record<string, MatrixCell> = Object.fromEntries(pairs.map((row) => [matrixKey(row.a, row.b), {
    casesTogether: row.together, casesAgreed: row.agreed, casesExcluded: row.excluded, rate: num(row.rate),
  }]));
  return {
    term, scope, justices, cells, coverage,
    coalitions: coalitions.map((row) => ({ ...row, majority: named(row.majority) })),
    unusual: unusual.map((row) => ({
      scdbCaseId: row.scdbCaseId, caseName: row.caseName, usCite: row.usCite, decidedOn: row.decidedOn,
      majority: named(row.majority), dissent: named(row.dissent),
      pair: [byId.get(row.a)?.displayName ?? String(row.a), byId.get(row.b)?.displayName ?? String(row.b)],
      pairRate: Number(row.rate), pairCasesTogether: row.together, jurvioCaseId: row.jurvioCaseId,
    })),
  };
}

export async function listMatrixTerms(sql: Sql): Promise<number[]> {
  const rows = await orEmpty(sql<Array<{ term: number }>>`
    SELECT DISTINCT term_key AS term FROM scotus_justice_pair_agreement_mv WHERE term_key <> 0 ORDER BY term_key DESC
  `, []);
  return rows.map((row) => row.term);
}

export interface CaseLineupVote {
  scdbJusticeId: number;
  name: string;
  slug: string | null;
  side: "majority" | "dissent" | "not recorded";
  /** SCDB vote code: 3 = regular concurrence, 4 = special concurrence (concurred in the judgment only). */
  vote: number | null;
  /** SCDB opinion code: 2 = wrote an opinion, 3 = co-authored one. */
  opinion: number | null;
  voteLabel: string | null;
  opinionLabel: string | null;
  scdbDirectionLabel: string | null;
  wroteMajorityOpinion: boolean;
}

export interface CaseLineup {
  scdbCaseId: string;
  term: number;
  usCite: string | null;
  docket: string | null;
  caseName: string;
  voteSplit: string | null;
  decisionTypeLabel: string | null;
  issueAreaLabel: string | null;
  scdbDecisionDirectionLabel: string | null;
  majorityOpinionWriter: string | null;
  matchMethod: string | null;
  scdbVersion: string | null;
  votes: CaseLineupVote[];
}

interface BreakdownVote {
  scdbJusticeId: number; name: string; code: string; vote: number | null; opinion: number | null; majority: number | null; voteLabel: string | null;
  opinionLabel: string | null; scdbDirectionLabel: string | null;
}

/** The SCDB vote record for a Jurvio case (by public id), or null when no SCDB case is linked to it. */
export async function loadCaseLineup(sql: Sql, publicCaseId: string): Promise<CaseLineup | null> {
  const [row] = await orEmpty(sql<Array<Omit<CaseLineup, "votes"> & { votes: BreakdownVote[]; majOpinWriter: number | null }>>`
    SELECT b.scdb_case_id AS "scdbCaseId", b.term, b.us_cite AS "usCite", b.docket, b.case_name AS "caseName",
      b.vote_split AS "voteSplit", b.decision_type_label AS "decisionTypeLabel", b.issue_area_label AS "issueAreaLabel",
      b.scdb_decision_direction_label AS "scdbDecisionDirectionLabel", b.majority_opinion_writer AS "majorityOpinionWriter",
      b.maj_opin_writer AS "majOpinWriter", b.match_method AS "matchMethod", b.votes,
      (SELECT r.version FROM scdb_case s JOIN scotus_dataset_release r ON r.id = s.release_id WHERE s.scdb_case_id = b.scdb_case_id) AS "scdbVersion"
    FROM scotus_case_vote_breakdown_v b
    WHERE b.legal_case_id = (SELECT c.id FROM legal_case c WHERE c.public_id = ${publicCaseId} LIMIT 1)
    ORDER BY b.decided_on DESC NULLS LAST
    LIMIT 1
  `, []);
  if (!row) return null;
  const roster = await listJustices(sql, "all");
  const slugs = new Map(roster.map((justice) => [justice.scdbJusticeId, justice.slug]));
  const { votes, majOpinWriter, ...rest } = row;
  return {
    ...rest,
    votes: (votes ?? []).map((vote) => ({
      scdbJusticeId: vote.scdbJusticeId,
      name: vote.name,
      slug: slugs.get(vote.scdbJusticeId) ?? null,
      side: vote.majority === 2 ? "majority" : vote.majority === 1 ? "dissent" : "not recorded",
      vote: vote.vote,
      opinion: vote.opinion,
      voteLabel: vote.voteLabel,
      opinionLabel: vote.opinionLabel,
      scdbDirectionLabel: vote.scdbDirectionLabel,
      wroteMajorityOpinion: majOpinWriter === vote.scdbJusticeId,
    })),
  };
}
