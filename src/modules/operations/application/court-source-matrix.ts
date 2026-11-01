/**
 * Court x source matrix: sync the catalog into court_source, and read the
 * matrix (available, enabled, last success, items in the last 24 h, health
 * flags) from court_source + court_fetch_log. Used by /internal/freshness, the
 * court-freshness job and the read-only matrix report workflow.
 */
import type postgres from "postgres";
import { catalogRows, COURT_SOURCE_LABELS, type CourtSourceKey } from "../domain/court-sources";

type Sql = ReturnType<typeof postgres> | postgres.TransactionSql;

export async function syncCourtSources(sql: Sql): Promise<{ rows: number }> {
  const districts = await sql<{ court_code: string; rss_url: string | null; rss_available: boolean; included: string }[]>`
    SELECT court_code, rss_url, rss_available, included_event_categories::text AS included
    FROM direct_court_registry WHERE court_type = 'district' ORDER BY court_code
  `;
  const rows = [
    ...districts.map((row) => ({
      courtCode: row.court_code, source: "district_rss" as CourtSourceKey, url: row.rss_url,
      // The court publishes no public feed when rss_available is false (empty body at rss_outside.pl).
      available: row.rss_available, enabled: row.rss_available && Boolean(row.rss_url),
      note: row.rss_available
        ? (row.included.includes("\"all\"") ? "all entry types" : `partial: ${row.included}`)
        : "court publishes no public RSS",
    })),
    ...catalogRows(districts.map((row) => row.court_code)),
  ];
  for (const row of rows) {
    await sql`
      INSERT INTO court_source (court_code, source, label, url, available, enabled, note, updated_at)
      VALUES (${row.courtCode}, ${row.source}, ${COURT_SOURCE_LABELS[row.source]}, ${row.url}, ${row.available},
        ${row.enabled}, ${row.note}, now())
      ON CONFLICT (court_code, source) DO UPDATE SET label = EXCLUDED.label, url = EXCLUDED.url,
        available = EXCLUDED.available, enabled = EXCLUDED.enabled, note = EXCLUDED.note, updated_at = now()
    `;
  }
  return { rows: rows.length };
}

export type SourceHealth = "ok" | "zero_vs_baseline" | "failing" | "stale" | "never" | "off";

export interface CourtSourceMatrixRow {
  courtCode: string;
  source: string;
  label: string;
  url: string | null;
  available: boolean;
  enabled: boolean;
  note: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastHttpStatus: number | null;
  lastError: string | null;
  fetches24h: number;
  failures24h: number;
  itemsLast: number | null;
  items24h: number;
  newItems24h: number;
  consecutiveFailures: number;
  zeroVsBaseline: boolean;
  health: SourceHealth;
}

/** Pure: one status word per cell. */
export function sourceHealth(row: Pick<CourtSourceMatrixRow, "enabled" | "lastSuccessAt" | "lastAttemptAt" | "consecutiveFailures" | "zeroVsBaseline">, now = new Date()): SourceHealth {
  if (!row.enabled) return "off";
  if (!row.lastAttemptAt) return "never";
  if (row.consecutiveFailures >= 3) return "failing";
  if (row.zeroVsBaseline) return "zero_vs_baseline";
  if (!row.lastSuccessAt || now.getTime() - new Date(row.lastSuccessAt).getTime() > 26 * 3_600_000) return "stale";
  return "ok";
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function getCourtSourceMatrix(sql: Sql, now = new Date()): Promise<CourtSourceMatrixRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    WITH recent AS (
      SELECT court_code, source,
        count(*) AS fetches_24h,
        count(*) FILTER (WHERE NOT ok) AS failures_24h,
        coalesce(sum(items) FILTER (WHERE ok), 0) AS items_24h,
        coalesce(sum(new_items) FILTER (WHERE ok), 0) AS new_items_24h
      FROM court_fetch_log WHERE fetched_at > now() - interval '24 hours'
      GROUP BY 1, 2
    ), latest AS (
      SELECT DISTINCT ON (court_code, source) court_code, source, fetched_at, http_status, ok, error, items, zero_vs_baseline
      FROM court_fetch_log WHERE fetched_at > now() - interval '35 days'
      ORDER BY court_code, source, fetched_at DESC
    ), success AS (
      SELECT court_code, source, max(fetched_at) AS last_success_at
      FROM court_fetch_log WHERE ok AND fetched_at > now() - interval '35 days' GROUP BY 1, 2
    ), streak AS (
      SELECT log.court_code, log.source, count(*) AS consecutive_failures
      FROM court_fetch_log log
      LEFT JOIN success ON success.court_code = log.court_code AND success.source = log.source
      WHERE NOT log.ok AND log.fetched_at > coalesce(success.last_success_at, now() - interval '35 days')
      GROUP BY 1, 2
    )
    SELECT cs.court_code, cs.source, cs.label, cs.url, cs.available, cs.enabled, cs.note,
      coalesce(success.last_success_at, wm.last_success_at) AS last_success_at,
      coalesce(latest.fetched_at, wm.last_attempt_at) AS last_attempt_at,
      latest.http_status, coalesce(latest.error, wm.last_error) AS last_error,
      coalesce(recent.fetches_24h, 0) AS fetches_24h, coalesce(recent.failures_24h, 0) AS failures_24h,
      latest.items AS items_last, coalesce(recent.items_24h, 0) AS items_24h,
      coalesce(recent.new_items_24h, 0) AS new_items_24h,
      greatest(coalesce(streak.consecutive_failures, 0), coalesce(wm.consecutive_failures, 0)) AS consecutive_failures,
      coalesce(latest.zero_vs_baseline, false) AS zero_vs_baseline
    FROM court_source cs
    LEFT JOIN recent ON recent.court_code = cs.court_code AND recent.source = cs.source
    LEFT JOIN latest ON latest.court_code = cs.court_code AND latest.source = cs.source
    LEFT JOIN success ON success.court_code = cs.court_code AND success.source = cs.source
    LEFT JOIN streak ON streak.court_code = cs.court_code AND streak.source = cs.source
    LEFT JOIN court_source_watermark wm ON wm.court_code = cs.court_code AND wm.source = cs.source
    ORDER BY cs.court_code, cs.source
  `;
  return rows.map((row) => {
    const view = {
      courtCode: String(row.court_code), source: String(row.source), label: String(row.label),
      url: row.url == null ? null : String(row.url), available: Boolean(row.available), enabled: Boolean(row.enabled),
      note: row.note == null ? null : String(row.note),
      lastSuccessAt: iso(row.last_success_at), lastAttemptAt: iso(row.last_attempt_at),
      lastHttpStatus: row.http_status == null ? null : Number(row.http_status),
      lastError: row.last_error == null ? null : String(row.last_error),
      fetches24h: Number(row.fetches_24h ?? 0), failures24h: Number(row.failures_24h ?? 0),
      itemsLast: row.items_last == null ? null : Number(row.items_last),
      items24h: Number(row.items_24h ?? 0), newItems24h: Number(row.new_items_24h ?? 0),
      consecutiveFailures: Number(row.consecutive_failures ?? 0), zeroVsBaseline: Boolean(row.zero_vs_baseline),
    };
    return { ...view, health: sourceHealth(view, now) };
  });
}
