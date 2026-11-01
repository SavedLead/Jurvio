import type postgres from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { readOverruledParenthetical, type OverruledCandidate } from "@/modules/plain-english/domain/case-standing";

type Sql = ReturnType<typeof postgres>;

export interface CaseStandingSignals {
  clusterDisposition: string | null;
  precedentialStatus: string | null;
  opinionTail: string | null;
  /** First ~20,000 characters of the same opinion: its caption block (party roles) and how the case came up. */
  opinionHead: string | null;
  /** Supreme Court Database vote counts carried on the CourtListener cluster. */
  votes: { majority: number; minority: number } | null;
  /** "Overruled by …" parentheticals; the summary keeps only ones naming a court that can overrule the case. */
  overruled: OverruledCandidate[];
}

// Passed as a bind parameter: backslashes in a template literal would be eaten.
const OVERRULED_PATTERN = String.raw`^\s*((expressly|implicitly|partially)\s+)?(overruled|abrogated)\M`;

// The court's own opinion ends where the first separate opinion begins ("JUSTICE WHITE, concurring.",
// "EASTERBROOK, Circuit Judge, dissenting."). CourtListener's combined text carries them all, so the
// judgment line is read from the text before that point (the earliest marker; ~10 ms on a 150 KB opinion).
const SEPARATE_OPINION_PATTERN = String.raw`(?:(?:MR\. )?JUSTICE [A-Z][A-Z'’]+(?: [A-Z][A-Z'’]+)?,(?: with whom [^.]{0,250}?)? (?:concurring|dissenting)|[A-Z][A-Za-z'’-]+, (?:Chief |Senior )?(?:Circuit|District) Judge, (?:concurring|dissenting))`;

const EMPTY: CaseStandingSignals = { clusterDisposition: null, precedentialStatus: null, opinionTail: null, opinionHead: null, votes: null, overruled: [] };

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
      opinionHead: string | null;
      votes: { majority: string | null; minority: string | null } | null;
      overruled: Array<{ text: string; citingCaption: string | null; citingPublicId: string | null }> | null;
    }>>`
      SELECT
        (SELECT oc.provider_metadata->>'disposition' FROM opinion_cluster oc
          WHERE oc.case_id = c.id AND coalesce(oc.provider_metadata->>'disposition', '') <> ''
          ORDER BY oc.date_filed DESC NULLS LAST LIMIT 1) AS "clusterDisposition",
        (SELECT oc.precedential_status FROM opinion_cluster oc
          WHERE oc.case_id = c.id AND oc.precedential_status IS NOT NULL
          ORDER BY oc.date_filed DESC NULLS LAST LIMIT 1) AS "precedentialStatus",
        (SELECT jsonb_build_object('majority', oc.provider_metadata->>'scdb_votes_majority', 'minority', oc.provider_metadata->>'scdb_votes_minority')
           FROM opinion_cluster oc
          WHERE oc.case_id = c.id AND coalesce(oc.provider_metadata->>'scdb_votes_majority', '') ~ '^[0-9]$'
          ORDER BY oc.date_filed DESC NULLS LAST LIMIT 1) AS votes,
        ${opinionDocumentPublicId
          ? sql`(SELECT right(coalesce(left(dc.content_text, strpos(dc.content_text, substring(dc.content_text FROM ${SEPARATE_OPINION_PATTERN})) - 1), dc.content_text), 1600) FROM document d JOIN document_content dc ON dc.document_id = d.id
                  WHERE d.case_id = c.id AND d.public_id = ${opinionDocumentPublicId} AND d.publication = 'published')`
          : sql`NULL::text`} AS "opinionTail",
        ${opinionDocumentPublicId
          ? sql`(SELECT left(dc.content_text, 20000) FROM document d JOIN document_content dc ON dc.document_id = d.id
                  WHERE d.case_id = c.id AND d.public_id = ${opinionDocumentPublicId} AND d.publication = 'published')`
          : sql`NULL::text`} AS "opinionHead",
        (SELECT jsonb_agg(jsonb_build_object('text', p.text, 'citingCaption', citing.caption, 'citingPublicId', citing.public_id))
           FROM (SELECT p.text, p.citing_document_id FROM courtlistener_parenthetical p
                  WHERE p.cited_case_id = c.id AND p.text ~* ${OVERRULED_PATTERN}
                  ORDER BY p.score DESC NULLS LAST LIMIT 25) p
           JOIN document d ON d.id = p.citing_document_id AND d.publication = 'published'
           JOIN legal_case citing ON citing.id = d.case_id AND citing.publication = 'published'
          WHERE ${sql.unsafe(latestPublicationColumnSql("displayable", "legal_case", "citing.id"))}
            AND ${sql.unsafe(latestPublicationColumnSql("displayable", "document", "d.id"))}
            AND NOT ${sql.unsafe(searchExcludedCaseSql("citing"))}) AS overruled
      FROM legal_case c
      WHERE c.public_id = ${casePublicId} AND c.publication = 'published'
    `;
    if (!row) return EMPTY;
    const overruled = (row.overruled ?? [])
      .map((item) => ({ ...item, text: readOverruledParenthetical(item.text) }))
      .filter((item): item is typeof item & { text: string } => Boolean(item.text))
      .map((item) => ({
        text: item.text,
        citingCaption: item.citingCaption ? cleanCaseCaption(item.citingCaption) : null,
        citingPath: item.citingPublicId ? `/case/${item.citingPublicId}` : null,
      }));
    return {
      clusterDisposition: row.clusterDisposition,
      precedentialStatus: row.precedentialStatus,
      opinionTail: row.opinionTail,
      opinionHead: row.opinionHead,
      votes: parseVotes(row.votes),
      overruled,
    };
  } catch {
    return EMPTY;
  }
}

function parseVotes(value: { majority: string | null; minority: string | null } | null) {
  const majority = Number(value?.majority);
  const minority = Number(value?.minority ?? 0);
  if (!Number.isInteger(majority) || !Number.isInteger(minority) || majority < 1 || majority > 9 || minority < 0 || majority + minority > 9 || minority > majority) return null;
  return { majority, minority };
}
