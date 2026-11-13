import type postgres from "postgres";
import { ORDER_LINE_PATTERN } from "@/modules/cases/domain/docket-classification";
import { latestPublicationColumnSql, type PublicationFlag } from "@/modules/publication/application/current-visibility";

type Sql = ReturnType<typeof postgres>;

function visible(sql: Sql, column: PublicationFlag, objectType: "legal_case" | "document" | "entity" | "docket_entry", objectIdExpr: string) {
  return sql.unsafe(latestPublicationColumnSql(column, objectType, objectIdExpr));
}

export interface PublicDocketEntry {
  publicId: string;
  entryNumber: string | null;
  filedOn: string | null;
  description: string;
  importance: string;
}
export interface PublicParty {
  publicId: string;
  displayName: string;
  role: string;
  nameAsFiled: string;
}
export interface PublicDocument {
  publicId: string;
  title: string;
  documentType: string;
  filedOn: string | null;
  extractionConfidence: string | null;
  hasReadableContent: boolean;
  sourceDownloadUrl: string | null;
  opinionType: string | null;
  authorName: string | null;
  perCuriam: boolean;
  hasReportersNote: boolean;
}

/**
 * One page of a docket. The case-id index
 * (docket_entry_case_filed_idx) serves the newest-first order. Callers that
 * only need a preview pass a smaller limit.
 */
export const PUBLIC_DOCKET_PAGE_SIZE = 50;
export const PUBLIC_DOCKET_LIST_LIMIT = 2000;
/** Keeps a deep page from walking an unbounded offset. */
const MAX_DOCKET_OFFSET = 200_000;
/**
 * POSIX twin of isRestrictedDocketText. A line that says it is sealed stays off
 * the page even when no publication decision exists.
 */
const SEALED_DOCKET_TEXT = String.raw`\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\M`;
/** A withholding decision with one of these reasons is a seal, not a missing marker. */
const SEAL_DECISION_REASON = "(seal|restrict|sensitive|suppress|privacy|minor|juvenile)";

export function docketPageWindow(page: number, pageSize = PUBLIC_DOCKET_PAGE_SIZE): { page: number; limit: number; offset: number } {
  const limit = Math.min(PUBLIC_DOCKET_LIST_LIMIT, Math.max(1, Math.floor(pageSize) || PUBLIC_DOCKET_PAGE_SIZE));
  const requested = Number.isFinite(page) ? Math.floor(page) : 1;
  const offset = Math.min(MAX_DOCKET_OFFSET, Math.max(0, requested - 1) * limit);
  return { page: Math.floor(offset / limit) + 1, limit, offset };
}

/**
 * Stored lines on a published case are public. A line is hidden only when its
 * text is sealed or a publication decision withholds it for a seal reason.
 * Missing decisions are not a hide. This reads docket_entry; it does not write.
 */
function visibleEntry(sql: Sql) {
  return sql`
    entry.description !~* ${SEALED_DOCKET_TEXT}
    AND NOT EXISTS (
      SELECT 1 FROM publication_decision withheld
      WHERE withheld.object_type = 'docket_entry'
        AND withheld.object_id = entry.id
        AND NOT withheld.displayable
        AND withheld.reason_code ~* ${SEAL_DECISION_REASON}
    )
  `;
}

/** One lookup of the published case, then the docket index. The case check is not repeated per line. */
function publishedCase(sql: Sql, casePublicId: string) {
  return sql`
    SELECT legal_case.id
    FROM legal_case
    WHERE legal_case.public_id = ${casePublicId}
      AND legal_case.publication = 'published'
      AND ${visible(sql, "displayable", "legal_case", "legal_case.id")}
  `;
}

export async function listPublicDocketEntries(
  sql: Sql,
  casePublicId: string,
  limit = PUBLIC_DOCKET_LIST_LIMIT,
  offset = 0,
) {
  const boundedLimit = Math.min(PUBLIC_DOCKET_LIST_LIMIT, Math.max(1, Math.floor(limit) || 1));
  const boundedOffset = Math.min(MAX_DOCKET_OFFSET, Math.max(0, Math.floor(offset) || 0));
  return sql<PublicDocketEntry[]>`
    SELECT entry.public_id AS "publicId", entry.entry_number AS "entryNumber",
      entry.filed_on::text AS "filedOn", entry.description, entry.importance
    FROM docket_entry entry
    JOIN (${publishedCase(sql, casePublicId)}) subject ON subject.id = entry.case_id
    WHERE ${visibleEntry(sql)}
    ORDER BY entry.filed_on DESC NULLS LAST, entry.entry_number DESC NULLS LAST, entry.public_id DESC
    LIMIT ${boundedLimit}
    OFFSET ${boundedOffset}
  `;
}

export async function countPublicOrderEntries(sql: Sql, casePublicId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM docket_entry entry
    JOIN (${publishedCase(sql, casePublicId)}) subject ON subject.id = entry.case_id
    WHERE ${visibleEntry(sql)}
      AND entry.description ~* ${ORDER_LINE_PATTERN}
  `;
  return row?.n ?? 0;
}

export async function listPublicOrderEntries(sql: Sql, casePublicId: string, limit = PUBLIC_DOCKET_PAGE_SIZE) {
  const boundedLimit = Math.min(PUBLIC_DOCKET_LIST_LIMIT, Math.max(1, Math.floor(limit) || 1));
  return sql<PublicDocketEntry[]>`
    SELECT entry.public_id AS "publicId", entry.entry_number AS "entryNumber",
      entry.filed_on::text AS "filedOn", entry.description, entry.importance
    FROM docket_entry entry
    JOIN (${publishedCase(sql, casePublicId)}) subject ON subject.id = entry.case_id
    WHERE ${visibleEntry(sql)}
      AND entry.description ~* ${ORDER_LINE_PATTERN}
    ORDER BY entry.filed_on DESC NULLS LAST, entry.entry_number DESC NULLS LAST, entry.public_id DESC
    LIMIT ${boundedLimit}
  `;
}

/** A few stored lines that state a jury demand or a jurisdiction basis. */
export async function listStoredFactLines(sql: Sql, casePublicId: string): Promise<string[]> {
  const rows = await sql<{ description: string }[]>`
    SELECT entry.description
    FROM docket_entry entry
    JOIN (${publishedCase(sql, casePublicId)}) subject ON subject.id = entry.case_id
    WHERE ${visibleEntry(sql)}
      AND (entry.description ~* 'jury demand' OR entry.description ~* '\\mjurisdiction\\M')
    ORDER BY entry.filed_on DESC NULLS LAST
    LIMIT 30
  `.catch(() => []);
  return rows.map((row) => row.description);
}

export async function countPublicDocketEntries(sql: Sql, casePublicId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM docket_entry entry
    JOIN (${publishedCase(sql, casePublicId)}) subject ON subject.id = entry.case_id
    WHERE ${visibleEntry(sql)}
  `;
  return row?.n ?? 0;
}

export async function listPublicParties(sql: Sql, casePublicId: string) {
  return sql<PublicParty[]>`
    SELECT entity.public_id AS "publicId", entity.display_name AS "displayName",
      appearance.role, appearance.party_name_as_filed AS "nameAsFiled"
    FROM party_appearance appearance
    JOIN (${publishedCase(sql, casePublicId)}) subject ON subject.id = appearance.case_id
    JOIN entity ON entity.id = appearance.entity_id
    -- A party with no entity-level decision of its own is displayable, because
      -- the gate that matters has already been applied above: the case it appears
      -- in is published AND carries a displayable publication decision. Nothing
      -- writes an entity decision outside the manual publication-review workflow,
      -- so requiring one here (the previous default of false) hid EVERY party on
      -- EVERY case. The directory queries in modules/directory already default this
      -- to true; an explicit entity decision still suppresses a party on both.
    WHERE ${sql.unsafe(latestPublicationColumnSql("displayable", "entity", "entity.id", true))}
    ORDER BY appearance.role, entity.normalized_name
  `;
}

export async function listPublicDocuments(sql: Sql, casePublicId: string) {
  return sql<PublicDocument[]>`
    SELECT document.public_id AS "publicId", document.title,
      document.document_type AS "documentType", document.filed_on::text AS "filedOn",
      document.extraction_confidence::text AS "extractionConfidence",
      content.document_id IS NOT NULL AS "hasReadableContent",
      COALESCE(judicial.source_download_url, docket_document.source_url) AS "sourceDownloadUrl",
      judicial.opinion_type AS "opinionType",
      judicial.author_name AS "authorName",
      COALESCE(judicial.per_curiam, false) AS "perCuriam",
      COALESCE(content.content_text ILIKE '%REPORTER''S NOTE%' OR content.content_text ILIKE '%REPORTER’S NOTE%', false) AS "hasReportersNote"
    FROM document
    JOIN (${publishedCase(sql, casePublicId)}) subject ON subject.id = document.case_id
    LEFT JOIN document_content content ON content.document_id = document.id
    LEFT JOIN judicial_opinion judicial ON judicial.document_id = document.id
    LEFT JOIN scotus_docket_document docket_document ON docket_document.document_id = document.id
    WHERE document.publication = 'published'
      AND ${visible(sql, "displayable", "document", "document.id")}
    ORDER BY document.filed_on DESC NULLS LAST, document.title
  `;
}
