import type postgres from "postgres";
import {
  bulkOpinionPlainText,
  type CourtListenerBulkOpinion,
} from "../providers/courtlistener/bulk-opinions";
import type { ArtifactStore } from "./artifact-store";
import {
  writeBulkOpinionGraph,
  type BulkOpinionJoin,
  type BulkOpinionWriteContext,
} from "./write-bulk-opinion-graph";

type Sql = ReturnType<typeof postgres>;

export interface FederalOpinionChunkResult {
  opinionsWritten: number;
  opinionsSkippedEmpty: number;
  opinionsUnmatched: number;
}

export interface ImportFederalOpinionChunkOptions {
  snapshotDate: string;
  /** Lane label stored on artifacts/metadata. Matches the loader's federal lane. */
  lane?: string;
  onProgress?: (progress: FederalOpinionChunkResult) => void;
  progressInterval?: number;
}

/**
 * Import the opinions in ONE already-extracted chunk, resumably and idempotently.
 *
 * The chunked federal pipeline runs the loader's docket/cluster passes FIRST, so every
 * federal case + cluster already exists in the DB. This importer therefore does NOT
 * hold any in-memory docket/cluster map (the Pass A0 memory protection is moot here --
 * footprint is a single row at a time): for each opinion it looks the cluster up by its
 * provider cluster id. Opinions whose cluster is absent are non-federal (or not yet
 * ingested) and are skipped. Matches are written through {@link writeBulkOpinionGraph},
 * the exact same upsert path Pass C uses -- so dedup is identical and re-running a chunk
 * updates in place without creating duplicates.
 */
export async function importFederalOpinionChunk(
  sql: Sql,
  artifactStore: ArtifactStore,
  opinions: AsyncIterable<CourtListenerBulkOpinion> | Iterable<CourtListenerBulkOpinion>,
  options: ImportFederalOpinionChunkOptions,
): Promise<FederalOpinionChunkResult> {
  const lane = options.lane ?? "federal";
  const progressInterval = options.progressInterval ?? 2_000;

  const [provider] = await sql<{ id: string }[]>`
    SELECT id FROM provider WHERE code = 'courtlistener'
  `;
  if (!provider) throw new Error("CourtListener provider seed is missing");
  const ctx: BulkOpinionWriteContext = {
    providerId: provider.id,
    snapshotDate: options.snapshotDate,
    lane,
  };

  const result: FederalOpinionChunkResult = {
    opinionsWritten: 0,
    opinionsSkippedEmpty: 0,
    opinionsUnmatched: 0,
  };

  for await (const opinion of opinions) {
    // Resolve the already-persisted case/cluster facts for this opinion's cluster.
    // opinion_cluster(provider_id, provider_cluster_id) is uniquely indexed, so this
    // is a point lookup. Absent => the cluster is not in our federal corpus; skip.
    const [join] = await sql<BulkOpinionJoin[]>`
      SELECT
        opinion_cluster.id AS "clusterInternalId",
        opinion_cluster.case_id AS "caseInternalId",
        legal_case.court_id AS "courtId",
        coalesce(court.provider_court_id, '') AS "courtCode",
        opinion_cluster.case_name AS "caseName",
        opinion_cluster.date_filed::text AS "dateFiled",
        opinion_cluster.precedential_status AS "precedentialStatus",
        opinion_cluster.citation_count AS "citationCount"
      FROM opinion_cluster
      JOIN legal_case ON legal_case.id = opinion_cluster.case_id
      JOIN court ON court.id = legal_case.court_id
      WHERE opinion_cluster.provider_id = ${ctx.providerId}
        AND opinion_cluster.provider_cluster_id = ${opinion.cluster_id}
      LIMIT 1
    `;
    if (!join) {
      result.opinionsUnmatched += 1;
      continue;
    }

    const extracted = bulkOpinionPlainText(opinion);
    if (!extracted.text.trim()) {
      result.opinionsSkippedEmpty += 1;
      continue;
    }

    await writeBulkOpinionGraph(sql, artifactStore, ctx, opinion, join, extracted);
    result.opinionsWritten += 1;
    if (result.opinionsWritten % progressInterval === 0) options.onProgress?.({ ...result });
  }

  return result;
}
