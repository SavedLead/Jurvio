import { createHash } from "node:crypto";
import type postgres from "postgres";
import type { BulkCsvSource } from "@/modules/ingestion/providers/courtlistener/bulk";
import { readBulkCitations } from "@/modules/ingestion/providers/courtlistener/bulk-opinions";
import { citationKey } from "../domain/citations";

type Sql = ReturnType<typeof postgres>;

export interface BulkCitationResolutionOptions {
  /** CourtListener bulk snapshot date, YYYY-MM-DD. */
  snapshotDate: string;
  /** Public URL of citations-<snapshot>.csv.bz2, recorded as provenance. */
  sourceUri: string;
  /** Opens the citations CSV stream (URL in production, fixture in tests). */
  openCitations: () => BulkCsvSource;
  /** Days before API discovery retries a citation absent from the snapshot. */
  absentRetryDays?: number;
}

export interface BulkCitationResolutionResult {
  missing: number;
  scannedRows: number;
  linkedLocal: number;
  resolved: number;
  ambiguous: number;
  notInSnapshot: number;
}

/** States the resolver may (re)consider. 'held' is a deliberate human/policy hold. */
const RESOLVABLE_STATES = ["pending", "not_found", "ambiguous", "resolved"] as const;
const BATCH = 2000;

function chunks<T>(items: readonly T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Builds the reporter key exactly as the text parser does, or null for junk rows. */
export function bulkCitationKey(row: { volume: string; reporter: string; page: string }): string | null {
  const volume = row.volume.trim(), reporter = row.reporter.trim(), page = row.page.trim();
  if (!/^[1-9]\d{0,3}$/.test(volume) || !/^[1-9]\d{0,9}$/.test(page) || !reporter) return null;
  return citationKey(`${volume} ${reporter} ${page}`);
}

/**
 * Resolve missing citations against CourtListener's bulk citation map with zero
 * API calls. Only reporter citations are considered (cluster-link keys already
 * carry their cluster). Never publishes and never merges cases: a citation that
 * maps to more than one source cluster, or to a cluster held by more than one
 * local case, is marked ambiguous rather than guessed.
 */
export async function resolveMissingCitationsFromBulk(
  sql: Sql,
  options: BulkCitationResolutionOptions,
): Promise<BulkCitationResolutionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.snapshotDate)) throw new Error("Bulk snapshot date must be YYYY-MM-DD");
  const absentRetryDays = options.absentRetryDays ?? 3;

  const missingRows = await sql<{ citation_key: string }[]>`
    SELECT m.citation_key FROM missing_case_citation m
    WHERE m.state IN ${sql(RESOLVABLE_STATES)} AND m.citation_key NOT LIKE 'cl-cluster:%'
      AND NOT EXISTS(SELECT 1 FROM case_citation_identity i WHERE i.citation_key=m.citation_key)
  `;
  const result: BulkCitationResolutionResult = {
    missing: missingRows.length, scannedRows: 0, linkedLocal: 0, resolved: 0, ambiguous: 0, notInSnapshot: 0,
  };
  if (!missingRows.length) return result;

  // key -> source cluster ids. Memory is bounded by the missing set, not the map.
  const matches = new Map<string, Set<string>>(missingRows.map(row => [row.citation_key, new Set<string>()]));
  for await (const row of readBulkCitations(options.openCitations())) {
    result.scannedRows++;
    const key = bulkCitationKey(row);
    if (key) matches.get(key)?.add(row.cluster_id);
  }

  const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code='courtlistener'`;
  if (!provider) throw new Error("CourtListener provider seed is missing");
  const contentHash = createHash("sha256").update(`courtlistener-bulk-citations|${options.snapshotDate}`).digest("hex");
  const [artifact] = await sql<{ id: string }[]>`
    INSERT INTO raw_artifact(provider_id,source_uri,source_record_id,content_hash,object_key,media_type,retrieved_at,response_metadata)
    VALUES(${provider.id},${options.sourceUri},${`citations-${options.snapshotDate}`},${contentHash},
      ${`courtlistener/bulk/citations/${options.snapshotDate}/citations.csv.bz2`},'text/csv',${options.snapshotDate},
      ${sql.json({ source: "courtlistener_bulk", snapshotDate: options.snapshotDate, lane: "citation-resolution" })})
    ON CONFLICT(provider_id,source_uri,content_hash) DO UPDATE SET retrieved_at=EXCLUDED.retrieved_at RETURNING id
  `;
  if (!artifact) throw new Error("Bulk citation map provenance was not persisted");

  const single: Array<{ key: string; cluster: string }> = [];
  const multiCluster: string[] = [];
  const absent: string[] = [];
  for (const [key, clusters] of matches) {
    if (clusters.size === 1) single.push({ key, cluster: [...clusters][0]! });
    else if (clusters.size > 1) multiCluster.push(key);
    else absent.push(key);
  }

  // Which matched clusters are already held locally, and by how many cases.
  const localCases = new Map<string, string[]>();
  for (const batch of chunks([...new Set(single.map(item => item.cluster))])) {
    const rows = await sql<{ cluster: string; case_ids: string[] }[]>`
      SELECT cl.provider_cluster_id AS cluster, array_agg(DISTINCT cl.case_id) AS case_ids
      FROM opinion_cluster cl WHERE cl.provider_id=${provider.id} AND cl.provider_cluster_id IN ${sql(batch)}
      GROUP BY cl.provider_cluster_id
    `;
    for (const row of rows) localCases.set(row.cluster, row.case_ids);
  }

  const local: Array<{ key: string; cluster: string; case_id: string }> = [];
  const resolved: Array<{ key: string; cluster: string }> = [];
  const localCollision: string[] = [];
  for (const item of single) {
    const cases = localCases.get(item.cluster);
    if (!cases) resolved.push(item);
    else if (cases.length === 1) local.push({ ...item, case_id: cases[0]! });
    else localCollision.push(item.key);
  }

  const snapshot = options.snapshotDate;
  for (const batch of chunks(local)) {
    await sql.begin(async tx => {
      const rows = tx.json(batch);
      // Same outcome as a source-verified API lookup: a durable alias, then a
      // prioritized identity refresh so the link appears on the next cycle.
      await tx`
        INSERT INTO case_citation_verified_alias(case_id,citation_key,citation_label,source_artifact_id)
        SELECT r.case_id::uuid, r.key, m.citation_label, ${artifact.id}
        FROM jsonb_to_recordset(${rows}) AS r(key text, cluster text, case_id text)
        JOIN missing_case_citation m ON m.citation_key=r.key
        ON CONFLICT(case_id,citation_key) DO UPDATE SET citation_label=EXCLUDED.citation_label,
          source_artifact_id=EXCLUDED.source_artifact_id, verified_at=now()
      `;
      await tx`
        INSERT INTO case_citation_work(case_id,queued_at)
        SELECT DISTINCT r.case_id::uuid, 'epoch'::timestamptz FROM jsonb_to_recordset(${rows}) AS r(key text, cluster text, case_id text)
        ON CONFLICT(case_id) DO UPDATE SET queued_at='epoch'::timestamptz
      `;
      await tx`
        UPDATE missing_case_citation m SET state='pending', resolved_cluster_id=r.cluster::bigint, resolved_snapshot=${snapshot},
          source_artifact_id=${artifact.id}, next_attempt_at=now()+interval '2 minutes',
          detail='Matched a locally held case through the CourtListener bulk citation map; link refresh prioritized', updated_at=now()
        FROM jsonb_to_recordset(${rows}) AS r(key text, cluster text, case_id text) WHERE m.citation_key=r.key
      `;
    });
    result.linkedLocal += batch.length;
  }

  for (const batch of chunks(resolved)) {
    await sql`
      UPDATE missing_case_citation m SET state='resolved', resolved_cluster_id=r.cluster::bigint, resolved_snapshot=${snapshot},
        source_artifact_id=${artifact.id}, next_attempt_at=now(),
        detail='Exact source cluster found in the CourtListener bulk citation map; awaiting ingestion', updated_at=now()
      FROM jsonb_to_recordset(${sql.json(batch)}) AS r(key text, cluster text) WHERE m.citation_key=r.key
    `;
    result.resolved += batch.length;
  }

  const ambiguous = [
    ...multiCluster.map(key => ({ key, detail: "Citation maps to more than one source cluster in the CourtListener bulk citation map; not guessed" })),
    ...localCollision.map(key => ({ key, detail: "Exact source cluster belongs to multiple local cases; not merged or published" })),
  ];
  for (const batch of chunks(ambiguous)) {
    await sql`
      UPDATE missing_case_citation m SET state='ambiguous', resolved_cluster_id=NULL, resolved_snapshot=${snapshot},
        source_artifact_id=${artifact.id}, next_attempt_at=now()+interval '7 days', detail=r.detail, updated_at=now()
      FROM jsonb_to_recordset(${sql.json(batch)}) AS r(key text, detail text) WHERE m.citation_key=r.key
    `;
    result.ambiguous += batch.length;
  }

  // Absent from the snapshot: possibly newer than it, so API discovery still
  // gets a turn, just later. 'resolved' rows stay as they were.
  for (const batch of chunks(absent)) {
    const updated = await sql`
      UPDATE missing_case_citation m SET state='not_found', resolved_snapshot=${snapshot},
        next_attempt_at=GREATEST(m.next_attempt_at, now()+make_interval(days=>${absentRetryDays})),
        detail=${`Not in CourtListener bulk citation map ${snapshot}`}, updated_at=now()
      WHERE m.citation_key IN ${sql(batch)} AND m.state IN ('pending','not_found')
    `;
    result.notInSnapshot += updated.count;
  }
  return result;
}

/** Cluster ids the bulk importer should ingest for cited-but-missing cases. */
export async function resolvedClusterIds(sql: Sql, limit: number): Promise<string[]> {
  const rows = await sql<{ cluster: string }[]>`
    SELECT DISTINCT resolved_cluster_id::text AS cluster FROM missing_case_citation
    WHERE state='resolved' AND resolved_cluster_id IS NOT NULL
    ORDER BY 1 LIMIT ${limit}
  `;
  return rows.map(row => row.cluster);
}

/** After a bulk import: resolved citations whose cluster is now local move on. */
export async function markIngestedResolvedCitations(sql: Sql): Promise<number> {
  const updated = await sql`
    UPDATE missing_case_citation m SET state='ingested',
      detail='Source cluster ingested from CourtListener bulk data; existing publication review applies', updated_at=now()
    WHERE m.state='resolved' AND EXISTS(
      SELECT 1 FROM opinion_cluster cl JOIN provider p ON p.id=cl.provider_id
      WHERE p.code='courtlistener' AND cl.provider_cluster_id=m.resolved_cluster_id::text)
  `;
  return updated.count;
}
