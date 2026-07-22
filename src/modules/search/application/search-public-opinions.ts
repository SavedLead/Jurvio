import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface OpinionSearchResult {
  casePublicId: string;
  documentPublicId: string;
  caseCaption: string;
  courtName: string;
  title: string;
  filedOn: string | null;
  precedentialStatus: string | null;
  citationCount: number;
  excerpt: string;
}

export async function searchPublicOpinions(
  sql: Sql,
  rawQuery: string,
  limit = 20,
): Promise<OpinionSearchResult[]> {
  const query = rawQuery.trim().slice(0, 500);
  if (query.length < 2) return [];

  return sql<OpinionSearchResult[]>`
    WITH query AS (SELECT websearch_to_tsquery('english', ${query}) AS value)
    SELECT
      legal_case.public_id AS "casePublicId",
      document.public_id AS "documentPublicId",
      projection.case_caption AS "caseCaption",
      projection.court_name AS "courtName",
      projection.title,
      projection.date_filed::text AS "filedOn",
      projection.precedential_status AS "precedentialStatus",
      projection.citation_count AS "citationCount",
      ts_headline(
        'english', projection.body, query.value,
        'MaxWords=42, MinWords=18, ShortWord=3, HighlightAll=false'
      ) AS excerpt
    FROM opinion_search_projection projection
    CROSS JOIN query
    JOIN legal_case ON legal_case.id = projection.case_id
    JOIN document ON document.id = projection.document_id
    WHERE projection.search_vector @@ query.value
      AND legal_case.publication = 'published'
      AND document.publication = 'published'
      AND COALESCE((
        SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
      AND COALESCE((
        SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'document' AND decision.object_id = document.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
    ORDER BY
      ts_rank_cd(projection.search_vector, query.value) DESC,
      projection.citation_count DESC,
      projection.date_filed DESC NULLS LAST
    LIMIT ${Math.min(Math.max(limit, 1), 50)}
  `;
}
