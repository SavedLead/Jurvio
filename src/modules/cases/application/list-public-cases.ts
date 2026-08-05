import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

interface PublicCaseRow {
  publicId: string;
  caption: string;
  docketNumber: string;
  filedOn: string | null;
  decidedOn: string | null;
  supremeCourtTerm: number | null;
  officialCitation: string | null;
  courtName: string;
  hasPublicDocument: boolean;
}

interface CourtFacet {
  value: string;
  label: string;
  count: number;
}

interface ListPublicCasesOptions {
  page: number;
  pageSize: number;
  court?: string;
  query?: string;
}

export async function listPublicCases(sql: Sql, options: ListPublicCasesOptions) {
  const page = Math.max(1, options.page);
  const pageSize = Math.min(100, Math.max(1, options.pageSize));
  const offset = (page - 1) * pageSize;
  const courtFilter = options.court?.trim() || null;
  const query = options.query?.trim().replace(/\s+/g, " ") || null;

  const publicationGate = sql`
    legal_case.publication = 'published'
    AND COALESCE((
      SELECT decision.displayable
      FROM publication_decision decision
      WHERE decision.object_type = 'legal_case'
        AND decision.object_id = legal_case.id
      ORDER BY decision.decided_at DESC, decision.id DESC
      LIMIT 1
    ), false)
  `;

  const searchGate = sql`
    (
      ${query}::text IS NULL
      OR legal_case.caption ILIKE '%' || ${query} || '%'
      OR legal_case.docket_number ILIKE '%' || ${query} || '%'
      OR EXISTS (
        SELECT 1
        FROM party_appearance
        JOIN entity ON entity.id = party_appearance.entity_id
        WHERE party_appearance.case_id = legal_case.id
          AND (
            party_appearance.party_name_as_filed ILIKE '%' || ${query} || '%'
            OR entity.display_name ILIKE '%' || ${query} || '%'
          )
      )
    )
  `;

  const [totals, cases, courts] = await Promise.all([
    sql<Array<{ total: number }>>`
      SELECT count(*)::int AS total
      FROM legal_case
      JOIN court ON court.id = legal_case.court_id
      WHERE ${publicationGate}
        AND ${searchGate}
        AND (${courtFilter}::text IS NULL OR court.public_id = ${courtFilter})
    `,
    sql<PublicCaseRow[]>`
      SELECT legal_case.public_id AS "publicId",
        legal_case.caption,
        legal_case.docket_number AS "docketNumber",
        legal_case.filed_on::text AS "filedOn",
        legal_case.decided_on::text AS "decidedOn",
        legal_case.supreme_court_term AS "supremeCourtTerm",
        legal_case.official_citation AS "officialCitation",
        court.name AS "courtName",
        EXISTS (
          SELECT 1
          FROM document
          WHERE document.case_id = legal_case.id
            AND document.publication = 'published'
            AND COALESCE((
              SELECT decision.displayable
              FROM publication_decision decision
              WHERE decision.object_type = 'document'
                AND decision.object_id = document.id
              ORDER BY decision.decided_at DESC, decision.id DESC
              LIMIT 1
            ), false)
        ) AS "hasPublicDocument"
      FROM legal_case
      JOIN court ON court.id = legal_case.court_id
      WHERE ${publicationGate}
        AND ${searchGate}
        AND (${courtFilter}::text IS NULL OR court.public_id = ${courtFilter})
      ORDER BY
        CASE WHEN ${query}::text IS NOT NULL AND legal_case.docket_number ILIKE ${query} THEN 0 ELSE 1 END,
        COALESCE(legal_case.decided_on, legal_case.filed_on) DESC NULLS LAST,
        legal_case.caption, legal_case.id
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    sql<CourtFacet[]>`
      SELECT court.public_id AS value, court.name AS label, count(*)::int AS count
      FROM legal_case
      JOIN court ON court.id = legal_case.court_id
      WHERE ${publicationGate}
      GROUP BY court.id, court.public_id, court.name
      ORDER BY count DESC, court.name
    `,
  ]);

  return {
    cases,
    courts,
    total: totals[0]?.total ?? 0,
    page,
    pageSize,
    court: courtFilter,
    query,
  };
}
