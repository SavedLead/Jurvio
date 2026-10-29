import type postgres from "postgres";
import { siteOrigin } from "@/lib/config/site-url";
import { xmlEscape } from "@/modules/discovery/http/xml";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import {
  SITEMAP_CASE_PAGE_SIZE,
  SITEMAP_PAGE_SIZE,
  type DirectorySitemapKind,
  type SitemapRecord,
} from "@/modules/discovery/application/sitemaps";

type Sql = ReturnType<typeof postgres>;

const DIRECTORY_KINDS: DirectorySitemapKind[] = [
  "parties",
  "law-firms",
  "courts",
  "judges",
  "government-litigation",
];

export function fallbackSitemapIndex(origin: string): string {
  return sitemapIndexXml(origin, []);
}

export function emptySitemapUrlset(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
}

export function sitemapIndexXml(origin: string, pages: Array<{ kind: string; count: number }>): string {
  const locations = [
    `${origin}/sitemaps/static.xml`,
    ...pages.flatMap(({ kind, count }) =>
      Array.from({ length: count }, (_, index) => `${origin}${sitemapKindPath(kind)}/${index + 1}`),
    ),
  ];
  const body = locations.map((location) => `<sitemap><loc>${xmlEscape(location)}</loc></sitemap>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`;
}

export function sitemapUrlsetXml(origin: string, records: SitemapRecord[]): string {
  const urls = records.map((record) =>
    `<url><loc>${xmlEscape(origin + record.path)}</loc><lastmod>${xmlEscape(record.updatedAt)}</lastmod></url>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

/** Stored XML when it is a document; otherwise the caller-supplied fallback. */
export function sitemapBodyOrFallback(stored: string | null | undefined, fallback: string): string {
  if (stored && stored.startsWith("<?xml")) return stored;
  return fallback;
}

export function sitemapKindPath(kind: string): string {
  if (kind === "cases" || kind === "opinions") return `/sitemaps/${kind}`;
  return `/sitemaps/directory/${kind}`;
}

export async function readSitemapDocument(sql: Sql, kind: string, pageNumber: number): Promise<string | null> {
  const [row] = await sql<{ body: string }[]>`
    SELECT body FROM sitemap_document
    WHERE kind = ${kind} AND page_number = ${pageNumber}
  `;
  return row?.body ?? null;
}

async function upsertPage(sql: Sql, kind: string, pageNumber: number, body: string): Promise<void> {
  await sql`
    INSERT INTO sitemap_document (kind, page_number, body, refreshed_at)
    VALUES (${kind}, ${pageNumber}, ${body}, now())
    ON CONFLICT (kind, page_number) DO UPDATE
      SET body = EXCLUDED.body, refreshed_at = EXCLUDED.refreshed_at
  `;
}

async function deleteExtraPages(sql: Sql, kind: string, pageCount: number): Promise<void> {
  await sql`DELETE FROM sitemap_document WHERE kind = ${kind} AND page_number > ${pageCount}`;
}

async function caseIds(sql: Sql, after: string | null): Promise<string[]> {
  const rows = await sql<{ public_id: string }[]>`
    SELECT c.public_id
    FROM legal_case c
    JOIN publication_current current_row
      ON current_row.object_type = 'legal_case' AND current_row.object_id = c.id
    JOIN publication_decision decision ON decision.id = current_row.decision_id AND decision.indexable
    WHERE c.publication = 'published'
      AND (${after}::text IS NULL OR c.public_id > ${after})
    ORDER BY c.public_id
    LIMIT ${SITEMAP_CASE_PAGE_SIZE}
  `;
  return rows.map((row) => row.public_id);
}

async function opinionIds(sql: Sql, after: string | null): Promise<string[]> {
  const rows = await sql<{ public_id: string }[]>`
    SELECT document.public_id
    FROM document
    JOIN legal_case ON legal_case.id = document.case_id
    JOIN judicial_opinion ON judicial_opinion.document_id = document.id
    JOIN publication_current case_row
      ON case_row.object_type = 'legal_case' AND case_row.object_id = legal_case.id
    JOIN publication_decision case_decision ON case_decision.id = case_row.decision_id AND case_decision.indexable
    JOIN publication_current doc_row
      ON doc_row.object_type = 'document' AND doc_row.object_id = document.id
    JOIN publication_decision doc_decision ON doc_decision.id = doc_row.decision_id AND doc_decision.indexable
    WHERE document.publication = 'published'
      AND (${after}::text IS NULL OR document.public_id > ${after})
    ORDER BY document.public_id
    LIMIT ${SITEMAP_PAGE_SIZE}
  `;
  return rows.map((row) => row.public_id);
}

async function directoryIds(sql: Sql, kind: DirectorySitemapKind, after: string | null): Promise<string[]> {
  if (kind === "parties" || kind === "law-firms") {
    const entityType = kind === "parties"
      ? sql`entity.entity_type IN ('unknown', 'person', 'organization', 'agency')`
      : sql`entity.entity_type = 'law_firm'`;
    const rows = await sql<{ public_id: string }[]>`
      SELECT entity.public_id
      FROM entity
      WHERE ${entityType} AND entity.verification = 'verified'
        AND ${sql.unsafe(latestPublicationColumnSql("indexable", "entity", "entity.id"))}
        AND (${after}::text IS NULL OR entity.public_id > ${after})
        AND EXISTS (
          SELECT 1 FROM party_appearance appearance
          JOIN legal_case ON legal_case.id = appearance.case_id
          JOIN publication_current case_row
            ON case_row.object_type = 'legal_case' AND case_row.object_id = legal_case.id
          JOIN publication_decision case_decision ON case_decision.id = case_row.decision_id AND case_decision.indexable
          WHERE appearance.entity_id = entity.id AND legal_case.publication = 'published'
        )
      ORDER BY entity.public_id
      LIMIT ${SITEMAP_PAGE_SIZE}
    `;
    return rows.map((row) => row.public_id);
  }
  if (kind === "courts") {
    const rows = await sql<{ public_id: string }[]>`
      SELECT court.public_id
      FROM court
      WHERE court.verification = 'verified'
        AND ${sql.unsafe(latestPublicationColumnSql("indexable", "court", "court.id"))}
        AND (${after}::text IS NULL OR court.public_id > ${after})
        AND EXISTS (
          SELECT 1 FROM legal_case
          JOIN publication_current case_row
            ON case_row.object_type = 'legal_case' AND case_row.object_id = legal_case.id
          JOIN publication_decision case_decision ON case_decision.id = case_row.decision_id AND case_decision.indexable
          WHERE legal_case.court_id = court.id AND legal_case.publication = 'published'
        )
      ORDER BY court.public_id
      LIMIT ${SITEMAP_PAGE_SIZE}
    `;
    return rows.map((row) => row.public_id);
  }
  if (kind === "judges") {
    const rows = await sql<{ public_id: string }[]>`
      SELECT judge.public_id
      FROM judge
      WHERE judge.verification = 'verified'
        AND ${sql.unsafe(latestPublicationColumnSql("displayable_and_indexable", "judge", "judge.id"))}
        AND (${after}::text IS NULL OR judge.public_id > ${after})
      ORDER BY judge.public_id
      LIMIT ${SITEMAP_PAGE_SIZE}
    `;
    return rows.map((row) => row.public_id);
  }
  const rows = await sql<{ public_id: string }[]>`
    SELECT lead.public_id
    FROM government_litigation_lead lead
    WHERE lead.review_status = 'published' AND lead.reviewed_at IS NOT NULL AND lead.published_at IS NOT NULL
      AND (${after}::text IS NULL OR lead.public_id > ${after})
    ORDER BY lead.public_id
    LIMIT ${SITEMAP_PAGE_SIZE}
  `;
  return rows.map((row) => row.public_id);
}

async function publishSitemapIndex(sql: Sql): Promise<void> {
  const stored = await sql<{ kind: string; count: number }[]>`
    SELECT kind, count(*)::int AS count
    FROM sitemap_document
    WHERE kind <> 'index' AND page_number > 0
    GROUP BY kind
    ORDER BY kind
  `;
  await upsertPage(sql, "index", 0, sitemapIndexXml(siteOrigin(), stored));
}

async function caseRecords(sql: Sql, ids: string[]): Promise<SitemapRecord[]> {
  const rows = await sql<{ public_id: string; updated_at: string; has_docket: boolean; has_documents: boolean; has_parties: boolean }[]>`
    SELECT c.public_id, c.updated_at::text AS updated_at,
      EXISTS (SELECT 1 FROM docket_entry entry WHERE entry.case_id = c.id) AS has_docket,
      EXISTS (SELECT 1 FROM document d WHERE d.case_id = c.id AND d.publication = 'published') AS has_documents,
      EXISTS (SELECT 1 FROM party_appearance appearance WHERE appearance.case_id = c.id) AS has_parties
    FROM legal_case c
    WHERE c.public_id = ANY(${ids}::text[])
    ORDER BY c.public_id
  `;
  const records: SitemapRecord[] = [];
  for (const row of rows) {
    records.push({ path: `/case/${row.public_id}`, updatedAt: row.updated_at });
    if (row.has_docket) {
      records.push({ path: `/case/${row.public_id}/docket`, updatedAt: row.updated_at });
      records.push({ path: `/case/${row.public_id}/timeline`, updatedAt: row.updated_at });
    }
    if (row.has_documents) records.push({ path: `/case/${row.public_id}/documents`, updatedAt: row.updated_at });
    if (row.has_parties) records.push({ path: `/case/${row.public_id}/parties`, updatedAt: row.updated_at });
  }
  return records;
}

async function opinionRecords(sql: Sql, ids: string[]): Promise<SitemapRecord[]> {
  return sql<SitemapRecord[]>`
    SELECT '/case/' || legal_case.public_id || '/documents/' || document.public_id AS path,
      GREATEST(legal_case.updated_at, document.updated_at)::text AS "updatedAt"
    FROM document
    JOIN legal_case ON legal_case.id = document.case_id
    WHERE document.public_id = ANY(${ids}::text[])
    ORDER BY document.public_id
  `;
}

async function directoryRecords(sql: Sql, kind: DirectorySitemapKind, ids: string[]): Promise<SitemapRecord[]> {
  if (kind === "parties" || kind === "law-firms") {
    const prefix = kind === "parties" ? "/parties/" : "/law-firms/";
    return sql<SitemapRecord[]>`
      SELECT ${prefix} || entity.public_id AS path, entity.updated_at::text AS "updatedAt"
      FROM entity
      WHERE entity.public_id = ANY(${ids}::text[])
      ORDER BY entity.public_id
    `;
  }
  if (kind === "courts") {
    return sql<SitemapRecord[]>`
      SELECT '/courts/' || court.public_id AS path, court.updated_at::text AS "updatedAt"
      FROM court WHERE court.public_id = ANY(${ids}::text[])
      ORDER BY court.public_id
    `;
  }
  if (kind === "judges") {
    return sql<SitemapRecord[]>`
      SELECT '/judges/' || judge.public_id AS path, judge.updated_at::text AS "updatedAt"
      FROM judge WHERE judge.public_id = ANY(${ids}::text[])
      ORDER BY judge.public_id
    `;
  }
  return sql<SitemapRecord[]>`
    SELECT '/government-litigation/' || lead.public_id AS path,
      COALESCE(lead.published_at, lead.reviewed_at)::text AS "updatedAt"
    FROM government_litigation_lead lead
    WHERE lead.public_id = ANY(${ids}::text[])
    ORDER BY lead.public_id
  `;
}

async function writeKind(
  sql: Sql,
  kind: string,
  pageSize: number,
  nextIds: (after: string | null) => Promise<string[]>,
  recordsForIds: (ids: string[]) => Promise<SitemapRecord[]>,
): Promise<number> {
  const origin = siteOrigin();
  let after: string | null = null;
  let page = 0;
  for (;;) {
    const ids = await nextIds(after);
    if (!ids.length) break;
    page += 1;
    const records = await recordsForIds(ids);
    await upsertPage(sql, kind, page, sitemapUrlsetXml(origin, records));
    // Publish the index after every page. The previous job wrote it only after
    // every kind finished, so a multi-hour case walk left /sitemap.xml on the
    // static.xml fallback.
    await publishSitemapIndex(sql);
    console.log(JSON.stringify({ sitemap: kind, page, ids: ids.length, urls: records.length }));
    if (ids.length < pageSize) break;
    after = ids[ids.length - 1] ?? null;
  }
  await deleteExtraPages(sql, kind, page);
  await publishSitemapIndex(sql);
  return page;
}

/**
 * Rebuild stored sitemap pages with keyset reads (`public_id > cursor ORDER BY public_id LIMIT n`).
 * No window function and no full-table count. Each kind is independent: a failure
 * leaves that kind's previous pages in place.
 */
export async function refreshSitemapDocuments(sql: Sql): Promise<Record<string, number | string>> {
  const counts: Record<string, number | string> = {};
  const steps: Array<[string, () => Promise<number>]> = [
    ["cases", () => writeKind(sql, "cases", SITEMAP_CASE_PAGE_SIZE, (after) => caseIds(sql, after), (ids) => caseRecords(sql, ids))],
    ["opinions", () => writeKind(sql, "opinions", SITEMAP_PAGE_SIZE, (after) => opinionIds(sql, after), (ids) => opinionRecords(sql, ids))],
    ...DIRECTORY_KINDS.map((kind) => [kind, () => writeKind(
      sql,
      kind,
      SITEMAP_PAGE_SIZE,
      (after) => directoryIds(sql, kind, after),
      (ids) => directoryRecords(sql, kind, ids),
    )] as [string, () => Promise<number>]),
  ];
  for (const [kind, run] of steps) {
    try {
      counts[kind] = await run();
    } catch (error) {
      counts[kind] = error instanceof Error ? error.message : "failed";
    }
  }
  await publishSitemapIndex(sql);
  const [indexRow] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM sitemap_document WHERE kind <> 'index' AND page_number > 0
  `;
  counts.indexPages = indexRow?.n ?? 0;
  return counts;
}
