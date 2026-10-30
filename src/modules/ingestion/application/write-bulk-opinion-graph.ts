import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { queuePublicationReview } from "@/modules/publication/application/publication-review";
import {
  bulkContentHash,
  bulkOpinionSourceUri,
  bulkOpinionWordCount,
  normalizeBulkOpinionType,
  type bulkOpinionPlainText,
  type CourtListenerBulkOpinion,
} from "../providers/courtlistener/bulk-opinions";
import type { ArtifactStore } from "./artifact-store";

type Sql = ReturnType<typeof postgres>;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * The publication-review candidate every bulk-ingested case/opinion is queued with:
 * conservative (unverified + possible sensitive data) so nothing bulk-loaded is
 * auto-published; a dedicated publisher or human review promotes it later. Shared so
 * the full loader and the chunked opinion importer queue identical review candidates.
 */
export const CASE_PUBLICATION_CANDIDATE = {
  hasCanonicalSource: true,
  hasStableIdentity: true,
  hasMeaningfulContent: true,
  isBlockedOrSealed: false,
  verification: "not_verified" as const,
  containsUnresolvedSensitiveData: true,
};

/**
 * The minimal already-persisted case/cluster facts an opinion needs to attach itself.
 * In the full loader these come from the in-memory Pass B join map; in the chunked
 * importer they come from a DB lookup on opinion_cluster (by provider_cluster_id).
 */
export interface BulkOpinionJoin {
  clusterInternalId: string;
  caseInternalId: string;
  courtId: string;
  courtCode: string;
  caseName: string;
  dateFiled: string | null;
  precedentialStatus: string | null;
  citationCount: number;
}

export interface BulkOpinionWriteContext {
  providerId: string;
  snapshotDate: string;
  lane: string;
}

/**
 * Persist the full document graph for ONE CourtListener bulk opinion: raw_artifact ->
 * document -> judicial_opinion -> document_identifier -> document_content ->
 * opinion_search_projection, then queue the document for publication review. Every
 * write is an idempotent upsert on a provider-scoped natural key, so re-running on the
 * same opinion updates in place and never creates a duplicate.
 *
 * This is the single source of truth for opinion writes: the monolithic bulk loader's
 * Pass C and the resumable chunked importer both call it, so their dedup/write
 * behavior is identical by construction.
 */
export async function writeBulkOpinionGraph(
  sql: Sql,
  artifactStore: ArtifactStore,
  ctx: BulkOpinionWriteContext,
  opinion: CourtListenerBulkOpinion,
  join: BulkOpinionJoin,
  extracted: ReturnType<typeof bulkOpinionPlainText>,
): Promise<void> {
  const { providerId, snapshotDate, lane } = ctx;
  const contentText = extracted.text.trim();
  if (!contentText) throw new Error("Bulk opinion extracted to empty text");

  const opinionType = normalizeBulkOpinionType(opinion.type);
  const title = `${join.caseName} — ${opinionType}`;
  const courtName = join.courtCode.toUpperCase();
  const contentHtml = extracted.html ?? `<p>${escapeHtml(contentText)}</p>`;
  const contentHash = bulkContentHash(contentHtml);
  const wordCount = bulkOpinionWordCount(contentText);
  const objectHash = opinion.sha1 || contentHash;

  const stored = await artifactStore.putIfAbsent({
    key: `courtlistener/bulk/opinions/${opinion.id}/${objectHash}.json`,
    mediaType: "application/json",
    body: JSON.stringify(opinion),
    contentHash,
  });

  const documentId = await sql.begin(async (tx) => {
    const [artifact] = await tx<{ id: string }[]>`
      INSERT INTO raw_artifact (
        provider_id, source_uri, source_record_id, content_hash, object_key,
        media_type, retrieved_at, response_metadata
      ) VALUES (
        ${providerId}, ${bulkOpinionSourceUri(snapshotDate, opinion.id)}, ${opinion.id},
        ${contentHash}, ${stored.objectKey}, 'application/json', ${snapshotDate},
        ${tx.json({ source: "courtlistener_bulk", snapshotDate, lane })}
      )
      ON CONFLICT (provider_id, source_uri, content_hash)
      DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
      RETURNING id
    `;
    if (!artifact) throw new Error("Bulk opinion artifact was not persisted");

    const [existing] = await tx<{ document_id: string }[]>`
      SELECT judicial.document_id
      FROM judicial_opinion judicial
      WHERE judicial.provider_id = ${providerId}
        AND judicial.provider_opinion_id = ${opinion.id}
      LIMIT 1
    `;

    let resolvedDocumentId = existing?.document_id;
    if (!resolvedDocumentId) {
      const [created] = await tx<{ id: string }[]>`
        INSERT INTO document (
          public_id, case_id, document_type, title, filed_on, content_hash,
          source_artifact_id, publication, extraction_confidence
        ) VALUES (
          ${createPublicId("document")}, ${join.caseInternalId}, 'judicial_opinion',
          ${title}, ${join.dateFiled}, ${contentHash}, ${artifact.id}, 'draft', 1.000
        )
        RETURNING id
      `;
      if (!created) throw new Error("Bulk opinion document was not created");
      resolvedDocumentId = created.id;
    } else {
      await tx`
        UPDATE document SET
          case_id = ${join.caseInternalId}, title = ${title}, filed_on = ${join.dateFiled},
          content_hash = ${contentHash}, source_artifact_id = ${artifact.id},
          extraction_confidence = 1.000, updated_at = now()
        WHERE id = ${resolvedDocumentId}
      `;
    }

    await tx`
      INSERT INTO judicial_opinion (
        cluster_id, document_id, provider_id, provider_opinion_id, opinion_type,
        author_name, per_curiam, source_download_url, source_artifact_id,
        provider_metadata
      ) VALUES (
        ${join.clusterInternalId}, ${resolvedDocumentId}, ${providerId}, ${opinion.id},
        ${opinionType}, ${opinion.author_str || null}, ${opinion.per_curiam ?? false},
        ${opinion.download_url || null}, ${artifact.id},
        ${tx.json(opinion as unknown as postgres.JSONValue)}
      )
      ON CONFLICT (provider_id, provider_opinion_id)
      DO UPDATE SET
        cluster_id = EXCLUDED.cluster_id, document_id = EXCLUDED.document_id,
        opinion_type = EXCLUDED.opinion_type, author_name = EXCLUDED.author_name,
        per_curiam = EXCLUDED.per_curiam,
        source_download_url = EXCLUDED.source_download_url,
        source_artifact_id = EXCLUDED.source_artifact_id,
        provider_metadata = EXCLUDED.provider_metadata, updated_at = now()
    `;

    await tx`
      INSERT INTO document_identifier (
        document_id, provider_id, identifier_type, identifier_value
      ) VALUES (
        ${resolvedDocumentId}, ${providerId}, 'courtlistener_opinion_id', ${opinion.id}
      )
      ON CONFLICT (provider_id, identifier_type, identifier_value)
      DO UPDATE SET document_id = EXCLUDED.document_id
    `;

    await tx`
      INSERT INTO document_content (
        document_id, content_html, content_text, content_hash, extraction_method,
        word_count, source_artifact_id
      ) VALUES (
        ${resolvedDocumentId}, ${contentHtml}, ${contentText}, ${contentHash},
        ${extracted.method}, ${wordCount}, ${artifact.id}
      )
      ON CONFLICT (document_id)
      DO UPDATE SET
        content_html = EXCLUDED.content_html, content_text = EXCLUDED.content_text,
        content_hash = EXCLUDED.content_hash,
        extraction_method = EXCLUDED.extraction_method,
        word_count = EXCLUDED.word_count,
        source_artifact_id = EXCLUDED.source_artifact_id, updated_at = now()
    `;

    await tx`
      INSERT INTO opinion_search_projection (
        document_id, case_id, court_id, cluster_id, title, case_caption,
        court_name, date_filed, precedential_status, opinion_type,
        citation_count, body
      ) VALUES (
        ${resolvedDocumentId}, ${join.caseInternalId}, ${join.courtId}, ${join.clusterInternalId},
        ${title}, ${join.caseName}, ${courtName}, ${join.dateFiled},
        ${join.precedentialStatus}, ${opinionType},
        ${join.citationCount}, ${contentText}
      )
      ON CONFLICT (document_id)
      DO UPDATE SET
        case_id = EXCLUDED.case_id, court_id = EXCLUDED.court_id,
        cluster_id = EXCLUDED.cluster_id, title = EXCLUDED.title,
        case_caption = EXCLUDED.case_caption, court_name = EXCLUDED.court_name,
        date_filed = EXCLUDED.date_filed,
        precedential_status = EXCLUDED.precedential_status,
        opinion_type = EXCLUDED.opinion_type,
        citation_count = EXCLUDED.citation_count, body = EXCLUDED.body,
        updated_at = now()
    `;

    // Opinion text now exists. A hold that existed only because the case had no
    // readable content is stale; drop it so the publisher can re-evaluate the case.
    // Holds with any other reason stay.
    await tx`
      DELETE FROM federal_publication_hold
      WHERE case_id = ${join.caseInternalId}
        AND reasons = ARRAY['missing_readable_content']::text[]
    `;

    return resolvedDocumentId;
  });

  await queuePublicationReview(sql, {
    objectType: "document",
    objectId: documentId,
    candidate: CASE_PUBLICATION_CANDIDATE,
    requestedByType: "system",
    evidence: [{
      provider: "courtlistener",
      opinionId: opinion.id,
      clusterId: opinion.cluster_id,
      source: "courtlistener_bulk",
    }],
  });
}
