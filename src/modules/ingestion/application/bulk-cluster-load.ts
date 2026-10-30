import { createHash } from "node:crypto";
import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { FEDERAL_PUBLICATION_RULE_VERSION, isRestrictedDocketText } from "../domain/federal-stream";
import type { CourtListenerBulkOpinionCluster } from "../providers/courtlistener/bulk-opinions";
import { csvField, isEasternQuietWindow, rowsPerHour } from "./bulk-docket-load";
import { federalOpinionCourtIds, gateBulkChunk } from "./bulk-load-gate";
import { BULK_OPINION_HOLD_REASON, isFederalOpinionCourt } from "./bulk-opinion-load";

type Sql = ReturnType<typeof postgres>;

export const BULK_CLUSTER_CHUNK_ROWS = 5_000;
export const BULK_CLUSTER_LANE = "federal-bulk-clusters";
/** Pending clusters resolved per transaction. */
export const PENDING_CLUSTER_BATCH = 5_000;
/** Long free-text columns are kept out of provider_metadata (and out of the pending table). */
export const CLUSTER_METADATA_MAX_FIELD = 512;
const CLUSTER_TEXT_MAX = 20_000;

export interface BulkClusterCheckpoint {
  version: 1;
  snapshotDate: string;
  rowsConsumed: number;
  created: number;
  alreadyPresent: number;
  pending: number;
  unmatched: number;
  nonFederal: number;
  restricted: number;
  invalid: number;
  stopped: string | null;
}

export function emptyBulkClusterCheckpoint(snapshotDate: string): BulkClusterCheckpoint {
  return {
    version: 1, snapshotDate, rowsConsumed: 0, created: 0, alreadyPresent: 0, pending: 0,
    unmatched: 0, nonFederal: 0, restricted: 0, invalid: 0, stopped: null,
  };
}

export function decodeBulkClusterCheckpoint(value: string | null, snapshotDate: string): BulkClusterCheckpoint {
  const base = emptyBulkClusterCheckpoint(snapshotDate);
  if (!value) return base;
  const parsed = JSON.parse(value) as Partial<BulkClusterCheckpoint>;
  if (parsed.version !== 1 || parsed.snapshotDate !== snapshotDate || typeof parsed.rowsConsumed !== "number") return base;
  return {
    ...base,
    rowsConsumed: parsed.rowsConsumed,
    created: parsed.created ?? 0,
    alreadyPresent: parsed.alreadyPresent ?? 0,
    pending: parsed.pending ?? 0,
    unmatched: parsed.unmatched ?? 0,
    nonFederal: parsed.nonFederal ?? 0,
    restricted: parsed.restricted ?? 0,
    invalid: parsed.invalid ?? 0,
    stopped: parsed.stopped ?? null,
  };
}

export function bulkClusterStreamName(snapshotDate: string): string {
  return `courtlistener:bulk-clusters:v1:${snapshotDate}`;
}

export function bulkClusterFileUrl(snapshotDate: string): string {
  return `https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/opinion-clusters-${snapshotDate}.csv.bz2`;
}

export interface StagedCluster {
  clusterId: string;
  docketId: string;
  caseName: string;
  dateFiled: string | null;
  precedentialStatus: string | null;
  citationCount: number;
  judges: string | null;
  syllabus: string | null;
  proceduralHistory: string | null;
  restricted: boolean;
  dateModified: string | null;
  publicId: string;
  providerMetadata: string;
}

function blankToNull(value: string | null | undefined, max = CLUSTER_TEXT_MAX): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  return value.slice(0, 10);
}

function isoTimestamp(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

/** Every short field of the row; long free text (headmatter, syllabus, ...) is listed in `_omitted`. */
export function slimClusterMetadata(row: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  const omitted: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string" && value.length > CLUSTER_METADATA_MAX_FIELD) omitted.push(key);
    else kept[key] = value;
  }
  if (omitted.length) kept._omitted = omitted.sort();
  return kept;
}

/**
 * Restricted (never attached, so no opinion text is loaded for it): CourtListener
 * blocked the cluster, or the caption reads sealed / minor / juvenile / grand jury /
 * qui tam, the same check the docket loader uses to mark cases restricted.
 */
export function isRestrictedCluster(row: CourtListenerBulkOpinionCluster): boolean {
  if (row.blocked) return true;
  return isRestrictedDocketText(`${row.case_name} ${row.case_name_short} ${row.case_name_full}`);
}

export function stageCluster(row: CourtListenerBulkOpinionCluster): StagedCluster | null {
  const caseName = (row.case_name || row.case_name_short || row.case_name_full).trim().slice(0, 2_000);
  if (!caseName) return null;
  const citationCount = Number.parseInt(row.citation_count, 10);
  return {
    clusterId: row.id,
    docketId: row.docket_id,
    caseName,
    dateFiled: isoDate(row.date_filed),
    precedentialStatus: blankToNull(row.precedential_status, 100),
    citationCount: Number.isFinite(citationCount) && citationCount > 0 ? citationCount : 0,
    judges: blankToNull(row.judges, 2_000),
    syllabus: blankToNull(row.syllabus),
    proceduralHistory: blankToNull(row.procedural_history),
    restricted: isRestrictedCluster(row),
    dateModified: isoTimestamp(row.date_modified),
    publicId: createPublicId("cluster"),
    providerMetadata: JSON.stringify(slimClusterMetadata(row as Record<string, unknown>)),
  };
}

function pgText(value: string | null): string | null {
  return value === null ? null : value.replaceAll("\u0000", "");
}

export function clusterStageCsv(rows: readonly StagedCluster[]): string {
  return rows.map((row) => [
    row.clusterId, row.docketId, row.caseName, row.dateFiled, row.precedentialStatus, String(row.citationCount),
    row.judges, row.syllabus, row.proceduralHistory, row.restricted ? "t" : "f", row.dateModified, row.publicId,
    row.providerMetadata,
  ].map((value) => csvField(pgText(value))).join(",")).join("\n") + (rows.length ? "\n" : "");
}

export interface ClusterMergeCounts {
  created: number;
  alreadyPresent: number;
  pending: number;
  unmatched: number;
  nonFederal: number;
  restricted: number;
  casesHeld: number;
}

interface MergeContext {
  providerId: string;
  artifactId: string;
  federalCourtIds: string[];
  keepUnmatched: boolean;
  snapshotDate: string;
}

/**
 * Set-based merge of one staged chunk. A cluster whose docket is a loaded federal case
 * (not restricted or suppressed) becomes an opinion_cluster on that case; the case
 * stays as it is (draft stays draft) and a draft case gets a federal_publication_hold,
 * so no publisher promotes it on cluster metadata. An existing cluster is left alone.
 * A cluster whose docket is not loaded goes to courtlistener_pending_cluster when
 * keepUnmatched (docket load unfinished); otherwise it is only counted.
 */
export async function mergeClusterStage(sql: Sql, ctx: MergeContext, rows: readonly StagedCluster[]): Promise<ClusterMergeCounts> {
  // TRUNCATE, COPY and merge share one transaction: TRUNCATE holds the stage's
  // ACCESS EXCLUSIVE lock until commit, so two loaders can never interleave on it.
  const zero = { created: 0, alreadyPresent: 0, pending: 0, unmatched: 0, nonFederal: 0, restricted: 0, casesHeld: 0 };
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('statement_timeout', '170s', true)`;
    await tx`TRUNCATE courtlistener_cluster_stage`;
    if (!rows.length) return zero;
    const copy = tx.unsafe(
      "COPY courtlistener_cluster_stage (cluster_id, docket_id, case_name, date_filed, precedential_status, citation_count, judges, syllabus, procedural_history, restricted, date_modified, public_id, provider_metadata) FROM STDIN WITH (FORMAT csv, NULL '\\N')",
    );
    const stream = await copy.writable();
    await new Promise<void>((resolve, reject) => {
      stream.on("error", reject);
      stream.on("finish", () => resolve());
      stream.end(clusterStageCsv(rows));
    });
    const existing = await tx`
      DELETE FROM courtlistener_cluster_stage stage
      USING opinion_cluster existing
      WHERE existing.provider_id = ${ctx.providerId} AND existing.provider_cluster_id = stage.cluster_id
    `;
    const [counts] = await tx<{ created: number; held: number; pending: number; unmatched: number; non_federal: number; restricted: number }[]>`
      WITH resolved AS (
        SELECT stage.*, identifier.case_id, legal_case.court_id, legal_case.publication::text AS case_publication,
          (legal_case.court_id = ANY(${ctx.federalCourtIds}::uuid[])) AS federal
        FROM courtlistener_cluster_stage stage
        LEFT JOIN case_identifier identifier
          ON identifier.provider_id = ${ctx.providerId}
         AND identifier.identifier_type = 'courtlistener_docket_id'
         AND identifier.identifier_value = stage.docket_id
        LEFT JOIN legal_case ON legal_case.id = identifier.case_id
      ), eligible AS (
        SELECT * FROM resolved
        WHERE case_id IS NOT NULL AND federal AND NOT restricted AND case_publication IN ('draft', 'published')
      ), created AS (
        INSERT INTO opinion_cluster (public_id, case_id, provider_id, provider_cluster_id, case_name, date_filed,
          precedential_status, citation_count, citations, judges, syllabus, procedural_history,
          source_artifact_id, source_updated_at, provider_metadata)
        SELECT public_id, case_id, ${ctx.providerId}, cluster_id, case_name, date_filed, precedential_status,
          citation_count, '[]'::jsonb, judges, syllabus, procedural_history, ${ctx.artifactId}, date_modified, provider_metadata
        FROM eligible
        ON CONFLICT (provider_id, provider_cluster_id) DO NOTHING
        RETURNING case_id
      ), held AS (
        INSERT INTO federal_publication_hold (case_id, reasons, rule_version)
        SELECT DISTINCT eligible.case_id, ARRAY[${BULK_OPINION_HOLD_REASON}]::text[], ${FEDERAL_PUBLICATION_RULE_VERSION}
        FROM eligible
        WHERE eligible.case_publication = 'draft' AND eligible.case_id IN (SELECT case_id FROM created)
        ON CONFLICT (case_id) DO UPDATE SET
          reasons = ARRAY(SELECT DISTINCT reason FROM unnest(federal_publication_hold.reasons || EXCLUDED.reasons) reason ORDER BY reason),
          rule_version = EXCLUDED.rule_version,
          held_at = now()
        RETURNING case_id
      ), pending AS (
        INSERT INTO courtlistener_pending_cluster (cluster_id, docket_id, snapshot_date, case_name, date_filed,
          precedential_status, citation_count, judges, restricted, date_modified, public_id, provider_metadata)
        SELECT cluster_id, docket_id, ${ctx.snapshotDate}::date, case_name, date_filed, precedential_status,
          citation_count, judges, restricted, date_modified, public_id, provider_metadata
        FROM resolved
        WHERE case_id IS NULL AND ${ctx.keepUnmatched}::boolean
        ON CONFLICT (cluster_id) DO UPDATE SET
          docket_id = EXCLUDED.docket_id, snapshot_date = GREATEST(courtlistener_pending_cluster.snapshot_date, EXCLUDED.snapshot_date),
          case_name = EXCLUDED.case_name, date_filed = EXCLUDED.date_filed,
          precedential_status = EXCLUDED.precedential_status, citation_count = EXCLUDED.citation_count,
          judges = EXCLUDED.judges, restricted = EXCLUDED.restricted, date_modified = EXCLUDED.date_modified,
          provider_metadata = EXCLUDED.provider_metadata, queued_at = now()
        RETURNING cluster_id
      )
      SELECT
        (SELECT count(*)::int FROM created) AS created,
        (SELECT count(*)::int FROM held) AS held,
        (SELECT count(*)::int FROM pending) AS pending,
        (SELECT count(*)::int FROM resolved WHERE case_id IS NULL) AS unmatched,
        (SELECT count(*)::int FROM resolved WHERE case_id IS NOT NULL AND NOT federal) AS non_federal,
        (SELECT count(*)::int FROM resolved WHERE case_id IS NOT NULL AND federal
          AND (restricted OR case_publication NOT IN ('draft', 'published'))) AS restricted
    `;
    const pending = counts?.pending ?? 0;
    return {
      created: counts?.created ?? 0,
      alreadyPresent: existing.count,
      pending,
      unmatched: (counts?.unmatched ?? 0) - pending,
      nonFederal: counts?.non_federal ?? 0,
      restricted: counts?.restricted ?? 0,
      casesHeld: counts?.held ?? 0,
    };
  });
}

export interface PendingResolution {
  resolved: number;
  created: number;
  nonFederal: number;
  restricted: number;
  pruned: number;
  remaining: number;
}

/**
 * Attach pending clusters whose docket has since been loaded, then drop pending rows
 * that can no longer resolve (the docket load for their snapshot, or a newer one, is
 * complete, so an unloaded docket is non-federal or unusable).
 */
export async function resolvePendingClusters(
  sql: Sql,
  ctx: { providerId: string; artifactId: string; federalCourtIds: string[]; docketsCompleteThrough: string | null },
): Promise<PendingResolution> {
  const result: PendingResolution = { resolved: 0, created: 0, nonFederal: 0, restricted: 0, pruned: 0, remaining: 0 };
  // One hash join finds every resolvable row; batches then keep each transaction small.
  const ready = await sql<{ cluster_id: string }[]>`
    SELECT pending.cluster_id
    FROM courtlistener_pending_cluster pending
    JOIN case_identifier identifier
      ON identifier.provider_id = ${ctx.providerId}
     AND identifier.identifier_type = 'courtlistener_docket_id'
     AND identifier.identifier_value = pending.docket_id
  `;
  const ids = ready.map((row) => row.cluster_id);
  for (let start = 0; start < ids.length; start += PENDING_CLUSTER_BATCH) {
    const batch = ids.slice(start, start + PENDING_CLUSTER_BATCH);
    const [counts] = await sql.begin(async (tx) => {
      await tx`SELECT set_config('statement_timeout', '170s', true)`;
      return tx<{ resolved: number; created: number; non_federal: number; restricted: number }[]>`
        WITH resolved AS (
          SELECT pending.*, identifier.case_id, legal_case.publication::text AS case_publication,
            (legal_case.court_id = ANY(${ctx.federalCourtIds}::uuid[])) AS federal
          FROM courtlistener_pending_cluster pending
          JOIN case_identifier identifier
            ON identifier.provider_id = ${ctx.providerId}
           AND identifier.identifier_type = 'courtlistener_docket_id'
           AND identifier.identifier_value = pending.docket_id
          JOIN legal_case ON legal_case.id = identifier.case_id
          WHERE pending.cluster_id = ANY(${batch}::text[])
        ), eligible AS (
          SELECT * FROM resolved WHERE federal AND NOT restricted AND case_publication IN ('draft', 'published')
        ), created AS (
          INSERT INTO opinion_cluster (public_id, case_id, provider_id, provider_cluster_id, case_name, date_filed,
            precedential_status, citation_count, citations, judges, source_artifact_id, source_updated_at, provider_metadata)
          SELECT public_id, case_id, ${ctx.providerId}, cluster_id, case_name, date_filed,
            precedential_status, citation_count, '[]'::jsonb, judges, ${ctx.artifactId}, date_modified, provider_metadata
          FROM eligible
          ON CONFLICT (provider_id, provider_cluster_id) DO NOTHING
          RETURNING case_id
        ), held AS (
          INSERT INTO federal_publication_hold (case_id, reasons, rule_version)
          SELECT DISTINCT eligible.case_id, ARRAY[${BULK_OPINION_HOLD_REASON}]::text[], ${FEDERAL_PUBLICATION_RULE_VERSION}
          FROM eligible
          WHERE eligible.case_publication = 'draft' AND eligible.case_id IN (SELECT case_id FROM created)
          ON CONFLICT (case_id) DO UPDATE SET
            reasons = ARRAY(SELECT DISTINCT reason FROM unnest(federal_publication_hold.reasons || EXCLUDED.reasons) reason ORDER BY reason),
            rule_version = EXCLUDED.rule_version,
            held_at = now()
          RETURNING case_id
        ), removed AS (
          DELETE FROM courtlistener_pending_cluster pending
          USING resolved
          WHERE pending.cluster_id = resolved.cluster_id
          RETURNING pending.cluster_id
        )
        SELECT
          (SELECT count(*)::int FROM removed) AS resolved,
          (SELECT count(*)::int FROM created) AS created,
          (SELECT count(*)::int FROM resolved WHERE NOT federal) AS non_federal,
          (SELECT count(*)::int FROM resolved WHERE federal AND (restricted OR case_publication NOT IN ('draft', 'published'))) AS restricted,
          (SELECT count(*)::int FROM held) AS held
      `;
    });
    result.resolved += counts?.resolved ?? 0;
    result.created += counts?.created ?? 0;
    result.nonFederal += counts?.non_federal ?? 0;
    result.restricted += counts?.restricted ?? 0;
  }
  if (ctx.docketsCompleteThrough) {
    const [newer] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM courtlistener_pending_cluster WHERE snapshot_date > ${ctx.docketsCompleteThrough}::date
    `;
    if ((newer?.n ?? 0) === 0) {
      const [all] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM courtlistener_pending_cluster`;
      result.pruned = all?.n ?? 0;
      await sql`TRUNCATE courtlistener_pending_cluster`;
    } else {
      const pruned = await sql`DELETE FROM courtlistener_pending_cluster WHERE snapshot_date <= ${ctx.docketsCompleteThrough}::date`;
      result.pruned = pruned.count;
    }
  }
  const [left] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM courtlistener_pending_cluster`;
  result.remaining = left?.n ?? 0;
  return result;
}

/** Newest docket snapshot whose bulk docket load finished (stopped=complete), or null. */
export async function docketsCompleteThrough(sql: Sql, providerId: string): Promise<string | null> {
  const [row] = await sql<{ snapshot: string | null }[]>`
    SELECT max(substring(stream_name from 'v1:(.*)$')) AS snapshot
    FROM ingestion_checkpoint
    WHERE provider_id = ${providerId}
      AND stream_name LIKE 'courtlistener:bulk-dockets:v1:%'
      AND cursor_value::jsonb->>'stopped' = 'complete'
  `;
  return row?.snapshot ?? null;
}

async function clusterArtifact(sql: Sql, providerId: string, snapshotDate: string): Promise<string> {
  const contentHash = createHash("sha256").update(`courtlistener-bulk-opinion-clusters|${snapshotDate}`).digest("hex");
  const [artifact] = await sql<{ id: string }[]>`
    INSERT INTO raw_artifact (provider_id, source_uri, source_record_id, content_hash, object_key, media_type, retrieved_at, response_metadata)
    VALUES (${providerId}, ${bulkClusterFileUrl(snapshotDate)}, ${`opinion-clusters-${snapshotDate}`}, ${contentHash},
      ${`courtlistener/bulk/opinion-clusters-${snapshotDate}.csv.bz2`}, 'text/csv', ${snapshotDate}::timestamptz,
      ${sql.json({ source: "courtlistener_bulk", snapshotDate, lane: BULK_CLUSTER_LANE, objectStored: false })})
    ON CONFLICT (provider_id, source_uri, content_hash) DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
    RETURNING id
  `;
  if (!artifact) throw new Error("Bulk cluster artifact was not persisted");
  return artifact.id;
}

export interface BulkClusterLoadOptions {
  /** Opened only when the snapshot still has rows to read. */
  openClusters: () => AsyncIterable<CourtListenerBulkOpinionCluster>;
  snapshotDate: string;
  /** Clusters to create in this run. */
  rowLimit: number;
  budgetMs: number;
  allowAnytime?: boolean;
  resetCheckpoint?: boolean;
  chunkRows?: number;
  diskPath: string;
  /** Override the automatic rule (keep unmatched rows until the docket load is complete). */
  keepUnmatched?: boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
}

export interface BulkClusterLoadResult extends BulkClusterCheckpoint {
  resumedFromRow: number;
  rowsReadThisRun: number;
  createdThisRun: number;
  casesHeld: number;
  keepUnmatched: boolean;
  docketsCompleteThrough: string | null;
  pendingResolved: PendingResolution | null;
  elapsedMs: number;
  rowsReadPerSecond: number;
  createdPerHour: number;
  freeDiskRatio: number | null;
  pauses: number;
}

export async function loadCourtListenerBulkClusters(sql: Sql, options: BulkClusterLoadOptions): Promise<BulkClusterLoadResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.snapshotDate)) throw new Error("Bulk snapshot date must be YYYY-MM-DD");
  if (!Number.isInteger(options.rowLimit) || options.rowLimit < 1) throw new Error("--row-limit must be a positive integer");
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line) => console.log(JSON.stringify(line)));
  const chunkRows = options.chunkRows ?? BULK_CLUSTER_CHUNK_ROWS;
  const started = now();
  const deadline = started + options.budgetMs;

  const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
  if (!provider) throw new Error("CourtListener provider seed is missing");
  const streamName = bulkClusterStreamName(options.snapshotDate);
  const [stored] = await sql<{ cursor_value: string }[]>`
    SELECT cursor_value FROM ingestion_checkpoint WHERE provider_id = ${provider.id} AND stream_name = ${streamName}
  `;
  let checkpoint = options.resetCheckpoint
    ? emptyBulkClusterCheckpoint(options.snapshotDate)
    : decodeBulkClusterCheckpoint(stored?.cursor_value ?? null, options.snapshotDate);
  const alreadyComplete = checkpoint.stopped === "complete";
  checkpoint = { ...checkpoint, stopped: null };
  const initial = checkpoint;
  let rowsSeen = 0;
  let pauses = 0;
  let freeRatio: number | null = null;
  let casesHeld = 0;
  let pendingResolved: PendingResolution | null = null;

  const completeThrough = await docketsCompleteThrough(sql, provider.id);
  const keepUnmatched = options.keepUnmatched ?? !(completeThrough !== null && completeThrough >= options.snapshotDate);

  const save = async (next: BulkClusterCheckpoint) => {
    checkpoint = next;
    await sql`
      INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
      VALUES (${provider.id}, ${streamName}, ${JSON.stringify(checkpoint)})
      ON CONFLICT (provider_id, stream_name) DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = now()
    `;
  };
  const finish = (): BulkClusterLoadResult => {
    const elapsedMs = now() - started;
    const rowsReadThisRun = Math.max(0, checkpoint.rowsConsumed - initial.rowsConsumed);
    const createdThisRun = checkpoint.created - initial.created;
    return {
      ...checkpoint,
      resumedFromRow: initial.rowsConsumed,
      rowsReadThisRun,
      createdThisRun,
      casesHeld,
      keepUnmatched,
      docketsCompleteThrough: completeThrough,
      pendingResolved,
      elapsedMs,
      rowsReadPerSecond: elapsedMs > 0 ? Math.round((rowsReadThisRun * 1000) / elapsedMs) : 0,
      createdPerHour: rowsPerHour(createdThisRun, elapsedMs),
      freeDiskRatio: freeRatio,
      pauses,
    };
  };

  if (!options.allowAnytime && !isEasternQuietWindow(new Date())) {
    await save({ ...checkpoint, stopped: alreadyComplete ? "complete" : "outside-quiet-window" });
    return finish();
  }

  const federalCourtIds = await federalOpinionCourtIds(sql, provider.id, isFederalOpinionCourt);
  const artifactId = await clusterArtifact(sql, provider.id, options.snapshotDate);

  // Dockets loaded since the last run attach their waiting clusters first.
  const gate = await gateBulkChunk(sql, options.diskPath, "bulkClusters", options.sleep);
  pauses += gate.pauses;
  freeRatio = gate.freeDiskRatio;
  if (gate.stop) {
    await save({ ...checkpoint, stopped: alreadyComplete ? "complete" : gate.stop });
    return finish();
  }
  pendingResolved = await resolvePendingClusters(sql, { providerId: provider.id, artifactId, federalCourtIds, docketsCompleteThrough: completeThrough });
  log({ bulkClusters: "pending", ...pendingResolved, keepUnmatched, docketsCompleteThrough: completeThrough });
  if (alreadyComplete) {
    await save({ ...checkpoint, stopped: "complete" });
    return finish();
  }

  const batch: StagedCluster[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  const flush = async (): Promise<string | null> => {
    const chunkGate = await gateBulkChunk(sql, options.diskPath, "bulkClusters", options.sleep);
    pauses += chunkGate.pauses;
    freeRatio = chunkGate.freeDiskRatio;
    if (chunkGate.stop) return chunkGate.stop;
    if (!options.allowAnytime && !isEasternQuietWindow(new Date())) return "outside-quiet-window";
    if (now() >= deadline) return "budget";
    const merged = await mergeClusterStage(sql, {
      providerId: provider.id, artifactId, federalCourtIds, keepUnmatched, snapshotDate: options.snapshotDate,
    }, batch);
    casesHeld += merged.casesHeld;
    await save({
      ...checkpoint,
      rowsConsumed: rowsSeen,
      created: checkpoint.created + merged.created,
      alreadyPresent: checkpoint.alreadyPresent + merged.alreadyPresent,
      pending: checkpoint.pending + merged.pending,
      unmatched: checkpoint.unmatched + merged.unmatched,
      nonFederal: checkpoint.nonFederal + merged.nonFederal,
      restricted: checkpoint.restricted + merged.restricted,
      invalid: checkpoint.invalid + invalid,
      stopped: null,
    });
    log({ bulkClusters: "chunk", ...checkpoint, createdThisRun: checkpoint.created - initial.created, elapsedMs: now() - started });
    batch.length = 0;
    seen.clear();
    invalid = 0;
    return null;
  };

  let stop: string | null = null;
  for await (const row of options.openClusters()) {
    if (now() >= deadline) { stop = "budget"; break; }
    rowsSeen += 1;
    if (rowsSeen <= initial.rowsConsumed) continue;
    const staged = stageCluster(row);
    if (!staged) { invalid += 1; continue; }
    if (seen.has(staged.clusterId)) continue;
    seen.add(staged.clusterId);
    batch.push(staged);
    if (batch.length >= chunkRows) {
      stop = await flush();
      if (stop) break;
      if (checkpoint.created - initial.created >= options.rowLimit) { stop = "row-limit"; break; }
    }
  }
  if (!stop && (batch.length || invalid)) {
    stop = await flush();
    if (!stop && checkpoint.created - initial.created >= options.rowLimit) stop = "row-limit";
  }
  // A stop keeps rowsConsumed at the last merged chunk, so unmerged rows are read again.
  await save({ ...checkpoint, stopped: stop ?? "complete", rowsConsumed: stop ? checkpoint.rowsConsumed : rowsSeen });
  return finish();
}
