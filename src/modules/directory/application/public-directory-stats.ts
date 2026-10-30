import type postgres from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";

type Sql = ReturnType<typeof postgres>;

/**
 * Precomputed directory counts for /courts, /courts/[id], the /cases court
 * facet and /judges (migration 0135, ADR 0080).
 *
 * Every pass walks courts and then judges in id order, a small batch per
 * committed statement, with a pause between batches so it never holds a
 * connection or the disk for long while the public site is serving. A batch
 * that hits its statement timeout is retried smaller; a single row that still
 * times out is skipped and keeps its previous value (or the live fallback).
 */
export const COURT_BATCH = 20;
export const JUDGE_BATCH = 250;
export const RECENT_CASES_PER_COURT = 100;
const BATCH_TIMEOUT = "60s";

export interface RefreshOptions {
  /** Pause between batches. Keeps the refresher from competing with page queries. */
  pauseMs?: number;
  courtBatch?: number;
  judgeBatch?: number;
  log?: (event: Record<string, unknown>) => void;
}

export interface RefreshResult {
  courts: { upserted: number; skipped: number };
  judges: { upserted: number; skipped: number; removed: number };
}

const displayableCase = latestPublicationColumnSql("displayable", "legal_case", "c.id");

export function isStatementTimeout(error: unknown): boolean {
  if ((error as { code?: string } | null)?.code === "57014") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("statement timeout");
}

/** SQLSTATE 42P01: the stats table is not migrated yet. Callers use the live query. */
export function isMissingTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01";
}

type Tx = postgres.TransactionSql;

/** One committed batch. Inside an outer transaction (tests) this is a savepoint. */
function batchTransaction<T>(sql: Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const handle = sql as unknown as { begin?: (cb: (tx: Tx) => Promise<T>) => Promise<T>; savepoint: (cb: (tx: Tx) => Promise<T>) => Promise<T> };
  return typeof handle.begin === "function" ? handle.begin(fn) : handle.savepoint(fn);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function walkInBatches(
  label: string,
  batchSize: number,
  pauseMs: number,
  log: NonNullable<RefreshOptions["log"]>,
  next: (cursor: string | null, limit: number) => Promise<string[]>,
  write: (ids: string[]) => Promise<number>,
): Promise<{ upserted: number; skipped: number }> {
  let cursor: string | null = null;
  let upserted = 0;
  let skipped = 0;
  let limit = batchSize;
  let pending = await next(cursor, batchSize);
  while (pending.length) {
    const slice = pending.slice(0, limit);
    try {
      const n = await write(slice);
      upserted += n;
      cursor = slice[slice.length - 1] ?? cursor;
      pending = pending.slice(slice.length);
      limit = batchSize;
      log({ directoryStats: "batch", kind: label, rows: slice.length, upserted: n, total: upserted });
    } catch (error) {
      if (!isStatementTimeout(error)) throw error;
      if (slice.length === 1) {
        skipped += 1;
        cursor = slice[0] ?? cursor;
        pending = pending.slice(1);
        limit = batchSize;
        log({ directoryStats: "skipped", kind: label, id: slice[0], reason: "statement_timeout" });
      } else {
        limit = Math.max(1, Math.floor(slice.length / 4));
        log({ directoryStats: "shrink", kind: label, from: slice.length, to: limit });
        continue;
      }
    }
    if (!pending.length) pending = await next(cursor, batchSize);
    if (pending.length && pauseMs > 0) await sleep(pauseMs);
  }
  return { upserted, skipped };
}

async function nextCourtIds(sql: Sql, cursor: string | null, limit: number): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM court
    WHERE (${cursor}::uuid IS NULL OR id > ${cursor}::uuid)
    ORDER BY id
    LIMIT ${limit}
  `;
  return rows.map((row) => row.id);
}

async function upsertCourtBatch(sql: Sql, ids: string[]): Promise<number> {
  return batchTransaction(sql, async (tx) => {
    await tx`SELECT set_config('statement_timeout', ${BATCH_TIMEOUT}, true)`;
    const [row] = await tx<{ n: number }[]>`
      WITH upserted AS (
        INSERT INTO court_public_stats (court_id, case_count, latest_case_date, recent_case_ids, refreshed_at)
        SELECT court.id, totals.case_count, totals.latest_case_date, recent.ids, now()
        FROM court
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS case_count, max(c.filed_on) AS latest_case_date
          FROM legal_case c
          WHERE c.court_id = court.id
            AND c.publication = 'published'
            AND ${tx.unsafe(displayableCase)}
        ) totals
        CROSS JOIN LATERAL (
          SELECT COALESCE(array_agg(newest.id ORDER BY newest.ord), '{}'::uuid[]) AS ids
          FROM (
            SELECT c.id, row_number() OVER (ORDER BY c.filed_on DESC NULLS LAST, c.caption, c.id) AS ord
            FROM legal_case c
            WHERE c.court_id = court.id
              AND c.publication = 'published'
              AND ${tx.unsafe(displayableCase)}
            ORDER BY c.filed_on DESC NULLS LAST, c.caption, c.id
            LIMIT ${RECENT_CASES_PER_COURT}
          ) newest
        ) recent
        WHERE court.id = ANY(${ids}::uuid[])
        ON CONFLICT (court_id) DO UPDATE SET
          case_count = EXCLUDED.case_count,
          latest_case_date = EXCLUDED.latest_case_date,
          recent_case_ids = EXCLUDED.recent_case_ids,
          refreshed_at = EXCLUDED.refreshed_at
        RETURNING court_id
      )
      SELECT count(*)::int AS n FROM upserted
    `;
    return row?.n ?? 0;
  });
}

async function nextJudgeIds(sql: Sql, cursor: string | null, limit: number): Promise<string[]> {
  // Only verified judges can appear on a public page; the reader re-checks the
  // judge publication decision live.
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM judge
    WHERE verification = 'verified'
      AND (${cursor}::uuid IS NULL OR id > ${cursor}::uuid)
    ORDER BY id
    LIMIT ${limit}
  `;
  return rows.map((row) => row.id);
}

async function upsertJudgeBatch(sql: Sql, ids: string[]): Promise<number> {
  return batchTransaction(sql, async (tx) => {
    await tx`SELECT set_config('statement_timeout', ${BATCH_TIMEOUT}, true)`;
    const [row] = await tx<{ n: number }[]>`
      WITH upserted AS (
        INSERT INTO judge_public_stats (judge_id, case_count, outcome_sample, refreshed_at)
        SELECT judge.id, totals.case_count, totals.outcome_sample, now()
        FROM judge
        CROSS JOIN LATERAL (
          SELECT count(DISTINCT c.id)::int AS case_count,
            count(DISTINCT observation.id)::int AS outcome_sample
          FROM judge_case_assignment assignment
          JOIN legal_case c
            ON c.id = assignment.case_id
           AND c.publication = 'published'
           AND ${tx.unsafe(displayableCase)}
          LEFT JOIN judge_case_observation observation
            ON observation.judge_id = judge.id AND observation.case_id = c.id
           AND observation.observation_type = 'case_outcome' AND observation.confidence >= 0.800
          WHERE assignment.judge_id = judge.id
        ) totals
        WHERE judge.id = ANY(${ids}::uuid[])
        ON CONFLICT (judge_id) DO UPDATE SET
          case_count = EXCLUDED.case_count,
          outcome_sample = EXCLUDED.outcome_sample,
          refreshed_at = EXCLUDED.refreshed_at
        RETURNING judge_id
      )
      SELECT count(*)::int AS n FROM upserted
    `;
    return row?.n ?? 0;
  });
}

async function removeUnverifiedJudges(sql: Sql): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    WITH removed AS (
      DELETE FROM judge_public_stats stats
      USING judge
      WHERE judge.id = stats.judge_id AND judge.verification <> 'verified'
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM removed
  `;
  return row?.n ?? 0;
}

export async function refreshPublicDirectoryStats(sql: Sql, options: RefreshOptions = {}): Promise<RefreshResult> {
  const pauseMs = options.pauseMs ?? 250;
  const log = options.log ?? ((event) => console.log(JSON.stringify(event)));
  log({ directoryStats: "start", courtBatch: options.courtBatch ?? COURT_BATCH, judgeBatch: options.judgeBatch ?? JUDGE_BATCH, pauseMs });
  const courts = await walkInBatches(
    "court", options.courtBatch ?? COURT_BATCH, pauseMs, log,
    (cursor, limit) => nextCourtIds(sql, cursor, limit),
    (ids) => upsertCourtBatch(sql, ids),
  );
  const judgeWalk = await walkInBatches(
    "judge", options.judgeBatch ?? JUDGE_BATCH, pauseMs, log,
    (cursor, limit) => nextJudgeIds(sql, cursor, limit),
    (ids) => upsertJudgeBatch(sql, ids),
  );
  const removed = await removeUnverifiedJudges(sql);
  const result = { courts, judges: { ...judgeWalk, removed } };
  log({ directoryStats: "done", ...result });
  return result;
}
