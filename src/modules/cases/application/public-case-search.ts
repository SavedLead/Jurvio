import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;
type Tx = postgres.TransactionSql;

/**
 * Precomputed text-search candidates for /cases (migration 0136, ADR 0081).
 *
 * One row per published case holds caption, docket, citation, verified holding
 * and every party/entity name. A trigram match on that text is a superset of
 * the live /cases text conditions, so the listing narrows to those ids first
 * and then applies the exact original conditions and the live publication gate.
 *
 * The refresher walks published cases in public_id order (partial index
 * legal_case_published_public_id_idx), a committed batch at a time with a
 * pause between batches, and stores its cursor after every batch so a killed
 * run resumes. Unchanged rows are not rewritten. Each run first adds cases
 * published since the last run that have no row yet, then continues the
 * rolling sweep, which also picks up party changes and drops unpublished cases.
 */
export const SEARCH_BATCH = 1000;
export const NEW_CASE_BATCHES = 20;
const BATCH_TIMEOUT = "60s";

export interface CaseSearchRefreshOptions {
  batchSize?: number;
  /** Sweep batches per run once the first full sweep has completed. */
  maxBatches?: number;
  /** Sweep batches per run while the first full sweep is still filling the table. */
  initialMaxBatches?: number;
  pauseMs?: number;
  log?: (event: Record<string, unknown>) => void;
}

export interface CaseSearchRefreshResult {
  added: number;
  written: number;
  scanned: number;
  removed: number;
  sweepCompleted: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function batchTransaction<T>(sql: Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const handle = sql as unknown as { begin?: (cb: (tx: Tx) => Promise<T>) => Promise<T>; savepoint: (cb: (tx: Tx) => Promise<T>) => Promise<T> };
  return typeof handle.begin === "function" ? handle.begin(fn) : handle.savepoint(fn);
}

/** Search text for the cases in `batch` (a CTE with id, public_id, caption, docket_number, official_citation). */
const SEARCH_TEXT = `
  redact_public_text(concat_ws(E'\\n',
    batch.caption,
    batch.docket_number,
    batch.official_citation,
    (SELECT enrichment.exact_holding FROM scotus_case_enrichment enrichment
      WHERE enrichment.case_id = batch.id AND enrichment.verification = 'verified'),
    (SELECT string_agg(DISTINCT names.name, E'\\n')
      FROM (
        SELECT appearance.party_name_as_filed AS name
        FROM party_appearance appearance WHERE appearance.case_id = batch.id
        UNION
        SELECT entity.display_name
        FROM party_appearance appearance JOIN entity ON entity.id = appearance.entity_id
        WHERE appearance.case_id = batch.id
      ) names)
  ))
`;

async function upsertSweepBatch(sql: Sql, cursor: string | null, limit: number) {
  return batchTransaction(sql, async (tx) => {
    await tx`SELECT set_config('statement_timeout', ${BATCH_TIMEOUT}, true)`;
    const [row] = await tx<{ seen: number; written: number; last: string | null }[]>`
      WITH batch AS (
        SELECT c.id, c.public_id, c.caption, c.docket_number, c.official_citation
        FROM legal_case c
        WHERE c.publication = 'published'
          AND (${cursor}::text IS NULL OR c.public_id > ${cursor}::text)
        ORDER BY c.public_id
        LIMIT ${limit}
      ), written AS (
        INSERT INTO public_case_search (case_id, public_id, search_text, refreshed_at)
        SELECT batch.id, batch.public_id, ${tx.unsafe(SEARCH_TEXT)}, now()
        FROM batch
        ON CONFLICT (case_id) DO UPDATE SET
          public_id = EXCLUDED.public_id,
          search_text = EXCLUDED.search_text,
          refreshed_at = EXCLUDED.refreshed_at
        WHERE public_case_search.search_text IS DISTINCT FROM EXCLUDED.search_text
           OR public_case_search.public_id IS DISTINCT FROM EXCLUDED.public_id
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM batch)::int AS seen,
        (SELECT count(*) FROM written)::int AS written,
        (SELECT max(public_id) FROM batch) AS last
    `;
    const seen = row?.seen ?? 0;
    const last = row?.last ?? null;
    const end = seen < limit;
    // Rows in the swept range whose case is no longer published.
    const removed = await tx`
      DELETE FROM public_case_search search
      WHERE (${cursor}::text IS NULL OR search.public_id > ${cursor}::text)
        AND (${end ? null : last}::text IS NULL OR search.public_id <= ${end ? null : last}::text)
        AND NOT EXISTS (
          SELECT 1 FROM legal_case c WHERE c.id = search.case_id AND c.publication = 'published'
        )
    `;
    return { seen, written: row?.written ?? 0, last, end, removed: removed.count };
  });
}

async function addNewlyPublished(sql: Sql, limit: number): Promise<number> {
  return batchTransaction(sql, async (tx) => {
    await tx`SELECT set_config('statement_timeout', ${BATCH_TIMEOUT}, true)`;
    const [row] = await tx<{ n: number }[]>`
      WITH batch AS (
        SELECT c.id, c.public_id, c.caption, c.docket_number, c.official_citation
        FROM legal_case c
        WHERE c.publication = 'published'
          AND NOT EXISTS (SELECT 1 FROM public_case_search search WHERE search.case_id = c.id)
        LIMIT ${limit}
      ), written AS (
        INSERT INTO public_case_search (case_id, public_id, search_text, refreshed_at)
        SELECT batch.id, batch.public_id, ${tx.unsafe(SEARCH_TEXT)}, now()
        FROM batch
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM written
    `;
    return row?.n ?? 0;
  });
}

export async function refreshPublicCaseSearch(sql: Sql, options: CaseSearchRefreshOptions = {}): Promise<CaseSearchRefreshResult> {
  const batchSize = options.batchSize ?? SEARCH_BATCH;
  const pauseMs = options.pauseMs ?? 200;
  const log = options.log ?? ((event) => console.log(JSON.stringify(event)));
  const [state] = await sql<{ cursor: string | null; completed: boolean }[]>`
    SELECT sweep_cursor AS cursor, sweep_completed_at IS NOT NULL AS completed
    FROM public_case_search_state WHERE id = 1
  `;
  const ready = state?.completed ?? false;
  const maxBatches = ready ? options.maxBatches ?? 150 : options.initialMaxBatches ?? 5000;
  log({ caseSearch: "start", ready, cursor: state?.cursor ?? null, batchSize, maxBatches, pauseMs });

  const result: CaseSearchRefreshResult = { added: 0, written: 0, scanned: 0, removed: 0, sweepCompleted: false };

  // New publications first, so they become searchable within one interval.
  if (ready) {
    for (let i = 0; i < NEW_CASE_BATCHES; i += 1) {
      const added = await addNewlyPublished(sql, batchSize);
      result.added += added;
      if (added < batchSize) break;
      if (pauseMs > 0) await sleep(pauseMs);
    }
    log({ caseSearch: "new-cases", added: result.added });
  }

  let cursor = state?.cursor ?? null;
  if (cursor === null) await sql`UPDATE public_case_search_state SET sweep_started_at = now(), updated_at = now() WHERE id = 1`;
  for (let i = 0; i < maxBatches; i += 1) {
    const batch = await upsertSweepBatch(sql, cursor, batchSize);
    result.scanned += batch.seen;
    result.written += batch.written;
    result.removed += batch.removed;
    if (batch.end) {
      cursor = null;
      result.sweepCompleted = true;
      await sql`
        UPDATE public_case_search_state
        SET sweep_cursor = NULL, sweep_completed_at = now(), updated_at = now()
        WHERE id = 1
      `;
      log({ caseSearch: "sweep-complete", scanned: result.scanned, written: result.written, removed: result.removed });
      break;
    }
    cursor = batch.last;
    await sql`UPDATE public_case_search_state SET sweep_cursor = ${cursor}, updated_at = now() WHERE id = 1`;
    if (i % 25 === 0) log({ caseSearch: "batch", cursor, scanned: result.scanned, written: result.written });
    if (pauseMs > 0) await sleep(pauseMs);
  }
  log({ caseSearch: "done", ...result });
  return result;
}

const READY_TTL_MS = 60_000;
let readyMemo: { value: boolean; at: number } | null = null;

/** True once one full sweep has filled public_case_search. Memoized for a minute per process. */
export async function publicCaseSearchReady(sql: Sql, now = Date.now()): Promise<boolean> {
  if (readyMemo && now - readyMemo.at < READY_TTL_MS) return readyMemo.value;
  let value = false;
  try {
    const [row] = await sql<{ ready: boolean }[]>`
      SELECT sweep_completed_at IS NOT NULL AS ready FROM public_case_search_state WHERE id = 1
    `;
    value = row?.ready ?? false;
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "42P01") throw error;
  }
  readyMemo = { value, at: now };
  return value;
}

export function resetPublicCaseSearchReadyMemo() {
  readyMemo = null;
}
