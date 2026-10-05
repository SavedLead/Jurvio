import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;
type Executor = Sql | postgres.TransactionSql;

export interface StageProgress {
  rowsScanned: number;
  rowsMatched: number;
  rowsWritten: number;
  done: boolean;
}

export async function startStage(
  sql: Sql,
  snapshotDate: string,
  stage: string,
): Promise<StageProgress> {
  const [row] = await sql<{
    rows_scanned: string;
    rows_matched: string;
    rows_written: string;
    done: boolean;
  }[]>`
    INSERT INTO cl_bulk_ingest_progress (snapshot_date, stage, started_at)
    VALUES (${snapshotDate}, ${stage}, now())
    ON CONFLICT (snapshot_date, stage)
    DO UPDATE SET started_at = COALESCE(cl_bulk_ingest_progress.started_at, now())
    RETURNING rows_scanned, rows_matched, rows_written, done
  `;
  if (!row) throw new Error(`Progress for ${stage} was not initialized`);
  return {
    rowsScanned: Number(row.rows_scanned),
    rowsMatched: Number(row.rows_matched),
    rowsWritten: Number(row.rows_written),
    done: row.done,
  };
}

/**
 * Advance a stage cursor. Called inside the batch's own transaction so the cursor
 * and the rows it covers commit (or roll back) together.
 */
export async function advanceStage(
  executor: Executor,
  input: { snapshotDate: string; stage: string; rowsScanned: number; matched: number; written: number },
): Promise<void> {
  await executor`
    UPDATE cl_bulk_ingest_progress SET
      rows_scanned = ${input.rowsScanned},
      rows_matched = rows_matched + ${input.matched},
      rows_written = rows_written + ${input.written},
      updated_at = now()
    WHERE snapshot_date = ${input.snapshotDate} AND stage = ${input.stage}
  `;
}

export async function finishStage(sql: Sql, snapshotDate: string, stage: string): Promise<void> {
  await sql`
    UPDATE cl_bulk_ingest_progress
    SET done = true, finished_at = now(), updated_at = now()
    WHERE snapshot_date = ${snapshotDate} AND stage = ${stage}
  `;
}

export interface GovernorOptions {
  /** Batches slower than this are followed by a pause so live work gets the database back. */
  targetBatchMs: number;
  maxPauseMs: number;
  /** Stop cleanly (resumable) once the database reaches this size. */
  maxDatabaseBytes?: number;
  /** Stop cleanly (resumable) after this much wall-clock time. */
  deadline?: number;
  /** How often, in batches, to check the database size. */
  sizeCheckEvery: number;
}

export type StopReason = "signal" | "time_budget" | "database_size_cap" | "row_limit";

/**
 * Keeps the loader from starving live ingestion and the public site. A batch that
 * takes longer than the target means PostgreSQL is busy; the loader then pauses
 * for the overrun (capped) before the next batch. Size and time caps end the run
 * at a batch boundary with the cursor committed, so the next run resumes there.
 */
export class LoadGovernor {
  private batches = 0;

  constructor(
    private readonly options: GovernorOptions,
    private readonly signalled: () => boolean = () => false,
    private readonly now: () => number = Date.now,
  ) {}

  pauseAfter(batchMs: number): number {
    if (batchMs <= this.options.targetBatchMs) return 0;
    return Math.min(this.options.maxPauseMs, batchMs - this.options.targetBatchMs);
  }

  async stopReason(sql: Sql): Promise<StopReason | null> {
    this.batches += 1;
    if (this.signalled()) return "signal";
    if (this.options.deadline !== undefined && this.now() >= this.options.deadline) return "time_budget";
    if (this.options.maxDatabaseBytes !== undefined && this.batches % this.options.sizeCheckEvery === 0) {
      const [row] = await sql<{ bytes: string }[]>`SELECT pg_database_size(current_database())::text AS bytes`;
      if (row && Number(row.bytes) >= this.options.maxDatabaseBytes) return "database_size_cap";
    }
    return null;
  }
}
