import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import type { CourtListenerBulkOpinionCluster } from "../../providers/courtlistener/bulk-opinions";
import { bulkDate, bulkTimestamp, cleanOptionalText, cleanRecord, cleanText } from "./bulk-values";
import type { BatchOutcome } from "./stage-runner";

export interface ClusterBatchRow {
  cluster_id: string;
  docket_id: string;
  public_id: string;
  case_name: string;
  date_filed: string | null;
  precedential_status: string | null;
  citation_count: number;
  judges: string | null;
  syllabus: string | null;
  procedural_history: string | null;
  source_updated_at: string | null;
  provider_metadata: Record<string, unknown>;
}

export function clusterBatchRow(row: CourtListenerBulkOpinionCluster): ClusterBatchRow {
  const citationCount = Number.parseInt(row.citation_count, 10);
  return {
    cluster_id: row.id,
    docket_id: row.docket_id,
    public_id: createPublicId("cluster"),
    case_name: cleanText(row.case_name_full || row.case_name || row.case_name_short || "").trim(),
    date_filed: bulkDate(row.date_filed),
    precedential_status: cleanOptionalText(row.precedential_status),
    citation_count: Number.isInteger(citationCount) && citationCount > 0 ? citationCount : 0,
    judges: cleanOptionalText(row.judges),
    syllabus: cleanOptionalText(row.syllabus),
    procedural_history: cleanOptionalText(row.procedural_history),
    source_updated_at: bulkTimestamp(row.date_modified),
    provider_metadata: cleanRecord(row as Record<string, unknown>),
  };
}

export function clusterRowBytes(row: ClusterBatchRow): number {
  return (row.syllabus?.length ?? 0) + (row.procedural_history?.length ?? 0) + 2_000;
}

/**
 * Merge one batch of opinion clusters. A cluster attaches to the case its docket
 * resolved to in the dockets stage (via case_identifier); clusters for dockets
 * outside the loaded scope drop out of the join. Citations start empty and are
 * folded in by the citations stage.
 *
 * Bulk refreshes only clusters bulk wrote: one first loaded from the live API
 * keeps that richer, API-sourced record rather than being overwritten by
 * snapshot data.
 */
export async function mergeClusterBatch(
  tx: postgres.TransactionSql,
  context: { providerId: string; artifactId: string },
  rows: readonly ClusterBatchRow[],
): Promise<BatchOutcome & { inserted: number }> {
  const unique = [...new Map(rows.map((row) => [row.cluster_id, row])).values()];
  await tx`
    CREATE TEMP TABLE IF NOT EXISTS bulk_cluster_batch (
      cluster_id text PRIMARY KEY,
      docket_id text NOT NULL,
      public_id text NOT NULL,
      case_name text NOT NULL,
      date_filed date,
      precedential_status text,
      citation_count integer NOT NULL,
      judges text,
      syllabus text,
      procedural_history text,
      source_updated_at timestamptz,
      provider_metadata jsonb NOT NULL,
      case_id uuid
    ) ON COMMIT DELETE ROWS
  `;
  await tx`
    INSERT INTO bulk_cluster_batch (
      cluster_id, docket_id, public_id, case_name, date_filed, precedential_status,
      citation_count, judges, syllabus, procedural_history, source_updated_at,
      provider_metadata
    )
    SELECT cluster_id, docket_id, public_id, case_name, date_filed, precedential_status,
      citation_count, judges, syllabus, procedural_history, source_updated_at,
      provider_metadata
    FROM jsonb_to_recordset(${tx.json(unique as unknown as postgres.JSONValue)}) AS r(
      cluster_id text, docket_id text, public_id text, case_name text, date_filed date,
      precedential_status text, citation_count integer, judges text, syllabus text,
      procedural_history text, source_updated_at timestamptz, provider_metadata jsonb
    )
  `;
  await tx`
    UPDATE bulk_cluster_batch b SET case_id = identifier.case_id
    FROM case_identifier identifier
    WHERE identifier.provider_id = ${context.providerId}
      AND identifier.identifier_type = 'courtlistener_docket_id'
      AND identifier.identifier_value = b.docket_id
  `;
  await tx`DELETE FROM bulk_cluster_batch WHERE case_id IS NULL`;
  await tx`
    UPDATE bulk_cluster_batch b SET case_name = legal_case.caption
    FROM legal_case
    WHERE b.case_name = '' AND legal_case.id = b.case_id
  `;
  const upserted = await tx<{ created: boolean }[]>`
    INSERT INTO opinion_cluster (
      public_id, case_id, provider_id, provider_cluster_id, case_name, date_filed,
      precedential_status, citation_count, citations, judges, syllabus,
      procedural_history, source_artifact_id, source_updated_at, provider_metadata
    )
    SELECT public_id, case_id, ${context.providerId}, cluster_id, case_name, date_filed,
      precedential_status, citation_count, '[]'::jsonb, judges, syllabus,
      procedural_history, ${context.artifactId}::uuid, source_updated_at, provider_metadata
    FROM bulk_cluster_batch
    ON CONFLICT (provider_id, provider_cluster_id)
    DO UPDATE SET
      case_id = EXCLUDED.case_id,
      case_name = EXCLUDED.case_name,
      date_filed = EXCLUDED.date_filed,
      precedential_status = EXCLUDED.precedential_status,
      citation_count = EXCLUDED.citation_count,
      judges = EXCLUDED.judges,
      syllabus = EXCLUDED.syllabus,
      procedural_history = EXCLUDED.procedural_history,
      source_artifact_id = EXCLUDED.source_artifact_id,
      source_updated_at = EXCLUDED.source_updated_at,
      provider_metadata = EXCLUDED.provider_metadata,
      updated_at = now()
    WHERE EXISTS (
        SELECT 1 FROM raw_artifact
        WHERE raw_artifact.id = opinion_cluster.source_artifact_id
          AND coalesce(raw_artifact.response_metadata->>'source', '') = 'courtlistener_bulk'
      )
      AND (
        opinion_cluster.case_id, opinion_cluster.case_name, opinion_cluster.date_filed,
        opinion_cluster.precedential_status, opinion_cluster.citation_count,
        opinion_cluster.judges, opinion_cluster.syllabus,
        opinion_cluster.procedural_history, opinion_cluster.source_artifact_id,
        opinion_cluster.provider_metadata
      ) IS DISTINCT FROM (
        EXCLUDED.case_id, EXCLUDED.case_name, EXCLUDED.date_filed,
        EXCLUDED.precedential_status, EXCLUDED.citation_count, EXCLUDED.judges,
        EXCLUDED.syllabus, EXCLUDED.procedural_history, EXCLUDED.source_artifact_id,
        EXCLUDED.provider_metadata
      )
    RETURNING (xmax = 0) AS created
  `;
  // A docket with no case name of its own takes the cluster's.
  await tx`
    UPDATE legal_case SET caption = b.case_name, updated_at = now()
    FROM (
      SELECT DISTINCT ON (case_id) case_id, case_name
      FROM bulk_cluster_batch
      WHERE case_name <> ''
      ORDER BY case_id, length(case_name) DESC
    ) b
    WHERE legal_case.id = b.case_id AND legal_case.caption = ''
  `;
  const [summary] = await tx<{ matched: number }[]>`
    SELECT count(*)::int AS matched FROM bulk_cluster_batch
  `;
  return {
    matched: summary?.matched ?? 0,
    written: upserted.length,
    inserted: upserted.filter((row) => row.created).length,
  };
}
