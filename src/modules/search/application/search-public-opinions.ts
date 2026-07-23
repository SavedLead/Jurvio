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
  opinionType: string;
  citationCount: number;
  excerpt: string;
}

export type OpinionSearchSort = "relevance" | "newest" | "oldest" | "most-cited";
export interface OpinionSearchFilters {
  query: string;
  court?: string;
  dateFrom?: string;
  dateTo?: string;
  precedentialStatus?: string;
  opinionType?: string;
  sort: OpinionSearchSort;
  page: number;
}

export interface OpinionSearchFacets {
  courts: Array<{ value: string; label: string; count: number }>;
  precedentialStatuses: Array<{ value: string; label: string; count: number }>;
  opinionTypes: Array<{ value: string; label: string; count: number }>;
}

export interface OpinionSearchResponse {
  results: OpinionSearchResult[];
  total: number;
  page: number;
  pageSize: number;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
export function normalizeOpinionSearchFilters(input: Record<string, string | undefined>): OpinionSearchFilters {
  const sort: OpinionSearchSort = ["relevance", "newest", "oldest", "most-cited"].includes(input.sort ?? "")
    ? input.sort as OpinionSearchSort : "relevance";
  const pageNumber = Number.parseInt(input.page ?? "1", 10);
  return {
    query: (input.q ?? "").trim().slice(0, 500),
    court: input.court?.trim().slice(0, 80) || undefined,
    dateFrom: input.from && isoDate.test(input.from) ? input.from : undefined,
    dateTo: input.to && isoDate.test(input.to) ? input.to : undefined,
    precedentialStatus: input.status?.trim().slice(0, 100) || undefined,
    opinionType: input.type?.trim().slice(0, 100) || undefined,
    sort,
    page: Number.isFinite(pageNumber) ? Math.min(Math.max(pageNumber, 1), 50) : 1,
  };
}

const publicationPredicate = (sql: Sql) => sql`
  legal_case.publication = 'published'
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
`;

export async function searchPublicOpinions(sql: Sql, filters: OpinionSearchFilters): Promise<OpinionSearchResponse> {
  const pageSize = 20;
  const offset = (filters.page - 1) * pageSize;
  const hasQuery = filters.query.length >= 2;
  const hasSearch = hasQuery || Boolean(filters.court || filters.dateFrom || filters.dateTo || filters.precedentialStatus || filters.opinionType);
  if (!hasSearch) return { results: [], total: 0, page: filters.page, pageSize };

  const queryCondition = hasQuery
    ? sql`projection.search_vector @@ websearch_to_tsquery('english', ${filters.query})`
    : sql`TRUE`;
  const filtersCondition = sql`
    (${filters.court ?? null}::text IS NULL OR court.public_id = ${filters.court ?? null})
    AND (${filters.dateFrom ?? null}::date IS NULL OR projection.date_filed >= ${filters.dateFrom ?? null}::date)
    AND (${filters.dateTo ?? null}::date IS NULL OR projection.date_filed <= ${filters.dateTo ?? null}::date)
    AND (${filters.precedentialStatus ?? null}::text IS NULL OR projection.precedential_status = ${filters.precedentialStatus ?? null})
    AND (${filters.opinionType ?? null}::text IS NULL OR projection.opinion_type = ${filters.opinionType ?? null})
  `;
  const ordering = filters.sort === "newest" ? sql`projection.date_filed DESC NULLS LAST, projection.citation_count DESC`
    : filters.sort === "oldest" ? sql`projection.date_filed ASC NULLS LAST, projection.citation_count DESC`
      : filters.sort === "most-cited" ? sql`projection.citation_count DESC, projection.date_filed DESC NULLS LAST`
        : hasQuery ? sql`ts_rank_cd(projection.search_vector, websearch_to_tsquery('english', ${filters.query})) DESC, projection.citation_count DESC, projection.date_filed DESC NULLS LAST`
          : sql`projection.date_filed DESC NULLS LAST, projection.citation_count DESC`;

  const [rows, totals] = await Promise.all([
    sql<OpinionSearchResult[]>`
      SELECT legal_case.public_id AS "casePublicId", document.public_id AS "documentPublicId",
        projection.case_caption AS "caseCaption", projection.court_name AS "courtName", projection.title,
        projection.date_filed::text AS "filedOn", projection.precedential_status AS "precedentialStatus",
        projection.opinion_type AS "opinionType", projection.citation_count AS "citationCount",
        CASE WHEN ${hasQuery} THEN ts_headline('english', projection.body,
          websearch_to_tsquery('english', ${filters.query}), 'MaxWords=42, MinWords=18, ShortWord=3, HighlightAll=false')
          ELSE left(projection.body, 300) END AS excerpt
      FROM opinion_search_projection projection
      JOIN legal_case ON legal_case.id = projection.case_id
      JOIN document ON document.id = projection.document_id
      JOIN court ON court.id = projection.court_id
      WHERE ${queryCondition} AND ${filtersCondition} AND ${publicationPredicate(sql)}
      ORDER BY ${ordering} LIMIT ${pageSize} OFFSET ${offset}
    `,
    sql<Array<{ value: number }>>`
      SELECT count(*)::int AS value
      FROM opinion_search_projection projection
      JOIN legal_case ON legal_case.id = projection.case_id
      JOIN document ON document.id = projection.document_id
      JOIN court ON court.id = projection.court_id
      WHERE ${queryCondition} AND ${filtersCondition} AND ${publicationPredicate(sql)}
    `,
  ]);
  return { results: rows, total: totals[0]?.value ?? 0, page: filters.page, pageSize };
}

export async function listOpinionSearchFacets(sql: Sql): Promise<OpinionSearchFacets> {
  const [courts, statuses, types] = await Promise.all([
    sql<Array<{ value: string; label: string; count: number }>>`
      SELECT court.public_id AS value, court.name AS label, count(*)::int AS count
      FROM opinion_search_projection projection JOIN court ON court.id = projection.court_id
      JOIN legal_case ON legal_case.id = projection.case_id JOIN document ON document.id = projection.document_id
      WHERE ${publicationPredicate(sql)} GROUP BY court.id ORDER BY count DESC, court.name LIMIT 100`,
    sql<Array<{ value: string; label: string; count: number }>>`
      SELECT projection.precedential_status AS value, projection.precedential_status AS label, count(*)::int AS count
      FROM opinion_search_projection projection JOIN legal_case ON legal_case.id = projection.case_id
      JOIN document ON document.id = projection.document_id
      WHERE projection.precedential_status IS NOT NULL AND ${publicationPredicate(sql)}
      GROUP BY projection.precedential_status ORDER BY count DESC, value`,
    sql<Array<{ value: string; label: string; count: number }>>`
      SELECT projection.opinion_type AS value, projection.opinion_type AS label, count(*)::int AS count
      FROM opinion_search_projection projection JOIN legal_case ON legal_case.id = projection.case_id
      JOIN document ON document.id = projection.document_id
      WHERE ${publicationPredicate(sql)} GROUP BY projection.opinion_type ORDER BY count DESC, value`,
  ]);
  return { courts, precedentialStatuses: statuses, opinionTypes: types };
}
