import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

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

export async function listPublicDocketEntries(sql: Sql, casePublicId: string, limit = 250) {
  return sql<PublicDocketEntry[]>`
    SELECT entry.public_id AS "publicId", entry.entry_number AS "entryNumber",
      entry.filed_on::text AS "filedOn", entry.description, entry.importance
    FROM docket_entry entry
    JOIN legal_case legal_case ON legal_case.id = entry.case_id
    WHERE legal_case.public_id = ${casePublicId}
      AND legal_case.publication = 'published'
      AND COALESCE((
        SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
      AND COALESCE((
        SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'docket_entry' AND decision.object_id = entry.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
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
      AND COALESCE((
        SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
      AND COALESCE((
        SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'entity' AND decision.object_id = entity.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
      ), false)
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
    ORDER BY document.filed_on DESC NULLS LAST, document.title
  `;
}
