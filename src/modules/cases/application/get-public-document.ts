import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface PublicDocumentDetail {
  publicId: string;
  casePublicId: string;
  title: string;
  documentType: string;
  filedOn: string | null;
  extractionConfidence: string | null;
  docketEntryNumber: string | null;
  docketDescription: string | null;
}

export async function getPublicDocument(
  sql: Sql,
  casePublicId: string,
  documentPublicId: string,
): Promise<PublicDocumentDetail | null> {
  const [record] = await sql<PublicDocumentDetail[]>`
    SELECT document.public_id AS "publicId", legal_case.public_id AS "casePublicId",
      document.title, document.document_type AS "documentType",
      document.filed_on::text AS "filedOn",
      document.extraction_confidence::text AS "extractionConfidence",
      entry.entry_number AS "docketEntryNumber", entry.description AS "docketDescription"
    FROM document
    JOIN legal_case ON legal_case.id = document.case_id
    LEFT JOIN docket_entry entry ON entry.id = document.docket_entry_id
    WHERE legal_case.public_id = ${casePublicId}
      AND document.public_id = ${documentPublicId}
      AND legal_case.publication = 'published'
      AND document.publication = 'published'
      AND EXISTS (
        SELECT 1 FROM publication_decision decision
        WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
          AND decision.displayable
      )
      AND EXISTS (
        SELECT 1 FROM publication_decision decision
        WHERE decision.object_type = 'document' AND decision.object_id = document.id
          AND decision.displayable
      )
    LIMIT 1
  `;
  return record ?? null;
}
