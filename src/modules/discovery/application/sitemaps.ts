import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;
export const SITEMAP_PAGE_SIZE = 10_000;

export interface SitemapRecord {
  path: string;
  updatedAt: string;
}

export async function countPublicSitemapRecords(sql: Sql) {
  const [counts] = await sql<{ cases: number; opinions: number }[]>`
    SELECT
      (SELECT count(*)::int FROM legal_case legal_case
        WHERE legal_case.publication = 'published'
          AND COALESCE((
            SELECT decision.indexable FROM publication_decision decision
            WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ), false)
      ) AS cases,
      (SELECT count(*)::int FROM document
        JOIN legal_case ON legal_case.id = document.case_id
        JOIN judicial_opinion ON judicial_opinion.document_id = document.id
        WHERE document.publication = 'published' AND legal_case.publication = 'published'
          AND COALESCE((
            SELECT decision.indexable FROM publication_decision decision
            WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ), false)
          AND COALESCE((
            SELECT decision.indexable FROM publication_decision decision
            WHERE decision.object_type = 'document' AND decision.object_id = document.id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ), false)
      ) AS opinions
  `;
  return counts ?? { cases: 0, opinions: 0 };
}

export async function listCaseSitemapRecords(sql: Sql, page: number) {
  return sql<SitemapRecord[]>`
    SELECT '/case/' || legal_case.public_id AS path, legal_case.updated_at::text AS "updatedAt"
    FROM legal_case
    WHERE legal_case.publication = 'published'
      AND COALESCE((
        SELECT decision.indexable FROM publication_decision decision
        WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
    ORDER BY legal_case.public_id
    LIMIT ${SITEMAP_PAGE_SIZE} OFFSET ${(page - 1) * SITEMAP_PAGE_SIZE}
  `;
}

export async function listOpinionSitemapRecords(sql: Sql, page: number) {
  return sql<SitemapRecord[]>`
    SELECT '/case/' || legal_case.public_id || '/documents/' || document.public_id AS path,
      GREATEST(legal_case.updated_at, document.updated_at)::text AS "updatedAt"
    FROM document
    JOIN legal_case ON legal_case.id = document.case_id
    JOIN judicial_opinion ON judicial_opinion.document_id = document.id
    WHERE document.publication = 'published' AND legal_case.publication = 'published'
      AND COALESCE((
        SELECT decision.indexable FROM publication_decision decision
        WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
      AND COALESCE((
        SELECT decision.indexable FROM publication_decision decision
        WHERE decision.object_type = 'document' AND decision.object_id = document.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
    ORDER BY document.public_id
    LIMIT ${SITEMAP_PAGE_SIZE} OFFSET ${(page - 1) * SITEMAP_PAGE_SIZE}
  `;
}
