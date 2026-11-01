import type postgres from "postgres";
import { latestPublicationColumnSql, type PublicationFlag } from "@/modules/publication/application/current-visibility";
import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import { extractCaseCitations, extractCourtListenerLinks } from "../domain/citations";
import { citationCaseVisibleSql, citationDocumentVisibleSql } from "./citation-edges";
type Sql = ReturnType<typeof postgres>;

function visible(sql: Sql, column: PublicationFlag, objectType: "legal_case" | "document", objectIdExpr: string) {
  return sql.unsafe(latestPublicationColumnSql(column, objectType, objectIdExpr));
}
export interface PublicCitationTarget { citationKey: string; casePublicId: string; caption: string; courtName: string; decidedOn: string | null; machineAccessible: boolean }
export async function publicCitationTargets(sql: Sql, text: string, html=""): Promise<PublicCitationTarget[]> {
  const keys = [...new Set([...extractCaseCitations(text),...extractCourtListenerLinks(html)].filter(cite=>!cite.ambiguous).map(cite=>cite.key))];
  if (!keys.length) return [];
  return sql<PublicCitationTarget[]>`
    SELECT identity.citation_key AS "citationKey", c.public_id AS "casePublicId", c.caption,
      court.name AS "courtName", c.decided_on::text AS "decidedOn",
      ${visible(sql, "machine_accessible", "legal_case", "c.id")} AS "machineAccessible"
    FROM case_citation_identity identity JOIN legal_case c ON c.id=identity.case_id JOIN court ON court.id=c.court_id
    WHERE NOT EXISTS(SELECT 1 FROM case_citation_identity other WHERE other.citation_key=identity.citation_key AND other.case_id<>identity.case_id) AND identity.citation_key IN ${sql(keys)} AND c.publication='published'
      AND ${visible(sql, "displayable", "legal_case", "c.id")}
      AND NOT ${sql.unsafe(searchExcludedCaseSql("c"))}
  `;
}
export interface RelatedCitationCase { casePublicId: string; caption: string; courtName: string; documentPublicId: string; citationLabel: string }
/**
 * True once the first full citation-edge sweep has finished (migration 0172).
 * Until then pages keep the live join so lists never shrink mid-backfill.
 */
export async function precomputedEdgesReady(sql: Sql): Promise<boolean> {
  try {
    const [row] = await sql<{ ready: boolean }[]>`SELECT first_completed_at IS NOT NULL AS ready FROM citation_edge_build WHERE id`;
    return Boolean(row?.ready);
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return false;
    throw error;
  }
}

export async function relatedCitationCases(sql: Sql, casePublicId: string, direction: "cited"|"citing", limit=50): Promise<RelatedCitationCase[]> {
  if (await precomputedEdgesReady(sql)) return precomputedRelatedCases(sql, casePublicId, direction, limit);
  return liveRelatedCitationCases(sql, casePublicId, direction, limit);
}

/**
 * First page of Cites / Cited-by from case_citation_edge: an index range scan
 * on (citing_case_id) or (cited_case_id, citing_filed_on DESC), with both ends
 * and the citing opinion re-checked for visibility at read time.
 */
export async function precomputedRelatedCases(sql: Sql, casePublicId: string, direction: "cited"|"citing", limit=50): Promise<RelatedCitationCase[]> {
  const cited = direction === "cited";
  return sql<RelatedCitationCase[]>`
    SELECT related.public_id AS "casePublicId", related.caption, court.name AS "courtName",
      d.public_id AS "documentPublicId", COALESCE(e.citation_label, related.official_citation, '') AS "citationLabel"
    FROM legal_case current_case
    JOIN case_citation_edge e ON ${cited ? sql`e.citing_case_id = current_case.id` : sql`e.cited_case_id = current_case.id`}
    JOIN legal_case related ON related.id = ${cited ? sql`e.cited_case_id` : sql`e.citing_case_id`}
    JOIN court ON court.id = related.court_id
    JOIN document d ON d.id = e.citing_document_id
    WHERE current_case.public_id = ${casePublicId}
      AND ${sql.unsafe(citationCaseVisibleSql("current_case"))}
      AND ${sql.unsafe(citationCaseVisibleSql("related"))}
      AND ${sql.unsafe(citationDocumentVisibleSql("d"))}
    ORDER BY ${cited ? sql`e.mentions DESC, e.depth DESC NULLS LAST, e.cited_case_id` : sql`e.citing_filed_on DESC NULLS LAST, e.citing_case_id`}
    LIMIT ${limit}
  `;
}

/** The pre-0172 live join, kept as the fallback until the first sweep completes. */
export async function liveRelatedCitationCases(sql: Sql, casePublicId: string, direction: "cited"|"citing", limit=50): Promise<RelatedCitationCase[]> {
  return sql<RelatedCitationCase[]>`
    SELECT DISTINCT ON (related.id) related.public_id AS "casePublicId", related.caption,
      court.name AS "courtName", d.public_id AS "documentPublicId", ref.citation_label AS "citationLabel"
    FROM legal_case current_case
    JOIN ${direction==='cited' ? sql`document d ON d.case_id=current_case.id` : sql`case_citation_identity identity ON identity.case_id=current_case.id`}
    JOIN ${direction==='cited' ? sql`document_case_citation ref ON ref.document_id=d.id` : sql`document_case_citation ref ON ref.citation_key=identity.citation_key`}
    JOIN ${direction==='cited' ? sql`case_citation_identity identity ON identity.citation_key=ref.citation_key` : sql`document d ON d.id=ref.document_id`}
    JOIN legal_case related ON related.id=${direction==='cited' ? sql`identity.case_id` : sql`d.case_id`}
    JOIN court ON court.id=related.court_id
    JOIN document_content content ON content.document_id=d.id AND content.content_hash=ref.source_content_hash
    WHERE NOT EXISTS(SELECT 1 FROM case_citation_identity other WHERE other.citation_key=identity.citation_key AND other.case_id<>identity.case_id) AND current_case.public_id=${casePublicId} AND related.id<>current_case.id
      AND current_case.publication='published' AND related.publication='published' AND d.publication='published'
      AND ${visible(sql, "displayable", "legal_case", "current_case.id")}
      AND ${visible(sql, "displayable", "legal_case", "related.id")}
      AND ${visible(sql, "displayable", "document", "d.id")}
      -- Subscriber-only (sealed-style) cases never appear as public citation links.
      AND NOT ${sql.unsafe(searchExcludedCaseSql("related"))}
    ORDER BY related.id, d.filed_on DESC NULLS LAST, d.id, ref.start_offset LIMIT ${limit}
  `;
}
export interface CaseCitationCounts { cited: number; citedOnJurvio: number; citedBy: number }
/**
 * Totals behind the case page's citation counter. Uses the same visibility rules
 * as relatedCitationCases (published + displayable on both ends, current content
 * hash, unique identity only) so the counts never exceed what the lists can show
 * once uncapped. Counts reporter citations in the court's text; the case's own
 * citations (opinion headers repeat them) are excluded.
 *
 * Uniqueness is checked only for this case's citation keys. The
 * unique_case_citation view groups every identity row; on 2026-10-29 that was
 * 521,169 groups, twice, and EXPLAIN ANALYZE for jv-h762f92ca8 took 8,909 ms.
 */
export async function caseCitationCounts(sql: Sql, casePublicId: string): Promise<CaseCitationCounts> {
  // The live graph below is several seconds for a widely cited key. The
  // citations lane stores the same totals in case_citation_count; a page read
  // is one index lookup. Missing table or missing row falls through.
  try {
    const [stored] = await sql<CaseCitationCounts[]>`
      SELECT stat.cited::int AS cited,
        stat.cited_on_jurvio::int AS "citedOnJurvio",
        stat.cited_by::int AS "citedBy"
      FROM legal_case c
      JOIN case_citation_count stat ON stat.case_id = c.id
      WHERE c.public_id = ${casePublicId}
    `;
    if (stored) return stored;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "42P01") throw error;
  }
  const [row] = await sql<CaseCitationCounts[]>`
    WITH current_case AS MATERIALIZED (
      SELECT c.id FROM legal_case c
      WHERE c.public_id=${casePublicId} AND c.publication='published'
        AND ${visible(sql, "displayable", "legal_case", "c.id")}
    ), visible_documents AS MATERIALIZED (
      SELECT d.id, content.content_hash FROM current_case cc
      JOIN document d ON d.case_id=cc.id AND d.publication='published'
      JOIN document_content content ON content.document_id=d.id
      WHERE ${visible(sql, "displayable", "document", "d.id")}
    ), cited_keys AS MATERIALIZED (
      SELECT DISTINCT ref.citation_key FROM visible_documents vd
      JOIN document_case_citation ref ON ref.document_id=vd.id AND ref.source_content_hash=vd.content_hash AND ref.location_kind='text'
      WHERE NOT EXISTS(SELECT 1 FROM case_citation_identity own JOIN current_case cc ON cc.id=own.case_id WHERE own.citation_key=ref.citation_key)
    ), unique_cited AS MATERIALIZED (
      SELECT k.citation_key, min(probe.case_id::text)::uuid AS case_id
      FROM cited_keys k
      JOIN LATERAL (
        SELECT identity.case_id FROM case_citation_identity identity
        WHERE identity.citation_key=k.citation_key
        LIMIT 2
      ) probe ON true
      GROUP BY k.citation_key
      HAVING count(*)=1
    ), cited_on_jurvio AS (
      SELECT u.citation_key FROM unique_cited u
      JOIN legal_case target ON target.id=u.case_id AND target.publication='published'
      WHERE ${visible(sql, "displayable", "legal_case", "target.id")}
    ), own_unique_keys AS MATERIALIZED (
      SELECT own.citation_key, cc.id AS case_id FROM current_case cc
      JOIN case_citation_identity own ON own.case_id=cc.id
      WHERE (
        SELECT count(*) FROM (
          SELECT 1 FROM case_citation_identity other
          WHERE other.citation_key=own.citation_key
          LIMIT 2
        ) probe
      )=1
    ), citing_cases AS (
      -- One row per document. Opinions repeat the same reporter cite, and the
      -- 4.8s plan was a nested loop of document, content, and publication
      -- checks for every repetition. Distinct document ids keep the same
      -- distinct case count.
      SELECT DISTINCT d.case_id FROM own_unique_keys own_key
      JOIN LATERAL (
        SELECT DISTINCT ref.document_id, ref.source_content_hash
        FROM document_case_citation ref
        WHERE ref.citation_key=own_key.citation_key
      ) ref ON true
      JOIN document d ON d.id=ref.document_id AND d.publication='published' AND d.case_id<>own_key.case_id
      JOIN document_content content ON content.document_id=d.id AND content.content_hash=ref.source_content_hash
      JOIN legal_case citing ON citing.id=d.case_id AND citing.publication='published'
      WHERE ${visible(sql, "displayable", "document", "d.id")}
        AND ${visible(sql, "displayable", "legal_case", "citing.id")}
    )
    SELECT (SELECT count(*) FROM cited_keys)::int AS cited,
      (SELECT count(*) FROM cited_on_jurvio)::int AS "citedOnJurvio",
      (SELECT count(*) FROM citing_cases)::int AS "citedBy"
  `;
  return row ?? { cited: 0, citedOnJurvio: 0, citedBy: 0 };
}
