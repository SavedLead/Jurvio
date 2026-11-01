import type postgres from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";

type Sql = ReturnType<typeof postgres>;
/** One URL per row. Sitemap files stay under the 50,000 URL protocol limit. */
export const SITEMAP_PAGE_SIZE = 10_000;
/**
 * Case files expand each case into up to five URLs (case, docket, timeline,
 * documents, parties). 8,000 cases stays under 50,000 URLs.
 */
export const SITEMAP_CASE_PAGE_SIZE = 8_000;

export interface SitemapRecord {
  path: string;
  updatedAt: string;
}

export type DirectorySitemapKind = "parties" | "law-firms" | "courts" | "judges" | "government-litigation";

const indexableCase = `${latestPublicationColumnSql("indexable", "legal_case", "legal_case.id")} AND NOT ${searchExcludedCaseSql("legal_case")}`;
const indexableDocument = latestPublicationColumnSql("indexable", "document", "document.id");

export function sitemapPageBounds(starts: readonly string[], page: number): { start: string; end: string | null } | null {
  if (!Number.isInteger(page) || page < 1 || page > starts.length) return null;
  const start = starts[page - 1];
  if (!start) return null;
  return { start, end: starts[page] ?? null };
}

export async function listCaseSitemapRecords(sql: Sql, startId: string, endId: string | null) {
  return sql<SitemapRecord[]>`
    SELECT '/case/' || eligible.public_id || suffix.value AS path,
      eligible.updated_at::text AS "updatedAt"
    FROM (
      SELECT legal_case.id, legal_case.public_id, legal_case.updated_at
      FROM legal_case
      WHERE legal_case.publication = 'published'
        AND ${sql.unsafe(indexableCase)}
        AND legal_case.public_id >= ${startId}
        AND (${endId}::text IS NULL OR legal_case.public_id < ${endId})
    ) eligible
    CROSS JOIN LATERAL (
      SELECT value
      FROM (VALUES
        ('', true),
        ('/docket', EXISTS (SELECT 1 FROM docket_entry WHERE docket_entry.case_id = eligible.id)),
        ('/timeline', EXISTS (SELECT 1 FROM docket_entry WHERE docket_entry.case_id = eligible.id)),
        ('/documents', EXISTS (
          SELECT 1 FROM document
          WHERE document.case_id = eligible.id AND document.publication = 'published'
        )),
        ('/parties', EXISTS (SELECT 1 FROM party_appearance WHERE party_appearance.case_id = eligible.id))
      ) AS candidate(value, has_content)
      WHERE has_content
    ) suffix
    ORDER BY eligible.public_id, suffix.value
  `;
}

export async function listOpinionSitemapRecords(sql: Sql, startId: string, endId: string | null) {
  return sql<SitemapRecord[]>`
    SELECT '/case/' || legal_case.public_id || '/documents/' || document.public_id AS path,
      GREATEST(legal_case.updated_at, document.updated_at)::text AS "updatedAt"
    FROM document
    JOIN legal_case ON legal_case.id = document.case_id
    JOIN judicial_opinion ON judicial_opinion.document_id = document.id
    WHERE document.publication = 'published'
      AND ${sql.unsafe(indexableCase)}
      AND ${sql.unsafe(indexableDocument)}
      AND document.public_id >= ${startId}
      AND (${endId}::text IS NULL OR document.public_id < ${endId})
    ORDER BY document.public_id
  `;
}

export async function listDirectorySitemapRecords(
  sql: Sql,
  kind: DirectorySitemapKind,
  startId: string,
  endId: string | null,
): Promise<SitemapRecord[]> {
  if (kind === "parties" || kind === "law-firms") {
    const entityType = kind === "parties"
      ? sql`entity.entity_type IN ('unknown', 'person', 'organization', 'agency')`
      : sql`entity.entity_type = 'law_firm'`;
    const prefix = kind === "parties" ? "/parties/" : "/law-firms/";
    return sql<SitemapRecord[]>`
      SELECT ${prefix} || entity.public_id AS path, entity.updated_at::text AS "updatedAt"
      FROM entity
      WHERE ${entityType} AND entity.verification = 'verified'
        AND ${sql.unsafe(latestPublicationColumnSql("indexable", "entity", "entity.id"))}
        AND EXISTS (
          SELECT 1 FROM party_appearance appearance
          JOIN legal_case ON legal_case.id = appearance.case_id
          WHERE appearance.entity_id = entity.id AND legal_case.publication = 'published' AND ${sql.unsafe(indexableCase)}
        )
        AND entity.public_id >= ${startId}
        AND (${endId}::text IS NULL OR entity.public_id < ${endId})
      ORDER BY entity.public_id
    `;
  }

  if (kind === "courts") {
    return sql<SitemapRecord[]>`
      SELECT '/courts/' || court.public_id AS path, court.updated_at::text AS "updatedAt"
      FROM court
      WHERE court.verification = 'verified'
        AND ${sql.unsafe(latestPublicationColumnSql("indexable", "court", "court.id"))}
        AND EXISTS (
          SELECT 1 FROM legal_case
          WHERE legal_case.court_id = court.id AND legal_case.publication = 'published' AND ${sql.unsafe(indexableCase)}
        )
        AND court.public_id >= ${startId}
        AND (${endId}::text IS NULL OR court.public_id < ${endId})
      ORDER BY court.public_id
    `;
  }

  if (kind === "judges") {
    return sql<SitemapRecord[]>`
      SELECT '/judges/' || judge.public_id AS path, judge.updated_at::text AS "updatedAt"
      FROM judge
      WHERE judge.verification = 'verified'
        AND ${sql.unsafe(latestPublicationColumnSql("displayable_and_indexable", "judge", "judge.id"))}
        AND judge.public_id >= ${startId}
        AND (${endId}::text IS NULL OR judge.public_id < ${endId})
      ORDER BY judge.public_id
    `;
  }

  return sql<SitemapRecord[]>`
    SELECT '/government-litigation/' || lead.public_id AS path,
      COALESCE(lead.published_at, lead.reviewed_at)::text AS "updatedAt"
    FROM government_litigation_lead lead
    WHERE lead.review_status = 'published' AND lead.reviewed_at IS NOT NULL
      AND lead.published_at IS NOT NULL
      AND lead.public_id >= ${startId}
      AND (${endId}::text IS NULL OR lead.public_id < ${endId})
    ORDER BY lead.public_id
  `;
}
