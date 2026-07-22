import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { fetchDocket, fetchOpinion, fetchOpinionCluster } from "../providers/courtlistener/client";
import {
  normalizeOpinion,
  normalizeOpinionCluster,
  type NormalizedOpinion,
} from "../normalize/opinion";
import type { RetrievedRecord } from "../providers/courtlistener/client";
import type { CourtListenerOpinion } from "../providers/courtlistener/schema";
import type { ArtifactStore } from "./artifact-store";
import { persistCourtListenerCase } from "./persist-courtlistener-case";
import { queuePublicationReview } from "@/modules/publication/application/publication-review";

type Sql = ReturnType<typeof postgres>;

export async function ingestCourtListenerOpinionCluster(
  sql: Sql,
  artifactStore: ArtifactStore,
  clusterId: number,
) {
  const retrievedCluster = await fetchOpinionCluster(clusterId);
  const normalizedCluster = normalizeOpinionCluster(retrievedCluster.record);
  const retrievedDocket = await fetchDocket(normalizedCluster.sourceDocketId);
  const caseResult = await persistCourtListenerCase(sql, artifactStore, retrievedDocket);

  const normalizedOpinions: NormalizedOpinion[] = [];
  const skippedOpinions: Array<{ opinionId: number; reason: string }> = [];
  const opinionRecords: RetrievedRecord<CourtListenerOpinion>[] = [];
  for (const opinionId of normalizedCluster.opinionIds) {
    const retrieved = await fetchOpinion(opinionId);
    try {
      normalizedOpinions.push(normalizeOpinion(retrieved.record, normalizedCluster));
      opinionRecords.push(retrieved);
    } catch (error) {
      skippedOpinions.push({
        opinionId,
        reason: error instanceof Error ? error.message : "Opinion normalization failed",
      });
    }
  }

  const storedCluster = await artifactStore.putIfAbsent({
    key: `courtlistener/opinion-clusters/${clusterId}/${retrievedCluster.contentHash}.json`,
    mediaType: "application/json",
    body: retrievedCluster.rawBody,
    contentHash: retrievedCluster.contentHash,
  });
  const storedOpinions = await Promise.all(opinionRecords.map((retrieved) =>
    artifactStore.putIfAbsent({
      key: `courtlistener/opinions/${retrieved.record.id}/${retrieved.contentHash}.json`,
      mediaType: "application/json",
      body: retrieved.rawBody,
      contentHash: retrieved.contentHash,
    }),
  ));

  const result = await sql.begin(async (tx) => {
    const [clusterArtifact] = await tx<{ id: string }[]>`
      INSERT INTO raw_artifact (
        provider_id, source_uri, source_record_id, content_hash, object_key,
        media_type, retrieved_at, response_metadata
      ) VALUES (
        ${caseResult.providerId}, ${retrievedCluster.sourceUri},
        ${normalizedCluster.sourceClusterId}, ${retrievedCluster.contentHash},
        ${storedCluster.objectKey}, 'application/json', ${retrievedCluster.retrievedAt},
        ${tx.json(retrievedCluster.responseMetadata)}
      )
      ON CONFLICT (provider_id, source_uri, content_hash)
      DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
      RETURNING id
    `;
    if (!clusterArtifact) throw new Error("Opinion-cluster artifact was not persisted");

    const [cluster] = await tx<{ id: string; public_id: string }[]>`
      INSERT INTO opinion_cluster (
        public_id, case_id, provider_id, provider_cluster_id, case_name,
        date_filed, precedential_status, citation_count, citations, judges,
        syllabus, procedural_history, source_artifact_id, source_updated_at
      ) VALUES (
        ${createPublicId("cluster")}, ${caseResult.internalCaseId},
        ${caseResult.providerId}, ${normalizedCluster.sourceClusterId},
        ${normalizedCluster.caseName}, ${normalizedCluster.dateFiled ?? null},
        ${normalizedCluster.precedentialStatus ?? null}, ${normalizedCluster.citationCount},
        ${tx.json(JSON.parse(JSON.stringify(normalizedCluster.citations)) as postgres.JSONValue)},
        ${normalizedCluster.judges ?? null},
        ${normalizedCluster.syllabus ?? null}, ${normalizedCluster.proceduralHistory ?? null},
        ${clusterArtifact.id}, ${normalizedCluster.sourceUpdatedAt ?? null}
      )
      ON CONFLICT (provider_id, provider_cluster_id)
      DO UPDATE SET
        case_id = EXCLUDED.case_id,
        case_name = EXCLUDED.case_name,
        date_filed = EXCLUDED.date_filed,
        precedential_status = EXCLUDED.precedential_status,
        citation_count = EXCLUDED.citation_count,
        citations = EXCLUDED.citations,
        judges = EXCLUDED.judges,
        syllabus = EXCLUDED.syllabus,
        procedural_history = EXCLUDED.procedural_history,
        source_artifact_id = EXCLUDED.source_artifact_id,
        source_updated_at = EXCLUDED.source_updated_at,
        updated_at = now()
      RETURNING id, public_id
    `;
    if (!cluster) throw new Error("Opinion cluster was not persisted");

    const documents: Array<{ id: string; publicId: string; sourceOpinionId: string }> = [];
    for (let index = 0; index < normalizedOpinions.length; index += 1) {
      const opinion = normalizedOpinions[index];
      const retrieved = opinionRecords[index];
      const stored = storedOpinions[index];
      if (!opinion || !retrieved || !stored) throw new Error("Opinion persistence inputs diverged");

      const [opinionArtifact] = await tx<{ id: string }[]>`
        INSERT INTO raw_artifact (
          provider_id, source_uri, source_record_id, content_hash, object_key,
          media_type, retrieved_at, response_metadata
        ) VALUES (
          ${caseResult.providerId}, ${retrieved.sourceUri}, ${opinion.sourceOpinionId},
          ${retrieved.contentHash}, ${stored.objectKey}, 'application/json',
          ${retrieved.retrievedAt}, ${tx.json(retrieved.responseMetadata)}
        )
        ON CONFLICT (provider_id, source_uri, content_hash)
        DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
        RETURNING id
      `;
      if (!opinionArtifact) throw new Error("Opinion artifact was not persisted");

      const [existing] = await tx<{ document_id: string; public_id: string }[]>`
        SELECT judicial.document_id, document.public_id
        FROM judicial_opinion judicial
        JOIN document ON document.id = judicial.document_id
        WHERE judicial.provider_id = ${caseResult.providerId}
          AND judicial.provider_opinion_id = ${opinion.sourceOpinionId}
        LIMIT 1
      `;

      let documentId = existing?.document_id;
      let documentPublicId = existing?.public_id;
      if (!documentId || !documentPublicId) {
        const [created] = await tx<{ id: string; public_id: string }[]>`
          INSERT INTO document (
            public_id, case_id, document_type, title, filed_on, content_hash,
            source_artifact_id, publication, extraction_confidence
          ) VALUES (
            ${createPublicId("document")}, ${caseResult.internalCaseId},
            'judicial_opinion', ${opinion.title}, ${normalizedCluster.dateFiled ?? null},
            ${opinion.contentHash}, ${opinionArtifact.id}, 'draft', 1.000
          )
          RETURNING id, public_id
        `;
        if (!created) throw new Error("Opinion document was not created");
        documentId = created.id;
        documentPublicId = created.public_id;
      } else {
        await tx`
          UPDATE document SET
            case_id = ${caseResult.internalCaseId}, title = ${opinion.title},
            filed_on = ${normalizedCluster.dateFiled ?? null},
            content_hash = ${opinion.contentHash}, source_artifact_id = ${opinionArtifact.id},
            extraction_confidence = 1.000, updated_at = now()
          WHERE id = ${documentId}
        `;
      }

      await tx`
        INSERT INTO judicial_opinion (
          cluster_id, document_id, provider_id, provider_opinion_id, opinion_type,
          author_name, per_curiam, source_download_url, source_artifact_id
        ) VALUES (
          ${cluster.id}, ${documentId}, ${caseResult.providerId},
          ${opinion.sourceOpinionId}, ${opinion.opinionType}, ${opinion.authorName ?? null},
          ${opinion.perCuriam}, ${opinion.sourceDownloadUrl ?? null}, ${opinionArtifact.id}
        )
        ON CONFLICT (provider_id, provider_opinion_id)
        DO UPDATE SET
          cluster_id = EXCLUDED.cluster_id, document_id = EXCLUDED.document_id,
          opinion_type = EXCLUDED.opinion_type, author_name = EXCLUDED.author_name,
          per_curiam = EXCLUDED.per_curiam,
          source_download_url = EXCLUDED.source_download_url,
          source_artifact_id = EXCLUDED.source_artifact_id, updated_at = now()
      `;

      await tx`
        INSERT INTO document_identifier (
          document_id, provider_id, identifier_type, identifier_value
        ) VALUES (
          ${documentId}, ${caseResult.providerId}, 'courtlistener_opinion_id',
          ${opinion.sourceOpinionId}
        )
        ON CONFLICT (provider_id, identifier_type, identifier_value)
        DO UPDATE SET document_id = EXCLUDED.document_id
      `;

      await tx`
        INSERT INTO document_content (
          document_id, content_html, content_text, content_hash, extraction_method,
          word_count, source_artifact_id
        ) VALUES (
          ${documentId}, ${opinion.contentHtml}, ${opinion.contentText},
          ${opinion.contentHash}, ${opinion.extractionMethod}, ${opinion.wordCount},
          ${opinionArtifact.id}
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
          ${documentId}, ${caseResult.internalCaseId}, ${caseResult.courtId}, ${cluster.id},
          ${opinion.title}, ${caseResult.caption}, ${caseResult.courtName},
          ${normalizedCluster.dateFiled ?? null}, ${normalizedCluster.precedentialStatus ?? null},
          ${opinion.opinionType}, ${normalizedCluster.citationCount}, ${opinion.contentText}
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

      documents.push({ id: documentId, publicId: documentPublicId, sourceOpinionId: opinion.sourceOpinionId });
    }

    return { clusterPublicId: cluster.public_id, documents };
  });

  await queuePublicationReview(sql, {
    objectType: "legal_case",
    objectId: caseResult.internalCaseId,
    candidate: {
      hasCanonicalSource: true,
      hasStableIdentity: true,
      hasMeaningfulContent: true,
      isBlockedOrSealed: false,
      verification: "not_verified",
      containsUnresolvedSensitiveData: true,
    },
    requestedByType: "system",
    evidence: [{
      provider: "courtlistener",
      docketId: caseResult.sourceCaseId,
      clusterId: normalizedCluster.sourceClusterId,
      sourceHash: retrievedCluster.contentHash,
    }],
  });
  for (const document of result.documents) {
    await queuePublicationReview(sql, {
      objectType: "document",
      objectId: document.id,
      candidate: {
        hasCanonicalSource: true,
        hasStableIdentity: true,
        hasMeaningfulContent: true,
        isBlockedOrSealed: false,
        verification: "not_verified",
        containsUnresolvedSensitiveData: true,
      },
      requestedByType: "system",
      evidence: [{
        provider: "courtlistener",
        opinionId: document.sourceOpinionId,
        clusterId: normalizedCluster.sourceClusterId,
      }],
    });
  }

  return {
    caseId: caseResult.caseId,
    sourceClusterId: normalizedCluster.sourceClusterId,
    ...result,
    documents: result.documents.map((document) => ({
      publicId: document.publicId,
      sourceOpinionId: document.sourceOpinionId,
    })),
    skippedOpinions,
  };
}
