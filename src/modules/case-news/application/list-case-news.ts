import type { Sql } from "postgres";
import { caseNewsEligibleSql } from "./eligibility";

export interface CaseNewsLink {
  id: string;
  url: string;
  outlet: string;
  title: string;
  snippet: string | null;
  publishedAt: string;
  source: string;
}

export interface RecentCaseNewsLink extends CaseNewsLink {
  casePublicId: string;
  caseCaption: string;
}

export interface CaseNewsReviewItem extends RecentCaseNewsLink {
  courtCode: string | null;
  matchMethod: string;
  matchScore: number;
  matchEvidence: Record<string, unknown>;
  firstSeenAt: string;
}

/** Sources whose terms do not allow display on Jurvio; never shown or queued even if a row exists. */
export const DISALLOWED_SOURCES = ["google_news_rss"] as const;
const ALLOWED_SOURCE = `l.source NOT IN (${DISALLOWED_SOURCES.map((source) => `'${source}'`).join(", ")})`;
const VISIBLE = `l.review_status IN ('auto_published', 'approved') AND ${ALLOWED_SOURCE}`;

/** Visible coverage for one case page; empty for sealed, restricted or hidden cases. */
export async function listCaseNews(sql: Sql, casePublicId: string, limit = 10): Promise<CaseNewsLink[]> {
  return sql.unsafe<CaseNewsLink[]>(`
    SELECT l.id, l.url, l.outlet, l.title, l.snippet, l.published_at::text AS "publishedAt", l.source
    FROM legal_case c
    JOIN case_news_link l ON l.case_id = c.id AND ${VISIBLE}
    WHERE c.public_id = $1 AND ${caseNewsEligibleSql("c")}
    ORDER BY l.published_at DESC
    LIMIT $2`, [casePublicId, limit]);
}

/** Recent coverage across cases for /news; one row per article URL. */
export async function listRecentCaseNews(sql: Sql, limit = 50): Promise<RecentCaseNewsLink[]> {
  const rows = await sql.unsafe<RecentCaseNewsLink[]>(`
    SELECT DISTINCT ON (recent.url) recent.id, recent.url, recent.outlet, recent.title, recent.snippet,
      recent."publishedAt", recent.source, recent."casePublicId", recent."caseCaption"
    FROM (
      SELECT l.id, l.url, l.outlet, l.title, l.snippet, l.published_at::text AS "publishedAt", l.source,
        c.public_id AS "casePublicId", c.caption AS "caseCaption"
      FROM case_news_link l
      JOIN legal_case c ON c.id = l.case_id
      WHERE ${VISIBLE} AND l.published_at >= now() - interval '60 days' AND ${caseNewsEligibleSql("c")}
      ORDER BY l.published_at DESC
      LIMIT $1 * 3
    ) recent
    ORDER BY recent.url, recent."publishedAt" DESC`, [limit]);
  return rows.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
}

export async function listCaseNewsReviewQueue(sql: Sql, limit = 100): Promise<CaseNewsReviewItem[]> {
  return sql.unsafe<CaseNewsReviewItem[]>(`
    SELECT l.id, l.url, l.outlet, l.title, l.snippet, l.published_at::text AS "publishedAt", l.source,
      c.public_id AS "casePublicId", c.caption AS "caseCaption", ct.provider_court_id AS "courtCode",
      l.match_method AS "matchMethod", l.match_score::float8 AS "matchScore", l.match_evidence AS "matchEvidence",
      l.first_seen_at::text AS "firstSeenAt"
    FROM case_news_link l
    JOIN legal_case c ON c.id = l.case_id
    JOIN court ct ON ct.id = c.court_id
    WHERE l.review_status = 'pending_review' AND ${ALLOWED_SOURCE} AND ${caseNewsEligibleSql("c")}
    ORDER BY l.match_score DESC, l.first_seen_at DESC
    LIMIT $1`, [limit]);
}

export async function decideCaseNewsLink(sql: Sql, input: { id: string; decision: "approved" | "rejected"; reviewer: string }): Promise<boolean> {
  const rows = await sql`
    UPDATE case_news_link SET review_status = ${input.decision}, reviewed_by = ${input.reviewer}, reviewed_at = now(), updated_at = now()
    WHERE id = ${input.id} AND review_status IN ('pending_review', 'auto_published', 'approved', 'rejected')
    RETURNING id`;
  return rows.length > 0;
}
