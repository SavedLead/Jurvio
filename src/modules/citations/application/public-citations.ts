import type postgres from "postgres";
import { latestPublicationColumnSql, type PublicationFlag } from "@/modules/publication/application/current-visibility";
import { extractCaseCitations, extractCourtListenerLinks } from "../domain/citations";
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
  `;
}
export interface RelatedCitationCase { casePublicId: string; caption: string; courtName: string; documentPublicId: string; citationLabel: string }
export async function relatedCitationCases(sql: Sql, casePublicId: string, direction: "cited"|"citing", limit=50): Promise<RelatedCitationCase[]> {
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
 */
export async function caseCitationCounts(sql: Sql, casePublicId: string): Promise<CaseCitationCounts> {
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
    ), cited_on_jurvio AS (
      SELECT DISTINCT k.citation_key FROM cited_keys k
      JOIN unique_case_citation u ON u.citation_key=k.citation_key
      JOIN legal_case target ON target.id=u.case_id AND target.publication='published'
      WHERE ${visible(sql, "displayable", "legal_case", "target.id")}
    ), citing_cases AS (
      SELECT DISTINCT d.case_id FROM current_case cc
      JOIN unique_case_citation u ON u.case_id=cc.id
      JOIN document_case_citation ref ON ref.citation_key=u.citation_key
      JOIN document d ON d.id=ref.document_id AND d.publication='published' AND d.case_id<>cc.id
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
