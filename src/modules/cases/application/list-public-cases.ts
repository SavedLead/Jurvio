import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

interface PublicCaseRow {
  publicId: string;
  caption: string;
  docketNumber: string;
  filedOn: string | null;
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
}

export async function listPublicCases(sql: Sql, options: ListPublicCasesOptions) {
  const page = Math.max(1, options.page);
  const pageSize = Math.min(100, Math.max(1, options.pageSize));
  const offset = (page - 1) * pageSize;
  const courtFilter = options.court?.trim() || null;

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

  const [totals, cases, courts] = await Promise.all([
    sql<Array<{ total: number }>>`
      SELECT count(*)::int AS total
      FROM legal_case
      JOIN court ON court.id = legal_case.court_id
      WHERE ${publicationGate}
        AND (${courtFilter}::text IS NULL OR court.public_id = ${courtFilter})
    `,
    sql<PublicCaseRow[]>`
      SELECT legal_case.public_id AS "publicId",
        legal_case.caption,
        legal_case.docket_number AS "docketNumber",
        legal_case.filed_on::text AS "filedOn",
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
        AND (${courtFilter}::text IS NULL OR court.public_id = ${courtFilter})
      ORDER BY legal_case.filed_on DESC NULLS LAST, legal_case.caption, legal_case.id
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
  };
}
