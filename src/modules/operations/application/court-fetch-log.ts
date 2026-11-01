/**
 * Per-request health log for every court fetch (court_fetch_log). Feed jobs
 * call recordCourtFetch once per HTTP request, success or failure, before any
 * error is rethrown, so a 404 or a timeout is visible per court and source.
 *
 * The baseline is the average item count of this court + source + URL's
 * successful fetches on the same weekday over the last 28 days. A fetch that
 * parses 0 items when that baseline is 5 or more is flagged zero_vs_baseline:
 * the usual sign that a court changed its page and the parser no longer matches.
 *
 * Logging never breaks ingestion: a failed insert is swallowed (and counted
 * in the caller's run output by the returned false).
 */
import type postgres from "postgres";

type Sql = ReturnType<typeof postgres> | postgres.TransactionSql;

export const ZERO_BASELINE_MIN_ITEMS = 5;

export type CourtFetchSource =
  | "district_rss" | "coa_feed" | "appellate_official" | "govinfo" | "court_site" | "appellate_pacer_rss";

export interface CourtFetchRecord {
  source: CourtFetchSource;
  courtCode: string;
  url: string;
  startedAtMs: number;
  httpStatus: number | null;
  ok: boolean;
  error?: string | null;
  bytes?: number | null;
  items?: number | null;
  newItems?: number | null;
}

/** An HTTP response that was not usable, with its status kept for the log. */
export class CourtFetchHttpError extends Error {
  constructor(readonly url: string, readonly status: number, label?: string) {
    super(`${label ?? url} returned HTTP ${status}`);
    this.name = "CourtFetchHttpError";
  }
}

export function httpStatusOf(error: unknown): number | null {
  if (error instanceof CourtFetchHttpError) return error.status;
  const match = /\bHTTP (\d{3})\b/.exec(error instanceof Error ? error.message : String(error));
  return match ? Number(match[1]) : null;
}

export function errorText(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 500);
}

/** Pure: is this fetch "zero items where we normally see some"? */
export function isZeroVsBaseline(ok: boolean, items: number | null | undefined, baseline: number | null | undefined): boolean {
  return ok && (items ?? 0) === 0 && baseline != null && baseline >= ZERO_BASELINE_MIN_ITEMS;
}

export async function recordCourtFetch(sql: Sql, record: CourtFetchRecord): Promise<boolean> {
  const durationMs = Math.max(0, Date.now() - record.startedAtMs);
  const items = record.items ?? null;
  try {
    await sql`
      WITH baseline AS (
        SELECT avg(items)::numeric(10, 2) AS value
        FROM court_fetch_log
        WHERE court_code = ${record.courtCode.toLowerCase()} AND source = ${record.source}
          AND url = ${record.url} AND ok AND items IS NOT NULL
          AND fetched_at > now() - interval '28 days'
          AND extract(isodow FROM fetched_at) = extract(isodow FROM now())
      )
      INSERT INTO court_fetch_log (source, court_code, url, duration_ms, http_status, ok, error, bytes, items,
        new_items, baseline_items, zero_vs_baseline)
      SELECT ${record.source}, ${record.courtCode.toLowerCase()}, ${record.url.slice(0, 1000)}, ${durationMs},
        ${record.httpStatus}, ${record.ok}, ${record.error ? record.error.slice(0, 500) : null}, ${record.bytes ?? null},
        ${items}, ${record.newItems ?? null}, baseline.value,
        (${record.ok} AND coalesce(${items}::int, 0) = 0 AND coalesce(baseline.value, 0) >= ${ZERO_BASELINE_MIN_ITEMS})
      FROM baseline
    `;
    return true;
  } catch {
    return false;
  }
}

/** Retention for the log: delete rows older than `days` in bounded batches. */
export async function pruneCourtFetchLog(sql: Sql, options: { days?: number; batch?: number; maxBatches?: number } = {}) {
  const days = options.days ?? 35;
  const batch = options.batch ?? 20_000;
  let deleted = 0;
  for (let index = 0; index < (options.maxBatches ?? 10); index += 1) {
    const rows = await sql`
      DELETE FROM court_fetch_log WHERE id IN (
        SELECT id FROM court_fetch_log WHERE fetched_at < now() - make_interval(days => ${days}) LIMIT ${batch}
      )
    `;
    deleted += rows.count;
    if (rows.count < batch) break;
  }
  return { deleted };
}
