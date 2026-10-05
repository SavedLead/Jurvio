import type postgres from "postgres";
import type { CourtListenerBulkCitation } from "../../providers/courtlistener/bulk-opinions";
import { cleanText } from "./bulk-values";
import type { BatchOutcome } from "./stage-runner";

type Sql = ReturnType<typeof postgres>;

export interface CitationBatchRow {
  citation_id: string;
  cluster_id: string;
  volume: string;
  reporter: string;
  page: string;
  citation_type: string;
}

export function citationBatchRow(row: CourtListenerBulkCitation): CitationBatchRow {
  return {
    citation_id: row.id,
    cluster_id: row.cluster_id,
    volume: cleanText(row.volume),
    reporter: cleanText(row.reporter),
    page: cleanText(row.page),
    citation_type: cleanText(row.type),
  };
}

/** Stage reporter citations for loaded clusters; applied once the file is read. */
export async function stageCitationBatch(
  tx: postgres.TransactionSql,
  snapshotDate: string,
  rows: readonly CitationBatchRow[],
): Promise<BatchOutcome> {
  const staged = await tx`
    INSERT INTO cl_bulk_citation_stage (
      snapshot_date, citation_id, cluster_id, volume, reporter, page, citation_type
    )
    SELECT ${snapshotDate}::date, citation_id, cluster_id, volume, reporter, page, citation_type
    FROM jsonb_to_recordset(${tx.json(rows as unknown as postgres.JSONValue)}) AS r(
      citation_id bigint, cluster_id bigint, volume text, reporter text, page text,
      citation_type text
    )
    ON CONFLICT (snapshot_date, citation_id) DO UPDATE SET
      cluster_id = EXCLUDED.cluster_id, volume = EXCLUDED.volume,
      reporter = EXCLUDED.reporter, page = EXCLUDED.page,
      citation_type = EXCLUDED.citation_type
  `;
  return { matched: rows.length, written: staged.count };
}

/**
 * Fold staged citations onto opinion_cluster.citations, a chunk of clusters per
 * transaction, ordered by cluster id so the chunk cursor is resumable. A cluster's
 * citations are replaced only when bulk owns the cluster or it has none yet, and
 * only when they changed (each change re-queues the citation graph for its case).
 */
export async function applyStagedCitations(
  sql: Sql,
  input: {
    providerId: string;
    snapshotDate: string;
    afterClusterId: number;
    chunkClusters: number;
    onChunk: (tx: postgres.TransactionSql, lastClusterId: number, updated: number) => Promise<void>;
  },
): Promise<{ lastClusterId: number; updated: number; done: boolean }> {
  return sql.begin(async (tx) => {
    const [result] = await tx<{ last_cluster_id: string | null; updated: number }[]>`
      WITH chunk AS (
        SELECT DISTINCT cluster_id
        FROM cl_bulk_citation_stage
        WHERE snapshot_date = ${input.snapshotDate} AND cluster_id > ${input.afterClusterId}
        ORDER BY cluster_id
        LIMIT ${input.chunkClusters}
      ), aggregated AS (
        SELECT staged.cluster_id,
          jsonb_agg(jsonb_build_object(
            'volume', staged.volume, 'reporter', staged.reporter,
            'page', staged.page, 'type', staged.citation_type
          ) ORDER BY staged.citation_id) AS citations
        FROM cl_bulk_citation_stage staged
        JOIN chunk USING (cluster_id)
        WHERE staged.snapshot_date = ${input.snapshotDate}
        GROUP BY staged.cluster_id
      ), updated AS (
        UPDATE opinion_cluster SET citations = aggregated.citations, updated_at = now()
        FROM aggregated
        WHERE opinion_cluster.provider_id = ${input.providerId}
          AND opinion_cluster.provider_cluster_id = aggregated.cluster_id::text
          AND opinion_cluster.citations IS DISTINCT FROM aggregated.citations
          AND (
            opinion_cluster.citations = '[]'::jsonb
            OR EXISTS (
              SELECT 1 FROM raw_artifact
              WHERE raw_artifact.id = opinion_cluster.source_artifact_id
                AND coalesce(raw_artifact.response_metadata->>'source', '') = 'courtlistener_bulk'
            )
          )
        RETURNING 1
      )
      SELECT (SELECT max(cluster_id) FROM chunk)::text AS last_cluster_id,
        (SELECT count(*) FROM updated)::int AS updated
    `;
    const last = result?.last_cluster_id;
    if (last === null || last === undefined) {
      return { lastClusterId: input.afterClusterId, updated: 0, done: true };
    }
    const lastClusterId = Number(last);
    await input.onChunk(tx, lastClusterId, result?.updated ?? 0);
    return { lastClusterId, updated: result?.updated ?? 0, done: false };
  });
}
