import type postgres from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";

type Sql = ReturnType<typeof postgres>;

/**
 * Precomputed directory counts for /courts, /courts/[id], the /cases court
 * facet and /judges (migration 0135, ADR 0080).
 *
 * The published case_count is maintained by the publication trigger, not by
 * this job. This pass only refreshes the latest date and the newest-case
 * list, then judges. A batch that hits its statement timeout is retried
 * smaller; a single row that still times out is skipped and keeps its
 * previous value.
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
  entities: EntityRefreshResult;
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
        SELECT court.id, 0, totals.latest_case_date, recent.ids, now()
        FROM court
        CROSS JOIN LATERAL (
          SELECT max(c.filed_on) AS latest_case_date
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

export const ENTITY_CASE_BATCH = 2000;
export const ENTITY_MAX_BATCHES = 250;
/** A completed entity pass is reused for this long before the next one starts. */
export const ENTITY_REFRESH_EVERY_MS = 2 * 60 * 60_000;

export interface EntityRefreshResult {
  ran: boolean;
  generation: number | null;
  cases: number;
  published: boolean;
}

/**
 * Party / law-firm counts (migration 0137). Walks published cases in public_id
 * order and adds each batch's per-entity count(DISTINCT case) into the building
 * generation; the cursor moves in the same transaction, so a killed run resumes
 * without double counting. At the end the generation is published and older
 * generations are deleted in chunks.
 */
export async function refreshEntityPublicStats(
  sql: Sql,
  options: { batchSize?: number; maxBatches?: number; pauseMs?: number; force?: boolean; now?: Date; log?: RefreshOptions["log"] } = {},
): Promise<EntityRefreshResult> {
  const batchSize = options.batchSize ?? ENTITY_CASE_BATCH;
  const maxBatches = options.maxBatches ?? ENTITY_MAX_BATCHES;
  const pauseMs = options.pauseMs ?? 250;
  const log = options.log ?? ((event) => console.log(JSON.stringify(event)));
  const now = options.now ?? new Date();
  const [state] = await sql<{ published: number | null; publishedAt: Date | null; building: number | null; cursor: string | null }[]>`
    SELECT published_generation AS published, published_at AS "publishedAt",
      building_generation AS building, building_cursor AS cursor
    FROM public_stats_generation WHERE name = 'entity'
  `;
  if (!state) return { ran: false, generation: null, cases: 0, published: false };
  const fresh = state.publishedAt && now.getTime() - new Date(state.publishedAt).getTime() < ENTITY_REFRESH_EVERY_MS;
  if (state.building === null && fresh && !options.force) {
    log({ directoryStats: "entity-skip", reason: "fresh", publishedAt: state.publishedAt });
    return { ran: false, generation: state.published, cases: 0, published: false };
  }
  let generation = state.building;
  let cursor = state.cursor;
  if (generation === null) {
    generation = (state.published ?? 0) + 1;
    cursor = null;
    await sql`DELETE FROM entity_public_stats WHERE generation = ${generation}`;
    await sql`
      UPDATE public_stats_generation
      SET building_generation = ${generation}, building_cursor = NULL, building_started_at = now()
      WHERE name = 'entity'
    `;
  }
  log({ directoryStats: "entity-start", generation, cursor, batchSize, maxBatches });
  let cases = 0;
  for (let i = 0; i < maxBatches; i += 1) {
    const batch = await batchTransaction(sql, async (tx) => {
      await tx`SELECT set_config('statement_timeout', ${BATCH_TIMEOUT}, true)`;
      const [row] = await tx<{ seen: number; last: string | null }[]>`
        WITH batch AS (
          SELECT c.id, c.public_id, c.filed_on
          FROM legal_case c
          WHERE c.publication = 'published'
            AND (${cursor}::text IS NULL OR c.public_id > ${cursor}::text)
          ORDER BY c.public_id
          LIMIT ${batchSize}
        ), visible AS (
          SELECT c.id, c.filed_on FROM batch c WHERE ${tx.unsafe(displayableCase)}
        ), added AS (
          INSERT INTO entity_public_stats (generation, entity_id, case_count, latest_case_date)
          SELECT ${generation}::int, appearance.entity_id, count(DISTINCT visible.id)::int, max(visible.filed_on)
          FROM visible
          JOIN party_appearance appearance ON appearance.case_id = visible.id
          GROUP BY appearance.entity_id
          ON CONFLICT (generation, entity_id) DO UPDATE SET
            case_count = entity_public_stats.case_count + EXCLUDED.case_count,
            latest_case_date = GREATEST(entity_public_stats.latest_case_date, EXCLUDED.latest_case_date)
          RETURNING 1
        )
        SELECT (SELECT count(*) FROM batch)::int AS seen,
          (SELECT max(public_id) FROM batch) AS last,
          (SELECT count(*) FROM added)::int AS entities
      `;
      const seen = row?.seen ?? 0;
      const last = row?.last ?? cursor;
      await tx`UPDATE public_stats_generation SET building_cursor = ${last} WHERE name = 'entity'`;
      return { seen, last };
    });
    cases += batch.seen;
    cursor = batch.last;
    if (batch.seen < batchSize) {
      await sql`
        UPDATE public_stats_generation
        SET published_generation = ${generation}, published_at = now(),
          building_generation = NULL, building_cursor = NULL, building_started_at = NULL
        WHERE name = 'entity'
      `;
      for (;;) {
        const removed = await sql`
          DELETE FROM entity_public_stats WHERE ctid IN (
            SELECT ctid FROM entity_public_stats WHERE generation < ${generation} LIMIT 20000
          )
        `;
        if (removed.count === 0) break;
        if (pauseMs > 0) await sleep(pauseMs);
      }
      log({ directoryStats: "entity-published", generation, cases });
      return { ran: true, generation, cases, published: true };
    }
    if (i % 25 === 0) log({ directoryStats: "entity-batch", generation, cursor, cases });
    if (pauseMs > 0) await sleep(pauseMs);
  }
  log({ directoryStats: "entity-paused", generation, cursor, cases });
  return { ran: true, generation, cases, published: false };
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
  let entities: EntityRefreshResult = { ran: false, generation: null, cases: 0, published: false };
  try {
    entities = await refreshEntityPublicStats(sql, { pauseMs, log });
  } catch (error) {
    // Not migrated yet: courts and judges still refresh.
    if (!isMissingTable(error)) throw error;
  }
  const result = { courts, judges: { ...judgeWalk, removed }, entities };
  log({ directoryStats: "done", ...result });
  return result;
}
