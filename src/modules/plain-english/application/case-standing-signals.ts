import type postgres from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { readOverruledParenthetical } from "@/modules/plain-english/domain/case-standing";

type Sql = ReturnType<typeof postgres>;

export interface CaseStandingSignals {
  clusterDisposition: string | null;
  precedentialStatus: string | null;
  opinionTail: string | null;
  overruled: { text: string; citingCaption: string | null; citingPath: string | null } | null;
}

// Passed as a bind parameter: backslashes in a template literal would be eaten.
const OVERRULED_PATTERN = String.raw`^\s*((expressly|implicitly|partially)\s+)?(overruled|abrogated)\M`;

const EMPTY: CaseStandingSignals = { clusterDisposition: null, precedentialStatus: null, opinionTail: null, overruled: null };

/**
 * One indexed round trip for the "Where this case stands" summary:
 * the provider cluster disposition and precedential status, the last ~1,600
 * characters of the case's main (already public) opinion, and up to five
 * "overruled by" parentheticals from later published, displayable opinions.
 * Never throws: a failure only hides the extra signals.
 */
export async function loadCaseStandingSignals(sql: Sql, casePublicId: string, opinionDocumentPublicId: string | null): Promise<CaseStandingSignals> {
  try {
    const [row] = await sql<Array<{
      clusterDisposition: string | null;
      precedentialStatus: string | null;
      opinionTail: string | null;
      overruled: Array<{ text: string; citingCaption: string | null; citingPublicId: string | null }> | null;
    }>>`
      SELECT
        (SELECT oc.provider_metadata->>'disposition' FROM opinion_cluster oc
          WHERE oc.case_id = c.id AND coalesce(oc.provider_metadata->>'disposition', '') <> ''
          ORDER BY oc.date_filed DESC NULLS LAST LIMIT 1) AS "clusterDisposition",
        (SELECT oc.precedential_status FROM opinion_cluster oc
          WHERE oc.case_id = c.id AND oc.precedential_status IS NOT NULL
          ORDER BY oc.date_filed DESC NULLS LAST LIMIT 1) AS "precedentialStatus",
        ${opinionDocumentPublicId
          ? sql`(SELECT right(dc.content_text, 1600) FROM document d JOIN document_content dc ON dc.document_id = d.id
                  WHERE d.case_id = c.id AND d.public_id = ${opinionDocumentPublicId} AND d.publication = 'published')`
          : sql`NULL::text`} AS "opinionTail",
        (SELECT jsonb_agg(jsonb_build_object('text', p.text, 'citingCaption', citing.caption, 'citingPublicId', citing.public_id))
           FROM (SELECT p.text, p.citing_document_id FROM courtlistener_parenthetical p
                  WHERE p.cited_case_id = c.id AND p.text ~* ${OVERRULED_PATTERN}
                  ORDER BY p.score DESC NULLS LAST LIMIT 5) p
           JOIN document d ON d.id = p.citing_document_id AND d.publication = 'published'
           JOIN legal_case citing ON citing.id = d.case_id AND citing.publication = 'published'
          WHERE ${sql.unsafe(latestPublicationColumnSql("displayable", "legal_case", "citing.id"))}
            AND ${sql.unsafe(latestPublicationColumnSql("displayable", "document", "d.id"))}
            AND NOT ${sql.unsafe(searchExcludedCaseSql("citing"))}) AS overruled
      FROM legal_case c
      WHERE c.public_id = ${casePublicId} AND c.publication = 'published'
    `;
    if (!row) return EMPTY;
    const hit = (row.overruled ?? []).map((item) => ({ ...item, text: readOverruledParenthetical(item.text) })).find((item) => item.text);
    return {
      clusterDisposition: row.clusterDisposition,
      precedentialStatus: row.precedentialStatus,
      opinionTail: row.opinionTail,
      overruled: hit?.text
        ? { text: hit.text, citingCaption: hit.citingCaption ? cleanCaseCaption(hit.citingCaption) : null, citingPath: hit.citingPublicId ? `/case/${hit.citingPublicId}` : null }
        : null,
    };
  } catch {
    return EMPTY;
  }
}
