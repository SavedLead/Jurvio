import type postgres from "postgres";
import { extractCaseCitations, extractCourtListenerLinks } from "../domain/citations";
type Sql = ReturnType<typeof postgres>;
export interface PublicCitationTarget { citationKey: string; casePublicId: string; caption: string; courtName: string; decidedOn: string | null; machineAccessible: boolean }
export async function publicCitationTargets(sql: Sql, text: string, html=""): Promise<PublicCitationTarget[]> {
  const keys = [...new Set([...extractCaseCitations(text),...extractCourtListenerLinks(html)].filter(cite=>!cite.ambiguous).map(cite=>cite.key))];
  if (!keys.length) return [];
  return sql<PublicCitationTarget[]>`
    SELECT identity.citation_key AS "citationKey", c.public_id AS "casePublicId", c.caption,
      court.name AS "courtName", c.decided_on::text AS "decidedOn",
      COALESCE((SELECT machine_accessible FROM publication_decision WHERE object_type='legal_case' AND object_id=c.id ORDER BY decided_at DESC,id DESC LIMIT 1),false) AS "machineAccessible"
    FROM case_citation_identity identity JOIN legal_case c ON c.id=identity.case_id JOIN court ON court.id=c.court_id
    WHERE NOT EXISTS(SELECT 1 FROM case_citation_identity other WHERE other.citation_key=identity.citation_key AND other.case_id<>identity.case_id) AND identity.citation_key IN ${sql(keys)} AND c.publication='published'
      AND COALESCE((SELECT displayable FROM publication_decision WHERE object_type='legal_case' AND object_id=c.id ORDER BY decided_at DESC,id DESC LIMIT 1),false)
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
      AND COALESCE((SELECT displayable FROM publication_decision WHERE object_type='legal_case' AND object_id=current_case.id ORDER BY decided_at DESC,id DESC LIMIT 1),false)
      AND COALESCE((SELECT displayable FROM publication_decision WHERE object_type='legal_case' AND object_id=related.id ORDER BY decided_at DESC,id DESC LIMIT 1),false)
      AND COALESCE((SELECT displayable FROM publication_decision WHERE object_type='document' AND object_id=d.id ORDER BY decided_at DESC,id DESC LIMIT 1),false)
    ORDER BY related.id, d.filed_on DESC NULLS LAST, d.id, ref.start_offset LIMIT ${limit}
  `;
}
