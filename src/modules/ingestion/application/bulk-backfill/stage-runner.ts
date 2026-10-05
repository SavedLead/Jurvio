import { setTimeout as sleep } from "node:timers/promises";
import type postgres from "postgres";
import { openBulkCsv, parseBulkCsvRecords } from "../../providers/courtlistener/bulk";
import { advanceStage, finishStage, startStage, type LoadGovernor, type StopReason } from "./progress";

type Sql = ReturnType<typeof postgres>;

export interface BatchOutcome {
  matched: number;
  written: number;
}

export interface StageRun {
  stage: string;
  status: "completed" | "already_done" | "stopped";
  stopReason?: StopReason;
  rowsScanned: number;
  rowsMatched: number;
  rowsWritten: number;
  /** Rows this run skipped because they failed validation (logged, not fatal). */
  rowsRejected?: number;
  seconds: number;
}

// Deadlock, serialization failure, and connection loss: the batch's transaction
// rolled back as a unit, so the same rows can simply be written again.
const RETRYABLE_CODES = new Set([
  "40P01", "40001", "57P01", "08000", "08003", "08006",
  "ECONNRESET", "CONNECTION_CLOSED", "CONNECTION_DESTROYED", "CONNECT_TIMEOUT",
]);
const MAX_ATTEMPTS = 4;
const LOGGED_REJECTIONS = 100;

function retryable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && RETRYABLE_CODES.has(code);
}

export interface StreamStageOptions<Row> {
  sql: Sql;
  snapshotDate: string;
  stage: string;
  filePath: string;
  governor: LoadGovernor;
  /** Columns the prefilter reads; resolved against the header once. */
  columns: readonly string[];
  /**
   * Turn a raw record into a batch row, or null to skip it. `column(i)` reads the
   * i-th requested column without building an object, so rows outside the
   * federal scope cost one array lookup.
   */
  accept: (column: (index: number) => string, record: () => Record<string, string>) => Row | null;
  batchRows: number;
  batchBytes?: number;
  rowBytes?: (row: Row) => number;
  /** Write one batch and advance the cursor in the same transaction. */
  merge: (tx: postgres.TransactionSql, rows: Row[]) => Promise<BatchOutcome>;
  /** Stop (not done) once this many rows have been written. Smoke tests only. */
  maxRowsWritten?: number;
  log?: (event: Record<string, unknown>) => void;
  logEveryMs?: number;
  /** Base delay before retrying a batch after a transient error (doubles each attempt). */
  retryDelayMs?: number;
}

/**
 * Stream one snapshot file through batched, checkpointed merges.
 *
 * - Resume: the stage cursor counts data records consumed; a restart skips that
 *   many without parsing them into objects.
 * - Overlap: the next batch is parsed while the previous one is being written,
 *   with at most one batch in flight so cursors commit in order.
 * - Back-pressure: after each batch the governor may pause the loader or end the
 *   run at the batch boundary.
 */
export async function streamStage<Row>(options: StreamStageOptions<Row>): Promise<StageRun> {
  const started = Date.now();
  const progress = await startStage(options.sql, options.snapshotDate, options.stage);
  const result: StageRun = {
    stage: options.stage,
    status: "completed",
    rowsScanned: progress.rowsScanned,
    rowsMatched: progress.rowsMatched,
    rowsWritten: progress.rowsWritten,
    seconds: 0,
  };
  if (progress.done) return { ...result, status: "already_done" };

  const skip = progress.rowsScanned;
  const log = options.log ?? (() => undefined);
  const logEveryMs = options.logEveryMs ?? 30_000;
  let lastLog = Date.now();
  let scanned = 0;
  let batch: Row[] = [];
  let batchBytes = 0;
  let inFlight: Promise<void> | null = null;
  let failure: unknown = null;
  let stopReason = null as StopReason | null;
  let brokeOut = false;

  const commit = (rows: Row[], scannedAtClose: number) =>
    options.sql.begin(async (tx) => {
      const merged = rows.length ? await options.merge(tx, rows) : { matched: 0, written: 0 };
      await advanceStage(tx, {
        snapshotDate: options.snapshotDate,
        stage: options.stage,
        rowsScanned: scannedAtClose,
        matched: merged.matched,
        written: merged.written,
      });
      return merged;
    });

  const write = async (rows: Row[], scannedAtClose: number) => {
    const began = Date.now();
    let outcome: BatchOutcome | undefined;
    for (let attempt = 1; outcome === undefined; attempt += 1) {
      try {
        outcome = await commit(rows, scannedAtClose);
      } catch (error) {
        if (!retryable(error) || attempt >= MAX_ATTEMPTS) throw error;
        log({ stage: options.stage, event: "batch_retry", attempt, code: (error as { code?: string }).code });
        await sleep((options.retryDelayMs ?? 1_000) * 2 ** (attempt - 1));
      }
    }
    result.rowsScanned = scannedAtClose;
    result.rowsMatched += outcome.matched;
    result.rowsWritten += outcome.written;
    const pause = options.governor.pauseAfter(Date.now() - began);
    if (pause > 0) await sleep(pause);
    if (options.maxRowsWritten !== undefined && result.rowsWritten >= options.maxRowsWritten) {
      stopReason = "row_limit";
    } else {
      stopReason ??= await options.governor.stopReason(options.sql);
    }
  };

  // Wait for the in-flight batch, then start writing the current one. Once a stop
  // is requested no new batch starts; its rows are re-read on resume because the
  // cursor has not passed them.
  const flush = async (force = false) => {
    if (inFlight) {
      await inFlight;
      inFlight = null;
    }
    if (failure) throw failure;
    if (stopReason && !force) return;
    const rows = batch;
    batch = [];
    batchBytes = 0;
    inFlight = write(rows, scanned).catch((error: unknown) => {
      failure = error;
    });
  };

  const source = openBulkCsv(options.filePath);
  let headers: string[] | undefined;
  let indexes: number[] = [];
  try {
    for await (const values of parseBulkCsvRecords(source.stream)) {
      if (!headers) {
        headers = values;
        indexes = options.columns.map((name) => {
          const index = values.indexOf(name);
          if (index < 0) throw new Error(`${options.filePath} has no "${name}" column`);
          return index;
        });
        continue;
      }
      scanned += 1;
      if (scanned <= skip) continue;
      const header = headers;
      let row: Row | null;
      try {
        row = options.accept(
          (index) => values[indexes[index]!] ?? "",
          () => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])),
        );
      } catch (error) {
        // A row the schema rejects is skipped, counted and logged; one malformed
        // record must not stop a multi-hour load.
        row = null;
        result.rowsRejected = (result.rowsRejected ?? 0) + 1;
        if (result.rowsRejected <= LOGGED_REJECTIONS) {
          log({
            stage: options.stage,
            event: "row_rejected",
            record: scanned,
            id: values[header.indexOf("id")] ?? null,
            error: error instanceof Error ? error.message.slice(0, 500) : String(error),
          });
        }
      }
      if (row !== null) {
        batch.push(row);
        if (options.rowBytes) batchBytes += options.rowBytes(row);
      }
      const full =
        batch.length >= options.batchRows ||
        (options.batchBytes !== undefined && batchBytes >= options.batchBytes);
      if (full) {
        await flush();
        if (stopReason) {
          brokeOut = true;
          break;
        }
      }
      if (Date.now() - lastLog >= logEveryMs) {
        lastLog = Date.now();
        log({ stage: options.stage, progress: true, scanned, ...counts(result), seconds: elapsed(started) });
      }
    }
    if (!brokeOut) {
      // The file is fully consumed: write the tail (and the final cursor) even if
      // the last batch asked to stop, then mark the stage done.
      await flush(true);
      if (inFlight) await inFlight;
      inFlight = null;
      if (failure) throw failure;
      await source.completion;
      await finishStage(options.sql, options.snapshotDate, options.stage);
      stopReason = null;
    }
  } finally {
    if (inFlight) await inFlight;
    source.close();
  }
  if (failure) throw failure;
  if (stopReason) {
    result.status = "stopped";
    result.stopReason = stopReason;
  }
  result.seconds = elapsed(started);
  return result;
}

function counts(run: StageRun) {
  return { rowsMatched: run.rowsMatched, rowsWritten: run.rowsWritten };
}

function elapsed(started: number): number {
  return Math.round((Date.now() - started) / 100) / 10;
}
