import { createHash } from "node:crypto";
import type postgres from "postgres";
import { openBulkCsv } from "../../providers/courtlistener/bulk";
import { readFederalCourtCodes } from "../../providers/courtlistener/bulk-courts";
import {
  courtListenerBulkDocketSchema,
} from "../../providers/courtlistener/bulk-dockets";
import {
  courtListenerBulkCitationSchema,
  courtListenerBulkOpinionClusterSchema,
  courtListenerBulkOpinionSchema,
} from "../../providers/courtlistener/bulk-opinions";
import { ingestCourtListenerBulkCourts } from "../ingest-courtlistener-bulk-courts";
import { IdBitset } from "./id-bitset";
import { applyStagedCitations, citationBatchRow, stageCitationBatch } from "./merge-citations";
import { clusterBatchRow, clusterRowBytes, mergeClusterBatch } from "./merge-clusters";
import { docketBatchRow, mergeDocketBatch } from "./merge-dockets";
import { mergeOpinionBatch, opinionBatchRow, opinionRowBytes } from "./merge-opinions";
import { advanceStage, finishStage, LoadGovernor, startStage, type GovernorOptions } from "./progress";
import {
  registerSnapshotArtifact,
  resolveSnapshotFiles,
  type SnapshotFileKind,
} from "./snapshot";
import { streamStage, type StageRun } from "./stage-runner";

type Sql = ReturnType<typeof postgres>;

export const BACKFILL_STAGES = ["dockets", "clusters", "citations", "opinions"] as const;
export type BackfillStage = (typeof BACKFILL_STAGES)[number];

export interface FederalBackfillOptions {
  snapshotDate: string;
  snapshotDir: string;
  /** Federal bankruptcy courts and BAPs (FB, FBP). On by default for the full backfill. */
  includeBankruptcy: boolean;
  /**
   * The Supreme Court has its own official-source lane whose cases are keyed by
   * term and citation; loading CourtListener's SCOTUS dockets here would create
   * parallel non-term cases for the same decisions, so it is excluded by default.
   */
  includeScotus: boolean;
  /** Restrict to these CourtListener court codes (pilot runs). */
  courts?: readonly string[];
  /** Skip dockets/clusters filed before this year. Omit for full history. */
  minYear?: number;
  stages?: readonly BackfillStage[];
  /** Per-stage cap on rows written; smoke tests only. */
  maxRowsPerStage?: number;
  /** Override rows per batch for a stage (tuning, tests). */
  batchRows?: Partial<Record<BackfillStage, number>>;
  governor: Omit<GovernorOptions, "sizeCheckEvery"> & { sizeCheckEvery?: number };
  signalled?: () => boolean;
  log?: (event: Record<string, unknown>) => void;
}

export interface FederalBackfillResult {
  status: "completed" | "stopped";
  scopeKey: string;
  courts: number;
  stages: StageRun[];
}

const ADVISORY_LOCK_KEY = "jurvio:courtlistener-federal-backfill";

const FILE_FOR_STAGE: Record<BackfillStage, SnapshotFileKind> = {
  dockets: "dockets",
  clusters: "opinion-clusters",
  citations: "citations",
  opinions: "opinions",
};

/**
 * Progress rows are keyed by scope so a pilot over two courts never marks the
 * full run's stages done. The default full scope keeps a stable, readable key.
 */
export function backfillScopeKey(options: Pick<
  FederalBackfillOptions,
  "includeBankruptcy" | "includeScotus" | "courts" | "minYear"
>): string {
  const isDefault = options.includeBankruptcy && !options.includeScotus &&
    !options.courts?.length && options.minYear === undefined;
  if (isDefault) return "federal-full";
  const descriptor = JSON.stringify({
    bankruptcy: options.includeBankruptcy,
    scotus: options.includeScotus,
    courts: [...(options.courts ?? [])].sort(),
    minYear: options.minYear ?? null,
  });
  return `federal-scoped-${createHash("sha256").update(descriptor).digest("hex").slice(0, 12)}`;
}

function yearOf(date: string | null): number | null {
  return date ? Number(date.slice(0, 4)) : null;
}

async function loadBitset(
  sql: Sql,
  query: postgres.PendingQuery<{ id: string }[]>,
): Promise<IdBitset> {
  const bitset = new IdBitset(1 << 24);
  await query.cursor(50_000, (rows) => {
    for (const row of rows) bitset.add(row.id);
  });
  return bitset;
}

/**
 * Full federal CourtListener backfill from a local, checksummed snapshot.
 * Stages run in dependency order (dockets -> clusters -> citations -> opinions);
 * each commits its cursor with every batch and is skipped once done, so the whole
 * run can be stopped and restarted at any point.
 */
export async function runFederalBackfill(
  sql: Sql,
  options: FederalBackfillOptions,
): Promise<FederalBackfillResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.snapshotDate)) {
    throw new Error("Snapshot date must be YYYY-MM-DD");
  }
  const log = options.log ?? (() => undefined);
  const stages = options.stages?.length ? options.stages : BACKFILL_STAGES;
  const scopeKey = backfillScopeKey(options);
  const governor = new LoadGovernor(
    { sizeCheckEvery: 20, ...options.governor },
    options.signalled,
  );

  const lock = await sql.reserve();
  try {
    const [locked] = await lock<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${ADVISORY_LOCK_KEY})) AS locked
    `;
    if (!locked?.locked) throw new Error("Another federal backfill holds the advisory lock");

    const [provider] = await sql<{ id: string }[]>`
      SELECT id FROM provider WHERE code = 'courtlistener'
    `;
    if (!provider) throw new Error("CourtListener provider seed is missing");
    const providerId = provider.id;

    const files = await resolveSnapshotFiles(options.snapshotDir, options.snapshotDate, [
      "courts",
      ...stages.map((stage) => FILE_FOR_STAGE[stage]),
    ]);
    const file = (kind: SnapshotFileKind) => {
      const resolved = files.get(kind);
      if (!resolved) throw new Error(`Snapshot file ${kind} was not resolved`);
      return resolved;
    };

    // Courts: refresh the court table, then derive the federal scope from the
    // snapshot's own jurisdiction codes rather than a hand-kept list.
    await ingestCourtListenerBulkCourts(sql, file("courts").path, options.snapshotDate);
    const federal = await readFederalCourtCodes(openBulkCsv(file("courts").path), {
      includeBankruptcy: options.includeBankruptcy,
    });
    if (!options.includeScotus) federal.delete("scotus");
    if (options.courts?.length) {
      const outside = options.courts.filter((code) => !federal.has(code));
      if (outside.length) throw new Error(`Not federal courts in scope: ${outside.join(", ")}`);
    }
    const scope = new Set(options.courts?.length ? options.courts : federal);
    const scopeCodes = [...scope];
    if (scope.size === 0) throw new Error("No federal courts selected");
    log({ event: "scope", scopeKey, courts: scope.size, includeBankruptcy: options.includeBankruptcy });

    const artifactFor = async (kind: SnapshotFileKind) =>
      registerSnapshotArtifact(sql, {
        providerId,
        snapshotDate: options.snapshotDate,
        file: file(kind),
        lane: scopeKey,
      });
    const stageKey = (name: string) => `${scopeKey}:${name}`;
    const runs: StageRun[] = [];
    const common = {
      sql,
      snapshotDate: options.snapshotDate,
      governor,
      maxRowsWritten: options.maxRowsPerStage,
      log,
    };
    const finish = (run: StageRun) => {
      runs.push(run);
      log({ event: "stage", ...run });
      return run.status === "stopped";
    };

    if (stages.includes("dockets")) {
      const context = { providerId, artifactId: await artifactFor("dockets") };
      const run = await streamStage({
        ...common,
        stage: stageKey("dockets"),
        filePath: file("dockets").path,
        columns: ["court_id"],
        accept: (column, record) => {
          if (!scope.has(column(0))) return null;
          const row = docketBatchRow(courtListenerBulkDocketSchema.parse(record()));
          if (options.minYear !== undefined) {
            const year = yearOf(row.filed_on);
            if (year !== null && year < options.minYear) return null;
          }
          return row;
        },
        batchRows: options.batchRows?.dockets ?? 5_000,
        merge: (tx, rows) => mergeDocketBatch(tx, context, rows),
      });
      // A court whose dockets now exist in the canonical table is a verified court
      // record, as in the per-row docket lane.
      await sql`
        UPDATE court SET verification = 'verified', updated_at = now()
        WHERE provider_id = ${providerId}
          AND provider_court_id = ANY(${sql.array(scopeCodes)}::text[])
          AND verification <> 'verified'
          AND EXISTS (SELECT 1 FROM legal_case WHERE legal_case.court_id = court.id)
      `;
      if (finish(run)) return { status: "stopped", scopeKey, courts: scope.size, stages: runs };
    }

    if (stages.includes("clusters")) {
      const context = { providerId, artifactId: await artifactFor("opinion-clusters") };
      const dockets = await loadBitset(sql, sql<{ id: string }[]>`
        SELECT identifier.identifier_value AS id
        FROM case_identifier identifier
        JOIN legal_case ON legal_case.id = identifier.case_id
        JOIN court ON court.id = legal_case.court_id
        WHERE identifier.provider_id = ${providerId}
          AND identifier.identifier_type = 'courtlistener_docket_id'
          AND court.provider_court_id = ANY(${sql.array(scopeCodes)}::text[])
      `);
      log({ event: "prefilter", stage: "clusters", dockets: dockets.size });
      const run = await streamStage({
        ...common,
        stage: stageKey("clusters"),
        filePath: file("opinion-clusters").path,
        columns: ["docket_id"],
        accept: (column, record) => {
          if (!dockets.mayContain(column(0))) return null;
          const row = clusterBatchRow(courtListenerBulkOpinionClusterSchema.parse(record()));
          if (options.minYear !== undefined) {
            const year = yearOf(row.date_filed);
            if (year !== null && year < options.minYear) return null;
          }
          return row;
        },
        batchRows: options.batchRows?.clusters ?? 2_000,
        batchBytes: 32 * 1024 * 1024,
        rowBytes: clusterRowBytes,
        merge: (tx, rows) => mergeClusterBatch(tx, context, rows),
      });
      if (finish(run)) return { status: "stopped", scopeKey, courts: scope.size, stages: runs };
    }

    const clusterBitset = async () => {
      const clusters = await loadBitset(sql, sql<{ id: string }[]>`
        SELECT cluster.provider_cluster_id AS id
        FROM opinion_cluster cluster
        JOIN legal_case ON legal_case.id = cluster.case_id
        JOIN court ON court.id = legal_case.court_id
        WHERE cluster.provider_id = ${providerId}
          AND court.provider_court_id = ANY(${sql.array(scopeCodes)}::text[])
      `);
      log({ event: "prefilter", clusters: clusters.size });
      return clusters;
    };

    if (stages.includes("citations")) {
      const clusters = await clusterBitset();
      const staged = await streamStage({
        ...common,
        stage: stageKey("citations"),
        filePath: file("citations").path,
        columns: ["cluster_id"],
        accept: (column, record) =>
          clusters.mayContain(column(0))
            ? citationBatchRow(courtListenerBulkCitationSchema.parse(record()))
            : null,
        batchRows: options.batchRows?.citations ?? 20_000,
        merge: (tx, rows) => stageCitationBatch(tx, options.snapshotDate, rows),
      });
      if (finish(staged)) return { status: "stopped", scopeKey, courts: scope.size, stages: runs };

      const applyStage = stageKey("citations-apply");
      const progress = await startStage(sql, options.snapshotDate, applyStage);
      const applied: StageRun = {
        stage: applyStage,
        status: progress.done ? "already_done" : "completed",
        rowsScanned: progress.rowsScanned,
        rowsMatched: progress.rowsMatched,
        rowsWritten: progress.rowsWritten,
        seconds: 0,
      };
      const started = Date.now();
      let after = progress.rowsScanned;
      while (!progress.done) {
        const chunk = await applyStagedCitations(sql, {
          providerId,
          snapshotDate: options.snapshotDate,
          afterClusterId: after,
          chunkClusters: 20_000,
          onChunk: (tx, lastClusterId, updated) =>
            advanceStage(tx, {
              snapshotDate: options.snapshotDate,
              stage: applyStage,
              rowsScanned: lastClusterId,
              matched: 0,
              written: updated,
            }),
        });
        if (chunk.done) {
          await sql`DELETE FROM cl_bulk_citation_stage WHERE snapshot_date = ${options.snapshotDate}`;
          await finishStage(sql, options.snapshotDate, applyStage);
          break;
        }
        after = chunk.lastClusterId;
        applied.rowsScanned = after;
        applied.rowsWritten += chunk.updated;
        const reason = await governor.stopReason(sql);
        if (reason) {
          applied.status = "stopped";
          applied.stopReason = reason;
          break;
        }
      }
      applied.seconds = Math.round((Date.now() - started) / 100) / 10;
      if (finish(applied)) return { status: "stopped", scopeKey, courts: scope.size, stages: runs };
    }

    if (stages.includes("opinions")) {
      const context = { providerId, artifactId: await artifactFor("opinions") };
      const clusters = await clusterBitset();
      const run = await streamStage({
        ...common,
        stage: stageKey("opinions"),
        filePath: file("opinions").path,
        columns: ["cluster_id"],
        accept: (column, record) =>
          clusters.mayContain(column(0))
            ? opinionBatchRow(courtListenerBulkOpinionSchema.parse(record()))
            : null,
        batchRows: options.batchRows?.opinions ?? 500,
        batchBytes: 24 * 1024 * 1024,
        rowBytes: opinionRowBytes,
        merge: (tx, rows) => mergeOpinionBatch(tx, context, rows),
      });
      if (finish(run)) return { status: "stopped", scopeKey, courts: scope.size, stages: runs };
    }

    await sql`
      INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
      VALUES (
        ${providerId}, ${`bulk:${scopeKey}`},
        ${JSON.stringify({ version: 1, snapshotDate: options.snapshotDate, stages: runs })}
      )
      ON CONFLICT (provider_id, stream_name)
      DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = now()
    `;
    return { status: "completed", scopeKey, courts: scope.size, stages: runs };
  } finally {
    await lock`SELECT pg_advisory_unlock(hashtext(${ADVISORY_LOCK_KEY}))`.catch(() => undefined);
    lock.release();
  }
}
