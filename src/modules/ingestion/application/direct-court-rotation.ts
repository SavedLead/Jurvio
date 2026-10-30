import type postgres from "postgres";
import type { FederalCourtSource } from "../providers/courts/registry";
import { federalCourtByCode } from "../providers/courts/registry";

type Sql = ReturnType<typeof postgres>;

export interface DirectRegistryRow {
  court_code: string;
  court_name: string;
  jurvio_court_code: string;
  court_type: "district" | "appellate" | "bankruptcy";
  circuit: string | null;
  official_website: string | null;
  cmecf_base_url: string;
  rss_url: string | null;
  rss_coverage_hours: number | null;
  included_event_categories: string[] | null;
  pacer_court_id: string | null;
  time_zone: string | null;
  polling_minutes: number | null;
}

/** The checked-in registry entry when there is one, otherwise the database row. */
export function courtSourceFromRow(row: DirectRegistryRow): FederalCourtSource {
  const known = federalCourtByCode(row.court_code);
  if (known) return known;
  return {
    name: row.court_name,
    jurvioCourtCode: row.jurvio_court_code,
    officialCourtCode: row.court_code,
    courtType: row.court_type,
    circuit: (row.circuit ?? "").replace(/^0+/, ""),
    officialWebsite: row.official_website ?? row.cmecf_base_url,
    cmecfBaseUrl: row.cmecf_base_url,
    rssUrl: row.rss_url,
    rssAvailable: true,
    rssCoverageWindowHours: row.rss_coverage_hours ?? 24,
    includedEventCategories: row.included_event_categories?.length ? row.included_event_categories : ["all"],
    pacerCourtId: row.pacer_court_id ?? row.court_code,
    opinionUrl: null,
    calendarUrl: null,
    timeZone: row.time_zone && row.time_zone !== "UTC" ? row.time_zone : "America/New_York",
    pollingMinutes: row.polling_minutes ?? 5,
    adapterType: "cmecf-rss-v1",
  };
}

/**
 * Enabled courts not visited in the last `minIntervalMinutes`, least
 * recently retrieved first (never-retrieved first of all). A court that keeps failing waits longer before it is retried
 * (5 min x 2^failures, capped at 6 h) so a dead server does not take a slot
 * every run.
 */
export async function selectDirectCourtsDue(sql: Sql, options: { maxCourts: number; only?: string | null; minIntervalMinutes?: number }) {
  const minInterval = Math.max(0, options.minIntervalMinutes ?? 120);
  const rows = await sql<DirectRegistryRow[]>`
    SELECT court_code, court_name, jurvio_court_code, court_type, circuit, official_website, cmecf_base_url,
      rss_url, rss_coverage_hours, included_event_categories, pacer_court_id, time_zone, polling_minutes
    FROM direct_court_registry
    WHERE rss_available AND rss_url IS NOT NULL
      AND (${options.only ?? null}::text IS NULL OR court_code = ${options.only ?? null})
      AND (${options.only ?? null}::text IS NOT NULL OR consecutive_failures = 0
        OR updated_at < now() - least(interval '6 hours', interval '5 minutes' * power(2, least(consecutive_failures, 7))))
      -- Feeds cover the last 24 hours, so a visit every couple of hours misses
      -- nothing and keeps requests and stored feed copies low.
      AND (${options.only ?? null}::text IS NOT NULL OR last_successful_retrieval IS NULL
        OR last_successful_retrieval < now() - make_interval(mins => ${minInterval}))
    ORDER BY last_successful_retrieval NULLS FIRST, court_code
    LIMIT ${options.maxCourts}
  `;
  return rows.map(courtSourceFromRow);
}
