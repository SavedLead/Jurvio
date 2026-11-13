import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { normalizeCourtListenerDocketEntry } from "../normalize/docket-entry";
import { fetchDocketEntries } from "../providers/courtlistener/client";
import type { ArtifactStore } from "./artifact-store";

type Sql = ReturnType<typeof postgres>;

export async function ingestCourtListenerDocketEntries(
  sql: Sql,
  artifactStore: ArtifactStore,
  input: { providerId: string; caseId: string; docketId: number; maximumPages?: number; newestFirst?: boolean },
): Promise<{ accepted: number; rejected: number; documents: number }> {
  const retrievedEntries = await fetchDocketEntries(
    input.docketId,
    input.maximumPages ?? 500,
    input.newestFirst ? "-date_filed,-id" : "date_filed,id",
  );
  let accepted = 0;
  let rejected = 0;
  let documents = 0;

  for (const retrieved of retrievedEntries) {
    const sourceRecordId = String(retrieved.record.id);
    const stored = await artifactStore.putIfAbsent({
      key: `courtlistener/docket-entries/${sourceRecordId}/${retrieved.contentHash}.json`,
      mediaType: "application/json",
      body: retrieved.rawBody,
      contentHash: retrieved.contentHash,
    });

    await sql.begin(async (tx) => {
      const [artifact] = await tx<{ id: string }[]>`
        INSERT INTO raw_artifact (
          provider_id, source_uri, source_record_id, content_hash, object_key,
          media_type, retrieved_at, response_metadata
        ) VALUES (
          ${input.providerId}, ${retrieved.sourceUri}, ${sourceRecordId},
          ${retrieved.contentHash}, ${stored.objectKey}, 'application/json',
          ${retrieved.retrievedAt}, ${tx.json(retrieved.responseMetadata)}
        )
        ON CONFLICT (provider_id, source_uri, content_hash)
        DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
        RETURNING id
      `;
      if (!artifact) throw new Error("Docket-entry artifact was not persisted");

      let normalized;
      try {
        normalized = normalizeCourtListenerDocketEntry(retrieved.record);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown normalization error";
        await tx`
          INSERT INTO ingestion_rejection (
            provider_id, source_uri, source_record_id, reason_code,
            error_message, raw_artifact_id
          ) VALUES (
            ${input.providerId}, ${retrieved.sourceUri}, ${sourceRecordId},
            'docket_entry_normalization_failed', ${message}, ${artifact.id}
          )
          ON CONFLICT (
            provider_id, source_uri, source_record_id, reason_code, resolved_at
          )
          DO UPDATE SET error_message = EXCLUDED.error_message,
            raw_artifact_id = EXCLUDED.raw_artifact_id, last_seen_at = now()
        `;
        rejected += 1;
        return;
      }

      const [entry] = await tx<{ id: string }[]>`
        INSERT INTO docket_entry (
          public_id, case_id, provider_id, provider_entry_id, entry_number,
          filed_on, description, source_artifact_id
        ) VALUES (
          ${createPublicId("docketEntry")}, ${input.caseId}, ${input.providerId},
          ${normalized.sourceEntryId}, ${normalized.entryNumber ?? null},
          ${normalized.filedOn ?? null}, ${normalized.description}, ${artifact.id}
        )
        ON CONFLICT (provider_id, provider_entry_id)
        DO UPDATE SET entry_number = EXCLUDED.entry_number,
          filed_on = EXCLUDED.filed_on, description = EXCLUDED.description,
          source_artifact_id = EXCLUDED.source_artifact_id, updated_at = now()
        RETURNING id
      `;
      if (!entry) throw new Error("Docket entry was not persisted");

      for (const sourceDocument of normalized.documents) {
        const identityLock = `courtlistener-document:${sourceDocument.sourceDocumentId}`;
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${identityLock}, 0))`;

        const [existing] = await tx<{ document_id: string }[]>`
          SELECT document_id FROM document_identifier
          WHERE provider_id = ${input.providerId}
            AND identifier_type = 'courtlistener_recap_document_id'
            AND identifier_value = ${sourceDocument.sourceDocumentId}
        `;

        const title = sourceDocument.description ??
          (sourceDocument.documentNumber
            ? "Document " + sourceDocument.documentNumber
            : "Court filing");
        const documentType = sourceDocument.documentType ?? "unknown";
        let documentId = existing?.document_id;

        if (!documentId) {
          const [created] = await tx<{ id: string }[]>`
            INSERT INTO document (
              public_id, case_id, docket_entry_id, document_type, title,
              filed_on, source_artifact_id, publication
            ) VALUES (
              ${createPublicId("document")}, ${input.caseId}, ${entry.id},
              ${documentType}, ${title}, ${normalized.filedOn ?? null},
              ${artifact.id}, 'draft'
            )
            RETURNING id
          `;
          if (!created) throw new Error("Document was not persisted");
          documentId = created.id;

          await tx`
            INSERT INTO document_identifier (
              document_id, provider_id, identifier_type, identifier_value
            ) VALUES (
              ${documentId}, ${input.providerId},
              'courtlistener_recap_document_id', ${sourceDocument.sourceDocumentId}
            )
          `;
        } else {
          await tx`
            UPDATE document SET docket_entry_id = ${entry.id},
              document_type = ${documentType}, title = ${title},
              filed_on = ${normalized.filedOn ?? null},
              source_artifact_id = ${artifact.id}, updated_at = now()
            WHERE id = ${documentId}
          `;
        }

        documents += 1;
      }

      accepted += 1;
    });
  }

  return { accepted, rejected, documents };
}
