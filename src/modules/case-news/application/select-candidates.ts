import type { Sql } from "postgres";
import { caseNewsEligibleSql } from "./eligibility";

export type PriorityTier = "scotus" | "appeals" | "cited" | "government" | "big_company";

export interface CaseNewsCandidate {
  caseId: string;
  publicId: string;
  caption: string;
  docketNumber: string;
  filedOn: string | null;
  decidedOn: string | null;
  courtCode: string | null;
  courtName: string | null;
  tier: PriorityTier;
}

const APPEALS_CODES = ["ca1", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9", "ca10", "ca11", "cadc", "cafc"];
// How long to wait before asking again, by tier (SCOTUS and appeals first; David 2026-10-31).
export const RECHECK_HOURS: Record<PriorityTier, number> = { scotus: 24, appeals: 48, cited: 96, government: 96, big_company: 120 };
const TIER_ORDER: PriorityTier[] = ["scotus", "appeals", "cited", "government", "big_company"];

type Row = Omit<CaseNewsCandidate, "tier">;

const columns = `c.id AS "caseId", c.public_id AS "publicId", c.caption, c.docket_number AS "docketNumber",
  c.filed_on::text AS "filedOn", c.decided_on::text AS "decidedOn", ct.provider_court_id AS "courtCode", ct.name AS "courtName"`;
const NOT_DUE = `NOT EXISTS (SELECT 1 FROM case_news_query_state s WHERE s.case_id = c.id AND s.next_due_at > now())`;

async function recentInCourts(sql: Sql, codes: string[], sinceDays: number, limit: number, notDue: string): Promise<Row[]> {
  // Court-led browse index (court_id, COALESCE(decided_on, filed_on) DESC) WHERE published.
  return sql.unsafe<Row[]>(`
    SELECT ${columns}
    FROM court ct
    CROSS JOIN LATERAL (
      SELECT c.* FROM legal_case c
      WHERE c.court_id = ct.id AND c.publication = 'published'
        AND COALESCE(c.decided_on, c.filed_on) >= current_date - $2::int
      ORDER BY COALESCE(c.decided_on, c.filed_on) DESC
      LIMIT $3
    ) c
    WHERE ct.provider_court_id = ANY($1::text[]) AND ${notDue} AND ${caseNewsEligibleSql("c")}
    ORDER BY COALESCE(c.decided_on, c.filed_on) DESC
    LIMIT $3`, [codes, sinceDays, limit]);
}

async function recentlyUpdatedInCourts(sql: Sql, codes: string[], sinceDays: number, limit: number, notDue: string): Promise<Row[]> {
  // Appeals cases from the live feeds often carry no filed/decided date; their
  // updated_at moves when a new opinion or order arrives.
  return sql.unsafe<Row[]>(`
    SELECT ${columns}
    FROM legal_case c JOIN court ct ON ct.id = c.court_id
    WHERE c.publication = 'published' AND c.updated_at >= now() - make_interval(days => $2::int)
      AND ct.provider_court_id = ANY($1::text[]) AND ${notDue} AND ${caseNewsEligibleSql("c")}
    ORDER BY c.updated_at DESC
    LIMIT $3`, [codes, sinceDays, limit]);
}

async function citedRecent(sql: Sql, sinceDays: number, limit: number, notDue: string): Promise<Row[]> {
  return sql.unsafe<Row[]>(`
    SELECT ${columns}
    FROM case_citation_count cc
    JOIN legal_case c ON c.id = cc.case_id
    JOIN court ct ON ct.id = c.court_id
    WHERE cc.cited_by >= 3 AND COALESCE(c.decided_on, c.filed_on) >= current_date - $1::int
      AND ${notDue} AND ${caseNewsEligibleSql("c")}
    ORDER BY cc.cited_by DESC
    LIMIT $2`, [sinceDays, limit]);
}

async function partyPattern(sql: Sql, pattern: string, sinceDays: number, limit: number, notDue: string): Promise<Row[]> {
  // Global recency index (COALESCE(decided_on, filed_on) DESC) WHERE published; stops at `limit`.
  return sql.unsafe<Row[]>(`
    SELECT ${columns}
    FROM (
      SELECT c.* FROM legal_case c
      WHERE c.publication = 'published' AND COALESCE(c.decided_on, c.filed_on) >= current_date - $2::int
        AND c.caption ~* $1
      ORDER BY COALESCE(c.decided_on, c.filed_on) DESC NULLS LAST
      LIMIT $3 * 4
    ) c
    JOIN court ct ON ct.id = c.court_id
    WHERE ${notDue} AND ${caseNewsEligibleSql("c")}
    LIMIT $3`, [pattern, sinceDays, limit]);
}

// Agency plaintiffs and prosecutors whose cases get press: SEC, FTC, CFPB, DOJ civil/antitrust.
const GOVERNMENT_PATTERN = "^(securities and exchange commission|sec|federal trade commission|ftc|consumer financial protection bureau|commodity futures trading commission|united states|usa)\\M.*\\m(inc|llc|corp|corporation|company|co|ltd|plc|l\\.p|n\\.a|holdings|bank)\\M";
const BIG_COMPANY_PATTERN = "\\m(inc|corp|corporation|llc|ltd|plc|holdings)\\.?\\M";

export interface CandidateOptions {
  limit: number;
  /** Look-back on activity. GDELT only searches about the last three months. */
  sinceDays?: number;
  tiers?: PriorityTier[];
  /** Ignore the GDELT recheck schedule (the RSS matcher wants every active priority case). */
  ignoreSchedule?: boolean;
}

/** Candidates in priority order: SCOTUS, then courts of appeals, then cited, agency and big-company cases. */
export async function selectCaseNewsCandidates(sql: Sql, options: CandidateOptions): Promise<CaseNewsCandidate[]> {
  const since = options.sinceDays ?? 100;
  const due = options.ignoreSchedule ? "TRUE" : NOT_DUE;
  const tiers = options.tiers ?? TIER_ORDER;
  const seen = new Set<string>();
  const out: CaseNewsCandidate[] = [];
  const add = (rows: Row[], tier: PriorityTier) => {
    for (const row of rows) {
      if (out.length >= options.limit) return;
      if (seen.has(row.caseId)) continue;
      seen.add(row.caseId);
      out.push({ ...row, tier });
    }
  };
  for (const tier of TIER_ORDER) {
    if (!tiers.includes(tier) || out.length >= options.limit) continue;
    const remaining = options.limit - out.length;
    if (tier === "scotus") {
      // The current term's docket: wider window, filings are old by decision time.
      add(await recentInCourts(sql, ["scotus"], Math.max(since, 400), remaining, due), tier);
      if (out.length < options.limit) add(await recentlyUpdatedInCourts(sql, ["scotus"], since, options.limit - out.length, due), tier);
    } else if (tier === "appeals") {
      add(await recentInCourts(sql, APPEALS_CODES, since, remaining, due), tier);
      if (out.length < options.limit) add(await recentlyUpdatedInCourts(sql, APPEALS_CODES, Math.min(since, 30), options.limit - out.length, due), tier);
    } else if (tier === "cited") {
      add(await citedRecent(sql, since, remaining, due), tier);
    } else if (tier === "government") {
      add(await partyPattern(sql, GOVERNMENT_PATTERN, since, remaining, due), tier);
    } else {
      add(await partyPattern(sql, BIG_COMPANY_PATTERN, since, remaining, due), tier);
    }
  }
  return out;
}
