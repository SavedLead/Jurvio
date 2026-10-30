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
  openBulkCsvFromUrl,
  readBulkCitations,
  readBulkOpinionClusters,
  readBulkOpinions,
  type CourtListenerBulkOpinion,
  type CourtListenerBulkOpinionCluster,
} from "../providers/courtlistener/bulk-opinions";
import type { ArtifactStore } from "./artifact-store";
import {
  CASE_PUBLICATION_CANDIDATE,
  writeBulkOpinionGraph,
} from "./write-bulk-opinion-graph";

type Sql = ReturnType<typeof postgres>;

export const DEFAULT_BULK_BASE_URL =
  "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data";

export interface BulkAppellateOpinionOptions {
  snapshotDate: string;
  baseUrl?: string;
  minYear?: number;
  /**
   * Inclusive upper bound on cluster filing year. Left undefined there is no upper
   * bound. Used to slice a very large lane (the federal corpus) into bounded
   * year-window runs so each run finishes in a few hours instead of a day-plus.
   */
  maxYear?: number;
  limit?: number;
  onProgress?: (progress: { opinionsWritten: number; opinionsSkipped: number }) => void;
}

// Generic bulk-opinion options: the docket filter is a provided set of court codes
// (COA codes for the appellate lane, the full federal set for the federal lane) and
// `lane` labels the object keys and response_metadata so the two runs stay separable.
export interface BulkOpinionOptions extends BulkAppellateOpinionOptions {
  courtCodes: ReadonlySet<string>;
  lane: string;
  /**
   * Restrict the run to these exact opinion-cluster ids (cited-but-missing cases
   * resolved from the bulk citation map). When set, `courtFilter` replaces the
   * court-code set so cited cases from any eligible court are kept.
   */
  clusterIds?: ReadonlySet<string>;
  courtFilter?: (courtCode: string) => boolean;
}

export interface BulkAppellateOpinionResult {
  dockets: number;
  clusters: number;
  opinionsWritten: number;
  opinionsSkipped: number;
}

export type BulkOpinionResult = BulkAppellateOpinionResult;

// Pass A retains one of these per matched docket; the internal ids are memoised in
// place the first time a cluster on that docket is persisted.
interface DocketRef {
  courtCode: string;
  docketNumber: string;
  caseName: string;
  dateFiled: string | null;
  caseInternalId?: string;
  courtId?: string;
}

// Pass B persists every matched cluster eagerly and keeps ONLY these minimal join
// facts in memory -- never the parsed cluster row -- so the peak footprint stays
// small on the memory-constrained box.
interface ClusterJoin {
  clusterInternalId: string;
  caseInternalId: string;
  courtId: string;
  courtCode: string;
  caseName: string;
  dateFiled: string | null;
  precedentialStatus: string | null;
  citationCount: number;
}

interface ClusterCitation {
  volume: string;
  reporter: string;
  page: string;
  type: string;
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

const COA_COURT_CODES = new Set(
  APPELLATE_COURT_REGISTRY.map((court) => court.courtListenerCode),
);

const PROGRESS_INTERVAL = 5_000;

function safeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
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

function clusterFacts(row: CourtListenerBulkOpinionCluster, docket: DocketRef): ClusterFacts {
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

/**
 * The in-range rule a bulk opinion-cluster must satisfy to be ingested: it is kept
 * unless it carries a parseable filing year outside [minYear, maxYear]. A cluster
 * with no (or an unparseable) filing date is always kept, matching the loader's
 * long-standing behavior -- and, for year-windowed runs, that means undated clusters
 * are (idempotently) revisited by every window rather than being dropped.
 *
 * Both the Pass A0 docket pre-scan and the Pass B cluster-persist step call this, so
 * they decide "in range" identically. That lockstep is what makes the Pass A0 memory
 * optimization behavior-preserving: a docket is retained in Pass A iff some cluster
 * Pass B would actually keep points at it. `dateFiled` is the already-normalized
 * value from {@link safeDate} (an ISO date string, or null).
 */
export function bulkClusterWithinYearRange(
  dateFiled: string | null,
  minYear: number,
  maxYear: number,
): boolean {
  if (!dateFiled) return true;
  const year = Number(dateFiled.slice(0, 4));
  if (!Number.isFinite(year)) return true;
  return year >= minYear && year <= maxYear;
}

/**
 * Lower-bound-only convenience retained for existing callers/tests: equivalent to
 * {@link bulkClusterWithinYearRange} with no upper bound.
 */
export function bulkClusterWithinMinYear(dateFiled: string | null, minYear: number): boolean {
  return bulkClusterWithinYearRange(dateFiled, minYear, Number.MAX_SAFE_INTEGER);
}

/**
 * Generic CourtListener bulk-opinion loader. The docket filter is the provided
 * `options.courtCodes` set and `options.lane` labels the object keys and
 * response_metadata; the appellate and federal loaders are thin wrappers that
 * supply the code set + lane. Streams dockets -> clusters -> citations -> opinions,
 * never landing a bulk file on disk, and routes opinion artifacts through the
 * injected (Spaces-aware) artifact store.
 */
export async function ingestCourtListenerBulkOpinions(
  sql: Sql,
  artifactStore: ArtifactStore,
  options: BulkOpinionOptions,
): Promise<BulkOpinionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.snapshotDate)) {
    throw new Error("Bulk snapshot date must be YYYY-MM-DD");
  }
  const snapshotDate = options.snapshotDate;
  const minYear = options.minYear ?? 1900;
  const maxYear = options.maxYear ?? Number.MAX_SAFE_INTEGER;
  const limit = options.limit;
  const lane = options.lane;
  const courtCodes = options.courtCodes;
  const clusterIds = options.clusterIds;
  const keepCourt = clusterIds && options.courtFilter ? options.courtFilter : (code: string) => courtCodes.has(code);
  const keepCluster = (id: string) => !clusterIds || clusterIds.has(id);
  const urls = bulkFileUrls(options.baseUrl ?? DEFAULT_BULK_BASE_URL, snapshotDate);

  const [provider] = await sql<{ id: string }[]>`
    SELECT id FROM provider WHERE code = 'courtlistener'
  `;
  if (!provider) throw new Error("CourtListener provider seed is missing");
  const providerId = provider.id;

  const docketObjectKey = `courtlistener/bulk/${lane}/${snapshotDate}/dockets.csv.bz2`;
  const clusterObjectKey = `courtlistener/bulk/${lane}/${snapshotDate}/opinion-clusters.csv.bz2`;

  // Persist the court + legal_case for a matched docket (idempotent), memoising the
  // ids on the docket so a docket with many clusters is written only once.
  const ensureCase = async (docketId: string, docket: DocketRef): Promise<void> => {
    if (docket.caseInternalId && docket.courtId) return;

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
          ${tx.json({ source: "courtlistener_bulk", snapshotDate, lane })}
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
      if (!court) throw new Error("Bulk court was not persisted");

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
        if (!updated) throw new Error("Bulk case was not updated");
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
        if (!created) throw new Error("Bulk case was not persisted");
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
            lane,
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
  };

  // Persist one opinion_cluster from its full parsed row, writing the whole row to
  // provider_metadata so nothing the bulk export carries is lost. Citations start
  // empty here and are filled in by Pass B2.
  const persistCluster = async (
    clusterId: string,
    row: CourtListenerBulkOpinionCluster,
    facts: ClusterFacts,
    caseInternalId: string,
  ): Promise<string> => {
    const contentHash = bulkContentHash(
      `cluster|${clusterId}|${facts.docketId}|${facts.caseName}|${facts.dateFiled ?? ""}`,
    );
    return sql.begin(async (tx) => {
      const [artifact] = await tx<{ id: string }[]>`
        INSERT INTO raw_artifact (
          provider_id, source_uri, source_record_id, content_hash, object_key,
          media_type, retrieved_at, response_metadata
        ) VALUES (
          ${providerId}, ${bulkClusterSourceUri(snapshotDate, clusterId)}, ${clusterId},
          ${contentHash}, ${clusterObjectKey}, 'text/csv', ${snapshotDate},
          ${tx.json({ source: "courtlistener_bulk", snapshotDate, lane })}
        )
        ON CONFLICT (provider_id, source_uri, content_hash)
        DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
        RETURNING id
      `;
      if (!artifact) throw new Error("Bulk opinion-cluster artifact was not persisted");

      const [persisted] = await tx<{ id: string }[]>`
        INSERT INTO opinion_cluster (
          public_id, case_id, provider_id, provider_cluster_id, case_name,
          date_filed, precedential_status, citation_count, citations, judges,
          syllabus, procedural_history, source_artifact_id, source_updated_at,
          provider_metadata
        ) VALUES (
          ${createPublicId("cluster")}, ${caseInternalId}, ${providerId},
          ${clusterId}, ${facts.caseName}, ${facts.dateFiled},
          ${facts.precedentialStatus}, ${facts.citationCount}, ${tx.json([])},
          ${facts.judges}, ${facts.syllabus}, ${facts.proceduralHistory},
          ${artifact.id}, ${snapshotDate},
          ${tx.json(row as unknown as postgres.JSONValue)}
        )
        ON CONFLICT (provider_id, provider_cluster_id)
        DO UPDATE SET
          case_id = EXCLUDED.case_id, case_name = EXCLUDED.case_name,
          date_filed = EXCLUDED.date_filed,
          precedential_status = EXCLUDED.precedential_status,
          citation_count = EXCLUDED.citation_count,
          judges = EXCLUDED.judges, syllabus = EXCLUDED.syllabus,
          procedural_history = EXCLUDED.procedural_history,
          source_artifact_id = EXCLUDED.source_artifact_id,
          source_updated_at = EXCLUDED.source_updated_at,
          provider_metadata = EXCLUDED.provider_metadata, updated_at = now()
        RETURNING id
      `;
      if (!persisted) throw new Error("Bulk opinion cluster was not persisted");
      return persisted.id;
    });
  };

  // Write ONLY the document graph for one opinion; the case and cluster were
  // persisted eagerly in Pass B. Delegates to the shared writer so Pass C and the
  // resumable chunked importer persist opinions through identical upserts.
  const writeOpinion = (
    opinion: CourtListenerBulkOpinion,
    join: ClusterJoin,
    extracted: ReturnType<typeof bulkOpinionPlainText>,
  ): Promise<void> =>
    writeBulkOpinionGraph(
      sql,
      artifactStore,
      { providerId, snapshotDate, lane },
      opinion,
      join,
      extracted,
    );

  // Pass A0: record the ids of dockets that are actually referenced by a cluster we
  // would keep, applying the SAME in-range rule Pass B uses below. A docket matters
  // only if some kept cluster points at it, so this lets Pass A retain just those
  // dockets instead of every docket for the selected courts. That difference is the
  // whole ballgame for the federal lane: the dockets bulk file holds millions of
  // opinion-less PACER district dockets, and loading them all would blow the Node
  // heap (and could OOM the box's postgres). The id set is bounded by the opinion
  // corpus we are ingesting -- far smaller than the full docket space -- and is
  // freed as soon as Pass A finishes. (The appellate lane keeps only 13 courts, so
  // this is a no-op win there; output is identical either way.)
  const referencedDocketIds = new Set<string>();
  for await (const row of readBulkOpinionClusters(openBulkCsvFromUrl(urls.clusters))) {
    if (!keepCluster(row.id)) continue;
    if (!bulkClusterWithinYearRange(safeDate(row.date_filed), minYear, maxYear)) continue;
    referencedDocketIds.add(row.docket_id);
  }

  // Pass A: keep only dockets whose court is in the selected code set AND that an
  // in-range cluster actually references (see Pass A0).
  const dockets = new Map<string, DocketRef>();
  {
    const source = openBulkCsvFromUrl(urls.dockets);
    try {
      for await (const row of parseBulkCsv(source.stream, courtListenerBulkDocketSchema)) {
        if (!keepCourt(row.court_id)) continue;
        if (!referencedDocketIds.has(row.id)) continue;
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
  // The referenced-id set is no longer needed; release it before the heavier passes.
  referencedDocketIds.clear();

  // Pass B: eager-persist every matched cluster (and its case) and retain only the
  // minimal join facts. The full parsed row lands in provider_metadata at write
  // time and is then discarded -- nothing large is held across the pass.
  const clusters = new Map<string, ClusterJoin>();
  for await (const row of readBulkOpinionClusters(openBulkCsvFromUrl(urls.clusters))) {
    if (!keepCluster(row.id)) continue;
    const docket = dockets.get(row.docket_id);
    if (!docket) continue;
    if (!bulkClusterWithinYearRange(safeDate(row.date_filed), minYear, maxYear)) continue;

    const facts = clusterFacts(row, docket);
    await ensureCase(facts.docketId, docket);
    const caseInternalId = docket.caseInternalId;
    const courtId = docket.courtId;
    if (!caseInternalId || !courtId) throw new Error("Case ids were not resolved");

    const clusterInternalId = await persistCluster(row.id, row, facts, caseInternalId);
    clusters.set(row.id, {
      clusterInternalId,
      caseInternalId,
      courtId,
      courtCode: docket.courtCode,
      caseName: facts.caseName,
      dateFiled: facts.dateFiled,
      precedentialStatus: facts.precedentialStatus,
      citationCount: facts.citationCount,
    });
    // `limit` bounds the number of clusters persisted (and therefore the whole
    // run's write load), so a validation pass writes only a small, safe subset
    // instead of the full corpus. Left unset for the real backfill.
    if (limit && clusters.size >= limit) break;
  }

  // Pass B2: collect the reporter citations for matched clusters (few per cluster,
  // so this map is tiny) and flush them onto the already-persisted rows.
  const citationsByCluster = new Map<string, ClusterCitation[]>();
  for await (const citation of readBulkCitations(openBulkCsvFromUrl(urls.citations))) {
    if (!clusters.has(citation.cluster_id)) continue;
    const list = citationsByCluster.get(citation.cluster_id) ?? [];
    list.push({
      volume: citation.volume,
      reporter: citation.reporter,
      page: citation.page,
      type: citation.type,
    });
    citationsByCluster.set(citation.cluster_id, list);
  }
  for (const [clusterId, list] of citationsByCluster) {
    const join = clusters.get(clusterId);
    if (!join) continue;
    await sql`
      UPDATE opinion_cluster
      SET citations = ${sql.json(list as unknown as postgres.JSONValue)}, updated_at = now()
      WHERE id = ${join.clusterInternalId}
    `;
  }
  const docketCount = dockets.size;
  // Cases and courts are all persisted; free the docket map before Pass C.
  dockets.clear();

  // Pass C: stream opinions and write the document graph for matched clusters.
  let opinionsWritten = 0;
  let opinionsSkipped = 0;
  const source = openBulkCsvFromUrl(urls.opinions);
  let stop = false;
  try {
    for await (const opinion of readBulkOpinions(source)) {
      const join = clusters.get(opinion.cluster_id);
      if (!join) continue;
      const extracted = bulkOpinionPlainText(opinion);
      if (!extracted.text.trim()) {
        opinionsSkipped += 1;
        continue;
      }
      await writeOpinion(opinion, join, extracted);
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
    dockets: docketCount,
    clusters: clusters.size,
    opinionsWritten,
    opinionsSkipped,
  };
}

/**
 * Appellate lane: the original 13-circuit loader, now a thin wrapper over the
 * generic core that supplies the COA (courts-of-appeals) code set and the
 * "appellate" lane label. Behaviour is unchanged.
 */
export async function ingestCourtListenerBulkAppellateOpinions(
  sql: Sql,
  artifactStore: ArtifactStore,
  options: BulkAppellateOpinionOptions,
): Promise<BulkAppellateOpinionResult> {
  return ingestCourtListenerBulkOpinions(sql, artifactStore, {
    ...options,
    courtCodes: COA_COURT_CODES,
    lane: "appellate",
  });
}
