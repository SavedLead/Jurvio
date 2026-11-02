import type postgres from "postgres";
import { justiceSlugs } from "@/modules/scotus/domain/justice-slug";
import { buildTermBreakdown, type TermBreakdown, type TermCaseRow, type TermVoteRow } from "@/modules/scotus/domain/term-breakdown";

type Sql = ReturnType<typeof postgres>;

export interface TermJustice { scdbJusticeId: number; code: string; displayName: string; slug: string; serviceStart: string }

export interface TermBreakdownPage {
  breakdown: TermBreakdown;
  /** Same counts over the current members' shared tenure (first term all of this term's justices sat together, through this term). */
  shared: { fromTerm: number; toTerm: number; breakdown: TermBreakdown } | null;
  justices: TermJustice[];
  issueLabels: Record<number, string>;
  martinQuinn: { latestTerm: number | null; releaseVersion: string | null; scores: Record<number, { term: number; mean: number; low: number; high: number }> };
  scdbVersion: string | null;
  terms: number[];
}

async function loadRows(sql: Sql, fromTerm: number, toTerm: number): Promise<{ cases: TermCaseRow[]; votes: TermVoteRow[] }> {
  const [cases, votes] = await Promise.all([
    sql<TermCaseRow[]>`
      SELECT scdb_case_id AS "scdbCaseId", case_name AS "caseName", docket, us_cite AS "usCite", decided_on::text AS "decidedOn",
        decision_type AS "decisionType", issue_area AS "issueArea", decision_direction AS "decisionDirection",
        maj_votes AS "majVotes", min_votes AS "minVotes", maj_opin_writer AS "majOpinWriter"
      FROM scdb_case WHERE term BETWEEN ${fromTerm} AND ${toTerm}
    `,
    sql<TermVoteRow[]>`
      SELECT v.scdb_case_id AS "scdbCaseId", v.scdb_justice_id AS "scdbJusticeId", j.scdb_code AS code,
        v.vote, v.opinion, v.direction, v.majority
      FROM scdb_vote v JOIN scdb_case c ON c.scdb_case_id = v.scdb_case_id JOIN scotus_justice j ON j.scdb_justice_id = v.scdb_justice_id
      WHERE c.term BETWEEN ${fromTerm} AND ${toTerm}
    `,
  ]);
  return { cases: [...cases], votes: [...votes] };
}

export async function listBreakdownTerms(sql: Sql): Promise<number[]> {
  try {
    const rows = await sql<Array<{ term: number }>>`SELECT DISTINCT term FROM scdb_case ORDER BY term DESC`;
    return rows.map((row) => row.term);
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
}

export async function loadTermBreakdown(sql: Sql, term: number): Promise<TermBreakdownPage | null> {
  const terms = await listBreakdownTerms(sql);
  if (!terms.includes(term)) return null;
  const { cases, votes } = await loadRows(sql, term, term);
  const breakdown = buildTermBreakdown(term, cases, votes);
  const memberIds = [...new Set(votes.map((vote) => vote.scdbJusticeId))];

  const [roster, labels, mq, release] = await Promise.all([
    sql<Array<{ scdbJusticeId: number; scdbCode: string; displayName: string; serviceStart: string; serviceEnd: string | null; firstTerm: number | null }>>`
      SELECT j.scdb_justice_id AS "scdbJusticeId", j.scdb_code AS "scdbCode", j.display_name AS "displayName",
        j.scdb_service_start::text AS "serviceStart", j.scdb_service_end::text AS "serviceEnd",
        (SELECT min(c.term) FROM scdb_vote v JOIN scdb_case c ON c.scdb_case_id = v.scdb_case_id WHERE v.scdb_justice_id = j.scdb_justice_id)::int AS "firstTerm"
      FROM scotus_justice j
    `,
    sql<Array<{ code: number; label: string }>>`SELECT code, label FROM scdb_code_label WHERE variable = 'issueArea'`,
    sql<Array<{ id: number; term: number; mean: string; low: string | null; high: string | null }>>`
      SELECT DISTINCT ON (m.scdb_justice_id) m.scdb_justice_id AS id, m.term, m.post_mn::text AS mean, m.post_025::text AS low, m.post_975::text AS high
      FROM martin_quinn_score m WHERE m.scdb_justice_id = ANY(${memberIds}) AND m.term <= ${term}
      ORDER BY m.scdb_justice_id, m.term DESC
    `,
    sql<Array<{ scdb: string | null; mq: string | null; mqLatest: number | null }>>`
      SELECT (SELECT r.version FROM scdb_case s JOIN scotus_dataset_release r ON r.id = s.release_id WHERE s.term = ${term} LIMIT 1) AS scdb,
        (SELECT r.version FROM scotus_dataset_release r WHERE r.source_system = 'martin_quinn' ORDER BY r.version DESC LIMIT 1) AS mq,
        (SELECT max(term)::int FROM martin_quinn_score) AS "mqLatest"
    `,
  ]);
  const slugs = justiceSlugs(roster);
  const justices = roster.filter((row) => memberIds.includes(row.scdbJusticeId))
    .sort((a, b) => a.serviceStart.localeCompare(b.serviceStart))
    .map((row) => ({ scdbJusticeId: row.scdbJusticeId, code: row.scdbCode, displayName: row.displayName, slug: slugs.get(row.scdbJusticeId)!, serviceStart: row.serviceStart }));

  const fromTerm = Math.max(...roster.filter((row) => memberIds.includes(row.scdbJusticeId)).map((row) => row.firstTerm ?? term));
  let shared: TermBreakdownPage["shared"] = null;
  if (fromTerm < term && memberIds.length === 9) {
    const rows = await loadRows(sql, fromTerm, term);
    const members = new Set(memberIds);
    shared = { fromTerm, toTerm: term, breakdown: buildTermBreakdown(term, rows.cases, rows.votes.filter((vote) => members.has(vote.scdbJusticeId))) };
  }

  return {
    breakdown, shared, justices,
    issueLabels: Object.fromEntries(labels.map((row) => [row.code, row.label])),
    martinQuinn: {
      latestTerm: release[0]?.mqLatest ?? null,
      releaseVersion: release[0]?.mq ?? null,
      scores: Object.fromEntries(mq.map((row) => [row.id, { term: row.term, mean: Number(row.mean), low: Number(row.low), high: Number(row.high) }])),
    },
    scdbVersion: release[0]?.scdb ?? null,
    terms,
  };
}
