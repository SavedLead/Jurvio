import type postgres from "postgres";
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

/** A full ordinary docket, including the initial filing. Callers that only need a preview pass a smaller limit. */
export const PUBLIC_DOCKET_LIST_LIMIT = 2000;

export async function listPublicDocketEntries(sql: Sql, casePublicId: string, limit = PUBLIC_DOCKET_LIST_LIMIT) {
  return sql<PublicDocketEntry[]>`
    SELECT entry.public_id AS "publicId", entry.entry_number AS "entryNumber",
      entry.filed_on::text AS "filedOn", entry.description, entry.importance
    FROM docket_entry entry
    JOIN legal_case legal_case ON legal_case.id = entry.case_id
    WHERE legal_case.public_id = ${casePublicId}
      AND legal_case.publication = 'published'
      AND ${visible(sql, "displayable", "legal_case", "legal_case.id")}
      AND ${visible(sql, "displayable", "docket_entry", "entry.id")}
    ORDER BY entry.filed_on DESC NULLS LAST, entry.entry_number DESC NULLS LAST
    LIMIT ${limit}
  `;
}

export async function listPublicParties(sql: Sql, casePublicId: string) {
  return sql<PublicParty[]>`
    SELECT entity.public_id AS "publicId", entity.display_name AS "displayName",
      appearance.role, appearance.party_name_as_filed AS "nameAsFiled"
    FROM party_appearance appearance
    JOIN legal_case legal_case ON legal_case.id = appearance.case_id
    JOIN entity ON entity.id = appearance.entity_id
    WHERE legal_case.public_id = ${casePublicId}
      AND legal_case.publication = 'published'
      AND ${visible(sql, "displayable", "legal_case", "legal_case.id")}
      -- A party with no entity-level decision of its own is displayable, because
      -- the gate that matters has already been applied above: the case it appears
      -- in is published AND carries a displayable publication decision. Nothing
      -- writes an entity decision outside the manual publication-review workflow,
      -- so requiring one here (the previous default of false) hid EVERY party on
      -- EVERY case. The directory queries in modules/directory already default this
      -- to true; an explicit entity decision still suppresses a party on both.
      AND ${sql.unsafe(latestPublicationColumnSql("displayable", "entity", "entity.id", true))}
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
    JOIN legal_case legal_case ON legal_case.id = document.case_id
    LEFT JOIN document_content content ON content.document_id = document.id
    LEFT JOIN judicial_opinion judicial ON judicial.document_id = document.id
    LEFT JOIN scotus_docket_document docket_document ON docket_document.document_id = document.id
    WHERE legal_case.public_id = ${casePublicId}
      AND legal_case.publication = 'published'
      AND document.publication = 'published'
      AND ${visible(sql, "displayable", "legal_case", "legal_case.id")}
      AND ${visible(sql, "displayable", "document", "document.id")}
    ORDER BY document.filed_on DESC NULLS LAST, document.title
  `;
}
