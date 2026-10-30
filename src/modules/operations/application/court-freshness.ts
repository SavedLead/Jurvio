import type postgres from "postgres";
import type { CourtFreshnessRow, CourtType } from "../domain/court-freshness";

type Sql = ReturnType<typeof postgres> | postgres.TransactionSql;

export type WatermarkSource = "bulk" | "scotus_official" | "coa_feed" | "district_rss" | "courtlistener";

/**
 * Recompute court_freshness rows. With `courtCodes`, only those courts are
 * recomputed (index lookups on legal_case.court_id), which is what the feed
 * jobs call after a run. Without it, all ~108 tracked courts are recomputed in
 * one grouped pass; the core-lane `court-freshness` job does that every 30
 * minutes. Page requests never run this.
 */
export async function refreshCourtFreshness(
  sql: Sql,
  options: { courtCodes?: readonly string[] } = {},
): Promise<{ courts: number }> {
  const only = options.courtCodes?.map((code) => code.trim().toLowerCase()).filter(Boolean) ?? null;
  if (only && only.length === 0) return { courts: 0 };
  const rows = await sql<{ court_code: string }[]>`
    WITH universe AS (
      SELECT 'scotus'::text AS court_code, 'supreme'::text AS court_type,
        'Supreme Court of the United States'::text AS name, NULL::text AS circuit, true AS feed_available
      UNION ALL
      SELECT court_code, 'appellate', court_name, circuit, true FROM appellate_source_registry
      UNION ALL
      SELECT court_code, 'district', court_name, circuit, rss_available
      FROM direct_court_registry WHERE court_type = 'district'
    ), selected AS (
      SELECT * FROM universe
      WHERE ${only === null} OR court_code = ANY(${only ?? []}::text[])
    ), court_rows AS (
      SELECT court.id, lower(court.provider_court_id) AS court_code
      FROM court
      WHERE court.provider_court_id IS NOT NULL
        AND lower(court.provider_court_id) IN (SELECT court_code FROM selected)
    ), cases AS (
      SELECT court_rows.court_code,
        count(*) AS case_count,
        count(*) FILTER (WHERE legal_case.publication = 'published') AS published_count,
        count(*) FILTER (WHERE legal_case.publication = 'draft') AS draft_count,
        count(*) FILTER (WHERE legal_case.publication IN ('restricted', 'suppressed')) AS withheld_count,
        max(COALESCE(legal_case.filed_on, legal_case.decided_on))
          FILTER (WHERE COALESCE(legal_case.filed_on, legal_case.decided_on) <= current_date + 1) AS newest_filed_on,
        max(legal_case.created_at) AS newest_case_created_at
      FROM court_rows
      JOIN legal_case ON legal_case.court_id = court_rows.id
      GROUP BY court_rows.court_code
    ), marks AS (
      SELECT court_code,
        max(last_success_at) FILTER (WHERE source = 'bulk') AS bulk_at,
        max(last_success_at) FILTER (WHERE source IN ('scotus_official', 'coa_feed', 'district_rss')) AS feed_at,
        max(consecutive_failures) FILTER (WHERE source IN ('scotus_official', 'coa_feed', 'district_rss')) AS feed_failures,
        max(last_success_at) FILTER (WHERE source = 'courtlistener') AS courtlistener_at,
        max(retry_after_until) FILTER (WHERE source = 'courtlistener' AND retry_after_until > now()) AS courtlistener_retry_after
      FROM court_source_watermark
      WHERE court_code IN (SELECT court_code FROM selected)
      GROUP BY court_code
    ), scotus_feed AS (
      SELECT run.completed_at
      FROM ingestion_run run
      JOIN provider ON provider.id = run.provider_id AND provider.code = 'scotus_official'
      WHERE run.run_type = 'official_scotus_slip_opinions'
        AND run.status IN ('completed', 'completed_with_errors')
        AND run.completed_at IS NOT NULL
      ORDER BY run.started_at DESC
      LIMIT 1
    ), registry AS (
      SELECT court_code, last_successful_retrieval, health_state, consecutive_failures FROM appellate_source_registry
      UNION ALL
      SELECT court_code, last_successful_retrieval, health_state, consecutive_failures
      FROM direct_court_registry WHERE court_type = 'district'
    )
    INSERT INTO court_freshness (
      court_code, court_type, name, circuit, case_count, published_count, draft_count, withheld_count,
      newest_filed_on, newest_case_created_at, last_bulk_at, last_feed_at, last_courtlistener_at,
      feed_available, feed_health, feed_failures, courtlistener_retry_after, refreshed_at
    )
    SELECT selected.court_code, selected.court_type, selected.name, selected.circuit,
      COALESCE(cases.case_count, 0), COALESCE(cases.published_count, 0),
      COALESCE(cases.draft_count, 0), COALESCE(cases.withheld_count, 0),
      cases.newest_filed_on, cases.newest_case_created_at,
      marks.bulk_at,
      GREATEST(marks.feed_at, registry.last_successful_retrieval,
        CASE WHEN selected.court_code = 'scotus' THEN (SELECT completed_at FROM scotus_feed) END),
      marks.courtlistener_at,
      selected.feed_available,
      CASE WHEN COALESCE(marks.feed_failures, 0) >= 3 THEN 'degraded' ELSE registry.health_state END,
      GREATEST(COALESCE(marks.feed_failures, 0), COALESCE(registry.consecutive_failures, 0)),
      marks.courtlistener_retry_after,
      now()
    FROM selected
    LEFT JOIN cases ON cases.court_code = selected.court_code
    LEFT JOIN marks ON marks.court_code = selected.court_code
    LEFT JOIN registry ON registry.court_code = selected.court_code
    ON CONFLICT (court_code) DO UPDATE SET
      court_type = EXCLUDED.court_type, name = EXCLUDED.name, circuit = EXCLUDED.circuit,
      case_count = EXCLUDED.case_count, published_count = EXCLUDED.published_count,
      draft_count = EXCLUDED.draft_count, withheld_count = EXCLUDED.withheld_count,
      newest_filed_on = EXCLUDED.newest_filed_on, newest_case_created_at = EXCLUDED.newest_case_created_at,
      last_bulk_at = EXCLUDED.last_bulk_at, last_feed_at = EXCLUDED.last_feed_at,
      last_courtlistener_at = EXCLUDED.last_courtlistener_at, feed_available = EXCLUDED.feed_available,
      feed_health = EXCLUDED.feed_health, feed_failures = EXCLUDED.feed_failures,
      courtlistener_retry_after = EXCLUDED.courtlistener_retry_after, refreshed_at = EXCLUDED.refreshed_at
    RETURNING court_code
  `;
  return { courts: rows.length };
}

export interface WatermarkUpdate {
  source: WatermarkSource;
  courtCode: string;
  ok: boolean;
  cursor?: string | null;
  itemsFetched?: number;
  newCases?: number;
  newEntries?: number;
  newestItemAt?: string | null;
  retryAfterUntil?: string | null;
  error?: string | null;
}

/** Record one source's attempt for one court. Never lowers a stored cursor to null. */
export async function recordSourceWatermark(sql: Sql, update: WatermarkUpdate): Promise<void> {
  const items = update.itemsFetched ?? 0;
  const newCases = update.newCases ?? 0;
  const newEntries = update.newEntries ?? 0;
  const gotNew = newCases + newEntries > 0;
  const error = update.error ? update.error.slice(0, 500) : null;
  await sql`
    INSERT INTO court_source_watermark (
      source, court_code, cursor_value, last_attempt_at, last_success_at, last_new_item_at, newest_item_at,
      items_fetched_last, new_cases_last, new_entries_last, items_fetched_total,
      consecutive_failures, retry_after_until, last_error, updated_at
    ) VALUES (
      ${update.source}, ${update.courtCode.toLowerCase()}, ${update.cursor ?? null}, now(),
      ${update.ok ? sql`now()` : null}, ${gotNew ? sql`now()` : null}, ${update.newestItemAt ?? null},
      ${items}, ${newCases}, ${newEntries}, ${items},
      ${update.ok ? 0 : 1}, ${update.retryAfterUntil ?? null}, ${error}, now()
    )
    ON CONFLICT (source, court_code) DO UPDATE SET
      cursor_value = COALESCE(EXCLUDED.cursor_value, court_source_watermark.cursor_value),
      last_attempt_at = now(),
      last_success_at = COALESCE(EXCLUDED.last_success_at, court_source_watermark.last_success_at),
      last_new_item_at = COALESCE(EXCLUDED.last_new_item_at, court_source_watermark.last_new_item_at),
      newest_item_at = GREATEST(EXCLUDED.newest_item_at, court_source_watermark.newest_item_at),
      items_fetched_last = EXCLUDED.items_fetched_last,
      new_cases_last = EXCLUDED.new_cases_last,
      new_entries_last = EXCLUDED.new_entries_last,
      items_fetched_total = court_source_watermark.items_fetched_total + EXCLUDED.items_fetched_last,
      consecutive_failures = CASE WHEN ${update.ok} THEN 0 ELSE court_source_watermark.consecutive_failures + 1 END,
      retry_after_until = EXCLUDED.retry_after_until,
      last_error = EXCLUDED.last_error,
      updated_at = now()
  `;
}

export async function readSourceWatermark(sql: Sql, source: WatermarkSource, courtCode: string) {
  const [row] = await sql<{
    cursor_value: string | null;
    last_success_at: string | null;
    retry_after_until: string | null;
    consecutive_failures: number;
  }[]>`
    SELECT cursor_value, last_success_at::text, retry_after_until::text, consecutive_failures
    FROM court_source_watermark WHERE source = ${source} AND court_code = ${courtCode.toLowerCase()}
  `;
  return row ?? null;
}

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function dateOnly(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export interface SourceWatermarkView {
  source: WatermarkSource;
  courtCode: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  itemsFetchedLast: number;
  newCasesLast: number;
  newEntriesLast: number;
  consecutiveFailures: number;
  retryAfterUntil: string | null;
  lastError: string | null;
}

export interface CourtFreshnessSnapshot {
  available: boolean;
  rows: CourtFreshnessRow[];
  sources: SourceWatermarkView[];
}

/** Page read: ~108 primary-key rows plus the watermark table. No aggregates over the corpus. */
export async function getCourtFreshness(sql: Sql): Promise<CourtFreshnessSnapshot> {
  try {
    const [rows, sources] = await Promise.all([
      sql<Record<string, unknown>[]>`
        SELECT court_code, court_type, name, circuit, case_count, published_count, draft_count, withheld_count,
          newest_filed_on::text, newest_case_created_at, last_bulk_at, last_feed_at, last_courtlistener_at,
          feed_available, feed_health, feed_failures, courtlistener_retry_after, refreshed_at
        FROM court_freshness
      `,
      sql<Record<string, unknown>[]>`
        SELECT source, court_code, last_success_at, last_attempt_at, items_fetched_last, new_cases_last,
          new_entries_last, consecutive_failures, retry_after_until, last_error
        FROM court_source_watermark
      `,
    ]);
    return {
      available: true,
      rows: rows.map((row) => ({
        courtCode: String(row.court_code),
        courtType: String(row.court_type) as CourtType,
        name: String(row.name),
        circuit: row.circuit == null ? null : String(row.circuit),
        caseCount: Number(row.case_count ?? 0),
        publishedCount: Number(row.published_count ?? 0),
        draftCount: Number(row.draft_count ?? 0),
        withheldCount: Number(row.withheld_count ?? 0),
        newestFiledOn: dateOnly(row.newest_filed_on as string | null),
        newestCaseCreatedAt: iso(row.newest_case_created_at as string | null),
        lastBulkAt: iso(row.last_bulk_at as string | null),
        lastFeedAt: iso(row.last_feed_at as string | null),
        lastCourtListenerAt: iso(row.last_courtlistener_at as string | null),
        feedAvailable: Boolean(row.feed_available),
        feedHealth: row.feed_health == null ? null : String(row.feed_health),
        feedFailures: Number(row.feed_failures ?? 0),
        courtListenerRetryAfter: iso(row.courtlistener_retry_after as string | null),
        refreshedAt: iso(row.refreshed_at as string) ?? new Date(0).toISOString(),
      })),
      sources: sources.map((row) => ({
        source: String(row.source) as WatermarkSource,
        courtCode: String(row.court_code),
        lastSuccessAt: iso(row.last_success_at as string | null),
        lastAttemptAt: iso(row.last_attempt_at as string | null),
        itemsFetchedLast: Number(row.items_fetched_last ?? 0),
        newCasesLast: Number(row.new_cases_last ?? 0),
        newEntriesLast: Number(row.new_entries_last ?? 0),
        consecutiveFailures: Number(row.consecutive_failures ?? 0),
        retryAfterUntil: iso(row.retry_after_until as string | null),
        lastError: row.last_error == null ? null : String(row.last_error),
      })),
    };
  } catch {
    // Table not migrated yet: render the empty state instead of a 500.
    return { available: false, rows: [], sources: [] };
  }
}
