import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;
export const SITEMAP_PAGE_SIZE = 10_000;

export interface SitemapRecord {
  path: string;
  updatedAt: string;
}

export type DirectorySitemapKind = "parties" | "law-firms" | "courts" | "judges" | "government-litigation";

const indexableCase = `
  legal_case.publication = 'published'
  AND COALESCE((
    SELECT decision.indexable FROM publication_decision decision
    WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
  ), false)
`;

export async function countPublicSitemapRecords(sql: Sql) {
  const [counts] = await sql<{
    cases: number;
    opinions: number;
    parties: number;
    lawFirms: number;
    courts: number;
    judges: number;
    governmentLitigation: number;
  }[]>`
    SELECT
      (SELECT count(*)::int * 5 FROM legal_case
        WHERE ${sql.unsafe(indexableCase)}
      ) AS cases,
      (SELECT count(*)::int FROM document
        JOIN legal_case ON legal_case.id = document.case_id
        JOIN judicial_opinion ON judicial_opinion.document_id = document.id
        WHERE document.publication = 'published' AND ${sql.unsafe(indexableCase)}
          AND COALESCE((
            SELECT decision.indexable FROM publication_decision decision
            WHERE decision.object_type = 'document' AND decision.object_id = document.id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ), false)
      ) AS opinions,
      (SELECT count(*)::int FROM entity
        WHERE entity.entity_type IN ('unknown', 'person', 'organization', 'agency')
          AND entity.verification = 'verified'
          AND COALESCE((
            SELECT decision.indexable FROM publication_decision decision
            WHERE decision.object_type = 'entity' AND decision.object_id = entity.id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ), false)
          AND EXISTS (
            SELECT 1 FROM party_appearance appearance
            JOIN legal_case ON legal_case.id = appearance.case_id
            WHERE appearance.entity_id = entity.id AND ${sql.unsafe(indexableCase)}
          )
      ) AS parties,
      (SELECT count(*)::int FROM entity
        WHERE entity.entity_type = 'law_firm' AND entity.verification = 'verified'
          AND COALESCE((
            SELECT decision.indexable FROM publication_decision decision
            WHERE decision.object_type = 'entity' AND decision.object_id = entity.id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ), false)
          AND EXISTS (
            SELECT 1 FROM party_appearance appearance
            JOIN legal_case ON legal_case.id = appearance.case_id
            WHERE appearance.entity_id = entity.id AND ${sql.unsafe(indexableCase)}
          )
      ) AS "lawFirms",
      (SELECT count(*)::int FROM court
        WHERE court.verification = 'verified'
          AND COALESCE((
            SELECT decision.indexable FROM publication_decision decision
            WHERE decision.object_type = 'court' AND decision.object_id = court.id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ), false)
          AND EXISTS (
            SELECT 1 FROM legal_case
            WHERE legal_case.court_id = court.id AND ${sql.unsafe(indexableCase)}
          )
      ) AS courts,
      (SELECT count(*)::int FROM judge
        WHERE judge.verification = 'verified'
          AND COALESCE((
            SELECT decision.displayable AND decision.indexable FROM publication_decision decision
            WHERE decision.object_type = 'judge' AND decision.object_id = judge.id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ), false)
      ) AS judges,
      (SELECT count(*)::int FROM government_litigation_lead lead
        WHERE lead.review_status = 'published' AND lead.reviewed_at IS NOT NULL
          AND lead.published_at IS NOT NULL
      ) AS "governmentLitigation"
  `;
  return counts ?? {
    cases: 0,
    opinions: 0,
    parties: 0,
    lawFirms: 0,
    courts: 0,
    judges: 0,
    governmentLitigation: 0,
  };
}

export async function listCaseSitemapRecords(sql: Sql, page: number) {
  return sql<SitemapRecord[]>`
    SELECT '/case/' || eligible.public_id || suffix.value AS path,
      eligible.updated_at::text AS "updatedAt"
    FROM (
      SELECT legal_case.public_id, legal_case.updated_at
      FROM legal_case
      WHERE ${sql.unsafe(indexableCase)}
    ) eligible
    CROSS JOIN (VALUES (''), ('/docket'), ('/documents'), ('/parties'), ('/timeline')) AS suffix(value)
    ORDER BY eligible.public_id, suffix.value
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
    WHERE document.publication = 'published' AND ${sql.unsafe(indexableCase)}
      AND COALESCE((
        SELECT decision.indexable FROM publication_decision decision
        WHERE decision.object_type = 'document' AND decision.object_id = document.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
    ORDER BY document.public_id
    LIMIT ${SITEMAP_PAGE_SIZE} OFFSET ${(page - 1) * SITEMAP_PAGE_SIZE}
  `;
}

export async function listDirectorySitemapRecords(
  sql: Sql,
  kind: DirectorySitemapKind,
  page: number,
): Promise<SitemapRecord[]> {
  const limit = SITEMAP_PAGE_SIZE;
  const offset = (page - 1) * SITEMAP_PAGE_SIZE;

  if (kind === "parties" || kind === "law-firms") {
    const entityType = kind === "parties"
      ? sql`entity.entity_type IN ('unknown', 'person', 'organization', 'agency')`
      : sql`entity.entity_type = 'law_firm'`;
    const prefix = kind === "parties" ? "/parties/" : "/law-firms/";
    return sql<SitemapRecord[]>`
      SELECT ${prefix} || entity.public_id AS path, entity.updated_at::text AS "updatedAt"
      FROM entity
      WHERE ${entityType} AND entity.verification = 'verified'
        AND COALESCE((
          SELECT decision.indexable FROM publication_decision decision
          WHERE decision.object_type = 'entity' AND decision.object_id = entity.id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        ), false)
        AND EXISTS (
          SELECT 1 FROM party_appearance appearance
          JOIN legal_case ON legal_case.id = appearance.case_id
          WHERE appearance.entity_id = entity.id AND ${sql.unsafe(indexableCase)}
        )
      ORDER BY entity.public_id LIMIT ${limit} OFFSET ${offset}
    `;
  }

  if (kind === "courts") {
    return sql<SitemapRecord[]>`
      SELECT '/courts/' || court.public_id AS path, court.updated_at::text AS "updatedAt"
      FROM court
      WHERE court.verification = 'verified'
        AND COALESCE((
          SELECT decision.indexable FROM publication_decision decision
          WHERE decision.object_type = 'court' AND decision.object_id = court.id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        ), false)
        AND EXISTS (
          SELECT 1 FROM legal_case
          WHERE legal_case.court_id = court.id AND ${sql.unsafe(indexableCase)}
        )
      ORDER BY court.public_id LIMIT ${limit} OFFSET ${offset}
    `;
  }

  if (kind === "judges") {
    return sql<SitemapRecord[]>`
      SELECT '/judges/' || judge.public_id AS path, judge.updated_at::text AS "updatedAt"
      FROM judge
      WHERE judge.verification = 'verified'
        AND COALESCE((
          SELECT decision.displayable AND decision.indexable FROM publication_decision decision
          WHERE decision.object_type = 'judge' AND decision.object_id = judge.id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        ), false)
      ORDER BY judge.public_id LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return sql<SitemapRecord[]>`
    SELECT '/government-litigation/' || lead.public_id AS path,
      COALESCE(lead.published_at, lead.reviewed_at)::text AS "updatedAt"
    FROM government_litigation_lead lead
    WHERE lead.review_status = 'published' AND lead.reviewed_at IS NOT NULL
      AND lead.published_at IS NOT NULL
    ORDER BY lead.public_id LIMIT ${limit} OFFSET ${offset}
  `;
}
