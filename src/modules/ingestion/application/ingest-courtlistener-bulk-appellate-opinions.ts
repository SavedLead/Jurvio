import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { queuePublicationReview } from "@/modules/publication/application/publication-review";
import { APPELLATE_COURT_REGISTRY } from "../providers/appellate/registry";
import { parseBulkCsv } from "../providers/courtlistener/bulk";
import {
  bulkDocketSourceUri,
  courtListenerBulkDocketSchema,
} from "../providers/courtlistener/bulk-dockets";
import {
  bulkClusterSourceUri,
  bulkContentHash,
  bulkOpinionPlainText,
  bulkOpinionSourceUri,
  bulkOpinionWordCount,
  normalizeBulkOpinionType,
  openBulkCsvFromUrl,
  readBulkCitations,
  readBulkOpinionClusters,
  readBulkOpinions,
  type CourtListenerBulkOpinion,
  type CourtListenerBulkOpinionCluster,
} from "../providers/courtlistener/bulk-opinions";
import type { ArtifactStore } from "./artifact-store";

type Sql = ReturnType<typeof postgres>;

export const DEFAULT_BULK_BASE_URL =
  "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data";

export interface BulkAppellateOpinionOptions {
  snapshotDate: string;
  baseUrl?: string;
  minYear?: number;
  limit?: number;
  onProgress?: (progress: { opinionsWritten: number; opinionsSkipped: number }) => void;
}

export interface BulkAppellateOpinionResult {
  dockets: number;
  clusters: number;
  opinionsWritten: number;
  opinionsSkipped: number;
}

// Only the fields the join and the write path consume are retained in memory;
// the internal ids are memoised in place after the first write so a cluster's
// many opinions never re-run the case/cluster upserts.
interface CoaDocket {
  courtCode: string;
  docketNumber: string;
  caseName: string;
  dateFiled: string | null;
  caseInternalId?: string;
  courtId?: string;
}

interface ClusterCitation {
  volume: string;
  reporter: string;
  page: string;
  type: string;
}

// The complete parsed cluster row is retained so nothing the bulk export carries
// is dropped: the columned fields feed opinion_cluster and the whole row is
// written to opinion_cluster.provider_metadata.
interface CoaCluster {
  row: CourtListenerBulkOpinionCluster;
  citations: ClusterCitation[];
  clusterInternalId?: string;
}

interface ClusterFacts {
  docketId: string;
  caseName: string;
  dateFiled: string | null;
  precedentialStatus: string | null;
  citationCount: number;
  judges: string | null;
  syllabus: string | null;
  proceduralHistory: string | null;
}

function clusterFacts(cluster: CoaCluster, docket: CoaDocket): ClusterFacts {
  const row = cluster.row;
  const caseName = row.case_name_full || row.case_name || row.case_name_short || docket.caseName;
  return {
    docketId: row.docket_id,
    caseName,
    dateFiled: safeDate(row.date_filed),
    precedentialStatus: row.precedential_status || null,
    citationCount: Number.parseInt(row.citation_count, 10) || 0,
    judges: row.judges || null,
    syllabus: row.syllabus || null,
    proceduralHistory: row.procedural_history || null,
  };
}

const COA_COURT_CODES = new Set(
  APPELLATE_COURT_REGISTRY.map((court) => court.courtListenerCode),
);

const PROGRESS_INTERVAL = 5_000;

function safeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bulkFileUrls(baseUrl: string, snapshotDate: string) {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    dockets: `${base}/dockets-${snapshotDate}.csv.bz2`,
    clusters: `${base}/opinion-clusters-${snapshotDate}.csv.bz2`,
    citations: `${base}/citations-${snapshotDate}.csv.bz2`,
    opinions: `${base}/opinions-${snapshotDate}.csv.bz2`,
  };
}

const CASE_PUBLICATION_CANDIDATE = {
  hasCanonicalSource: true,
  hasStableIdentity: true,
  hasMeaningfulContent: true,
  isBlockedOrSealed: false,
  verification: "not_verified" as const,
  containsUnresolvedSensitiveData: true,
};

export async function ingestCourtListenerBulkAppellateOpinions(
  sql: Sql,
  artifactStore: ArtifactStore,
  options: BulkAppellateOpinionOptions,
): Promise<BulkAppellateOpinionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.snapshotDate)) {
    throw new Error("Bulk snapshot date must be YYYY-MM-DD");
  }
  const snapshotDate = options.snapshotDate;
  const minYear = options.minYear ?? 1900;
  const limit = options.limit;
  const urls = bulkFileUrls(options.baseUrl ?? DEFAULT_BULK_BASE_URL, snapshotDate);

  const [provider] = await sql<{ id: string }[]>`
    SELECT id FROM provider WHERE code = 'courtlistener'
  `;
  if (!provider) throw new Error("CourtListener provider seed is missing");
  const providerId = provider.id;

  const docketObjectKey = `courtlistener/bulk/appellate/${snapshotDate}/dockets.csv.bz2`;
  const clusterObjectKey = `courtlistener/bulk/appellate/${snapshotDate}/opinion-clusters.csv.bz2`;

  // Pass A: keep only COA dockets.
  const dockets = new Map<string, CoaDocket>();
  {
    const source = openBulkCsvFromUrl(urls.dockets);
    try {
      for await (const row of parseBulkCsv(source.stream, courtListenerBulkDocketSchema)) {
        if (!COA_COURT_CODES.has(row.court_id)) continue;
        dockets.set(row.id, {
          courtCode: row.court_id,
          docketNumber: row.docket_number,
          caseName: row.case_name,
          dateFiled: row.date_filed ?? null,
        });
      }
      await source.completion;
    } finally {
      source.close();
    }
  }

  // Pass B: keep only clusters that belong to a COA docket and pass the year gate,
  // retaining the full parsed row so provider_metadata loses nothing.
  const clusters = new Map<string, CoaCluster>();
  for await (const row of readBulkOpinionClusters(openBulkCsvFromUrl(urls.clusters))) {
    if (!dockets.has(row.docket_id)) continue;
    const dateFiled = safeDate(row.date_filed);
    if (dateFiled && Number(dateFiled.slice(0, 4)) < minYear) continue;
    clusters.set(row.id, { row, citations: [] });
  }

  // Pass B2: attach the official reporter citations to their COA clusters.
  for await (const citation of readBulkCitations(openBulkCsvFromUrl(urls.citations))) {
    const cluster = clusters.get(citation.cluster_id);
    if (!cluster) continue;
    cluster.citations.push({
      volume: citation.volume,
      reporter: citation.reporter,
      page: citation.page,
      type: citation.type,
    });
  }

  const ensureCase = async (docketId: string, docket: CoaDocket): Promise<CoaDocket> => {
    if (docket.caseInternalId && docket.courtId) return docket;

    const contentHash = bulkContentHash(
      `docket|${docketId}|${docket.courtCode}|${docket.docketNumber}|${docket.caseName}`,
    );
    const courtName = docket.courtCode.toUpperCase();
    const persisted = await sql.begin(async (tx) => {
      const [artifact] = await tx<{ id: string }[]>`
        INSERT INTO raw_artifact (
          provider_id, source_uri, source_record_id, content_hash, object_key,
          media_type, retrieved_at, response_metadata
        ) VALUES (
          ${providerId}, ${bulkDocketSourceUri(snapshotDate, docketId)},
          ${docketId}, ${contentHash}, ${docketObjectKey}, 'text/csv',
          ${snapshotDate},
          ${tx.json({ source: "courtlistener_bulk", snapshotDate, lane: "appellate" })}
        )
        ON CONFLICT (provider_id, source_uri, content_hash)
        DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
        RETURNING id
      `;
      if (!artifact) throw new Error("Bulk docket artifact was not persisted");

      const [court] = await tx<{ id: string }[]>`
        INSERT INTO court (
          public_id, provider_id, provider_court_id, name, short_name,
          verification, source_artifact_id
        ) VALUES (
          ${createPublicId("court")}, ${providerId}, ${docket.courtCode},
          ${courtName}, ${courtName}, 'verified', ${artifact.id}
        )
        ON CONFLICT (provider_id, provider_court_id)
        DO UPDATE SET source_artifact_id = EXCLUDED.source_artifact_id, updated_at = now()
        RETURNING id
      `;
      if (!court) throw new Error("Bulk appellate court was not persisted");

      const canonicalMatches = await tx<{ case_id: string }[]>`
        SELECT legal_case.id AS case_id
        FROM legal_case
        JOIN court ON court.id = legal_case.court_id
        WHERE lower(coalesce(court.provider_court_id, '')) = lower(${docket.courtCode})
          AND lower(regexp_replace(legal_case.docket_number, '[^a-zA-Z0-9]', '', 'g'))
            = lower(regexp_replace(${docket.docketNumber}, '[^a-zA-Z0-9]', '', 'g'))
        ORDER BY (legal_case.verification = 'verified') DESC,
          (legal_case.publication = 'published') DESC, legal_case.created_at
        LIMIT 2
      `;

      let legalCase: { id: string; public_id: string };
      if (canonicalMatches.length === 1 && canonicalMatches[0]) {
        const [updated] = await tx<{ id: string; public_id: string }[]>`
          UPDATE legal_case SET
            caption = CASE WHEN length(${docket.caseName}) > length(caption)
              THEN ${docket.caseName} ELSE caption END,
            filed_on = COALESCE(filed_on, ${safeDate(docket.dateFiled)}),
            source_updated_at = GREATEST(source_updated_at, ${snapshotDate}),
            updated_at = now()
          WHERE id = ${canonicalMatches[0].case_id}
          RETURNING id, public_id
        `;
        if (!updated) throw new Error("Bulk appellate case was not updated");
        legalCase = updated;
      } else {
        const [created] = await tx<{ id: string; public_id: string }[]>`
          INSERT INTO legal_case (
            public_id, court_id, docket_number, caption, filed_on,
            verification, publication, source_artifact_id, source_updated_at
          ) VALUES (
            ${createPublicId("case")}, ${court.id}, ${docket.docketNumber},
            ${docket.caseName}, ${safeDate(docket.dateFiled)}, 'not_verified',
            'draft', ${artifact.id}, ${snapshotDate}
          )
          ON CONFLICT (court_id, docket_number) WHERE supreme_court_term IS NULL
          DO UPDATE SET
            caption = EXCLUDED.caption,
            filed_on = COALESCE(EXCLUDED.filed_on, legal_case.filed_on),
            source_artifact_id = EXCLUDED.source_artifact_id,
            source_updated_at = EXCLUDED.source_updated_at, updated_at = now()
          RETURNING id, public_id
        `;
        if (!created) throw new Error("Bulk appellate case was not persisted");
        legalCase = created;
      }

      await tx`
        INSERT INTO case_identifier (
          case_id, provider_id, identifier_type, identifier_value
        ) VALUES (
          ${legalCase.id}, ${providerId}, 'courtlistener_docket_id', ${docketId}
        )
        ON CONFLICT (provider_id, identifier_type, identifier_value)
        DO UPDATE SET case_id = EXCLUDED.case_id
      `;

      await tx`
        INSERT INTO outbox_event (
          topic, aggregate_type, aggregate_id, aggregate_version, payload
        ) VALUES (
          'case.changed', 'legal_case', ${legalCase.id},
          (extract(epoch from clock_timestamp()) * 1000000)::bigint,
          ${tx.json({
            caseId: legalCase.public_id,
            source: "courtlistener_bulk",
            snapshotDate,
            lane: "appellate",
          })}
        )
      `;

      return { courtId: court.id, caseInternalId: legalCase.id };
    });

    docket.courtId = persisted.courtId;
    docket.caseInternalId = persisted.caseInternalId;

    await queuePublicationReview(sql, {
      objectType: "legal_case",
      objectId: persisted.caseInternalId,
      candidate: CASE_PUBLICATION_CANDIDATE,
      requestedByType: "system",
      evidence: [{ provider: "courtlistener", docketId, source: "courtlistener_bulk" }],
    });
    return docket;
  };

  const ensureCluster = async (
    clusterId: string,
    cluster: CoaCluster,
    facts: ClusterFacts,
    docket: CoaDocket,
  ): Promise<string> => {
    if (cluster.clusterInternalId) return cluster.clusterInternalId;
    const caseInternalId = docket.caseInternalId;
    if (!caseInternalId) throw new Error("Case must be persisted before its cluster");

    const contentHash = bulkContentHash(
      `cluster|${clusterId}|${facts.docketId}|${facts.caseName}|${facts.dateFiled ?? ""}`,
    );
    const clusterInternalId = await sql.begin(async (tx) => {
      const [artifact] = await tx<{ id: string }[]>`
        INSERT INTO raw_artifact (
          provider_id, source_uri, source_record_id, content_hash, object_key,
          media_type, retrieved_at, response_metadata
        ) VALUES (
          ${providerId}, ${bulkClusterSourceUri(snapshotDate, clusterId)}, ${clusterId},
          ${contentHash}, ${clusterObjectKey}, 'text/csv', ${snapshotDate},
          ${tx.json({ source: "courtlistener_bulk", snapshotDate, lane: "appellate" })}
        )
        ON CONFLICT (provider_id, source_uri, content_hash)
        DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
        RETURNING id
      `;
      if (!artifact) throw new Error("Bulk opinion-cluster artifact was not persisted");

      const [row] = await tx<{ id: string }[]>`
        INSERT INTO opinion_cluster (
          public_id, case_id, provider_id, provider_cluster_id, case_name,
          date_filed, precedential_status, citation_count, citations, judges,
          syllabus, procedural_history, source_artifact_id, source_updated_at,
          provider_metadata
        ) VALUES (
          ${createPublicId("cluster")}, ${caseInternalId}, ${providerId},
          ${clusterId}, ${facts.caseName}, ${facts.dateFiled},
          ${facts.precedentialStatus}, ${facts.citationCount},
          ${tx.json(cluster.citations as unknown as postgres.JSONValue)},
          ${facts.judges}, ${facts.syllabus}, ${facts.proceduralHistory},
          ${artifact.id}, ${snapshotDate},
          ${tx.json(cluster.row as unknown as postgres.JSONValue)}
        )
        ON CONFLICT (provider_id, provider_cluster_id)
        DO UPDATE SET
          case_id = EXCLUDED.case_id, case_name = EXCLUDED.case_name,
          date_filed = EXCLUDED.date_filed,
          precedential_status = EXCLUDED.precedential_status,
          citation_count = EXCLUDED.citation_count, citations = EXCLUDED.citations,
          judges = EXCLUDED.judges, syllabus = EXCLUDED.syllabus,
          procedural_history = EXCLUDED.procedural_history,
          source_artifact_id = EXCLUDED.source_artifact_id,
          source_updated_at = EXCLUDED.source_updated_at,
          provider_metadata = EXCLUDED.provider_metadata, updated_at = now()
        RETURNING id
      `;
      if (!row) throw new Error("Bulk opinion cluster was not persisted");
      return row.id;
    });

    cluster.clusterInternalId = clusterInternalId;
    return clusterInternalId;
  };

  const writeOpinion = async (
    opinion: CourtListenerBulkOpinion,
    cluster: CoaCluster,
    docket: CoaDocket,
    extracted: ReturnType<typeof bulkOpinionPlainText>,
  ): Promise<void> => {
    const contentText = extracted.text.trim();
    if (!contentText) throw new Error("Bulk opinion extracted to empty text");

    const facts = clusterFacts(cluster, docket);
    await ensureCase(facts.docketId, docket);
    const clusterInternalId = await ensureCluster(
      opinion.cluster_id,
      cluster,
      facts,
      docket,
    );
    const caseInternalId = docket.caseInternalId;
    const courtId = docket.courtId;
    if (!caseInternalId || !courtId) throw new Error("Case ids were not resolved");

    const opinionType = normalizeBulkOpinionType(opinion.type);
    const caseName = facts.caseName;
    const title = `${caseName} — ${opinionType}`;
    const courtName = docket.courtCode.toUpperCase();
    const contentHtml = extracted.html ?? `<p>${escapeHtml(contentText)}</p>`;
    const contentHash = bulkContentHash(contentHtml);
    const wordCount = bulkOpinionWordCount(contentText);
    const dateFiled = facts.dateFiled;
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
          ${tx.json({ source: "courtlistener_bulk", snapshotDate, lane: "appellate" })}
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
            ${createPublicId("document")}, ${caseInternalId}, 'judicial_opinion',
            ${title}, ${dateFiled}, ${contentHash}, ${artifact.id}, 'draft', 1.000
          )
          RETURNING id
        `;
        if (!created) throw new Error("Bulk opinion document was not created");
        resolvedDocumentId = created.id;
      } else {
        await tx`
          UPDATE document SET
            case_id = ${caseInternalId}, title = ${title}, filed_on = ${dateFiled},
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
          ${clusterInternalId}, ${resolvedDocumentId}, ${providerId}, ${opinion.id},
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
          ${resolvedDocumentId}, ${caseInternalId}, ${courtId}, ${clusterInternalId},
          ${title}, ${caseName}, ${courtName}, ${dateFiled},
          ${facts.precedentialStatus}, ${opinionType},
          ${facts.citationCount}, ${contentText}
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
  };

  // Pass C: stream opinions and write the full graph for matched clusters.
  let opinionsWritten = 0;
  let opinionsSkipped = 0;
  const source = openBulkCsvFromUrl(urls.opinions);
  let stop = false;
  try {
    for await (const opinion of readBulkOpinions(source)) {
      const cluster = clusters.get(opinion.cluster_id);
      if (!cluster) continue;
      const docket = dockets.get(cluster.row.docket_id);
      if (!docket) continue;
      const extracted = bulkOpinionPlainText(opinion);
      if (!extracted.text.trim()) {
        opinionsSkipped += 1;
        continue;
      }
      await writeOpinion(opinion, cluster, docket, extracted);
      opinionsWritten += 1;
      if (opinionsWritten % PROGRESS_INTERVAL === 0) {
        options.onProgress?.({ opinionsWritten, opinionsSkipped });
      }
      if (limit && opinionsWritten >= limit) {
        stop = true;
        break;
      }
    }
    if (!stop) await source.completion;
  } finally {
    source.close();
  }

  return {
    dockets: dockets.size,
    clusters: clusters.size,
    opinionsWritten,
    opinionsSkipped,
  };
}
