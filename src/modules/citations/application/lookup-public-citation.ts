import type postgres from "postgres";
import { parseCitation, type ParsedCitation } from "../domain/citation";
type Sql = ReturnType<typeof postgres>;

export interface PublicCitationMatch {
  casePublicId: string; caption: string; courtName: string; docketNumber: string;
  officialCitation: string; decidedOn: string | null;
}
export interface CitationLookupResult { parsed: ParsedCitation | null; matches: PublicCitationMatch[]; }

export async function lookupPublicCitation(sql: Sql, input: string): Promise<CitationLookupResult> {
  const parsed = parseCitation(input);
  if (!parsed || parsed.kind === "unknown" || parsed.lookupKey.length < 5) return { parsed, matches: [] };
  const matches = await sql<PublicCitationMatch[]>`
    SELECT c.public_id AS "casePublicId", c.caption, court.name AS "courtName",
      c.docket_number AS "docketNumber", c.official_citation AS "officialCitation", c.decided_on::text AS "decidedOn"
    FROM legal_case c JOIN court ON court.id = c.court_id
    WHERE c.publication = 'published' AND c.official_citation IS NOT NULL
      AND regexp_replace(lower(c.official_citation), '[^a-z0-9]', '', 'g') = ${parsed.lookupKey}
      AND COALESCE((SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'legal_case' AND decision.object_id = c.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
    ORDER BY c.decided_on DESC NULLS LAST, c.id LIMIT 20
  `;
  return { parsed, matches };
}
