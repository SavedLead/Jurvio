import type postgres from "postgres";
import { FEDERAL_COURT_REGISTRY_IDS } from "../domain/federal-court-registry";
import { isRestrictedDocketText } from "../domain/federal-stream";
import { courtCodeFromUrl } from "../live-feeds/courtlistener-tail";
import {
  CourtListenerRateLimited,
  fetchDocketPage,
  setCourtListenerRequestPolicy,
} from "../providers/courtlistener/client";
import type { CourtListenerDocket } from "../providers/courtlistener/schema";
import type { CourtListenerBulkDocket } from "../providers/courtlistener/bulk-dockets";
import {
  type FilingFamily,
  filingFamilyForCourt,
  persistFilingRows,
  selectBackfillRow,
} from "./backfill-filing-window";

type Sql = ReturnType<typeof postgres>;

/** Leaves the 80-request follow budget under the documented 125-request day. */
export const RECENT_FILING_DAILY_REQUESTS = 40;
export const RECENT_FILING_INTERVAL_MS = 12_500;

export function shiftIsoDay(day: string, days: number): string {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Dates the snapshot cannot contain: the later of the day after the snapshot and the window start, through yesterday. */
export function recentFilingBounds(
  snapshotDate: string,
  today: string,
  windowDays: number,
): { filedOnOrAfter: string; filedBefore: string } | null {
  const windowStart = shiftIsoDay(today, -windowDays);
  const filedOnOrAfter = shiftIsoDay(snapshotDate, 1) > windowStart ? shiftIsoDay(snapshotDate, 1) : windowStart;
  if (filedOnOrAfter >= today) return null;
  return { filedOnOrAfter, filedBefore: today };
}

export function courtCodesForFamily(family: FilingFamily): string[] {
  return FEDERAL_COURT_REGISTRY_IDS.filter((id) => filingFamilyForCourt(id) === family);
}

export function recentDocketListUrl(baseUrl: string, family: FilingFamily, bounds: { filedOnOrAfter: string; filedBefore: string }): string {
  const url = new URL("dockets/", `${baseUrl.replace(/\/+$/, "")}/`);
  url.searchParams.set("date_filed__gte", bounds.filedOnOrAfter);
  url.searchParams.set("date_filed__lt", bounds.filedBefore);
  url.searchParams.set("court__jurisdiction__in", family === "appeals" ? "F" : "FD");
  url.searchParams.set("order_by", "date_filed,id");
  url.searchParams.set("page_size", "20");
  return url.toString();
}

export function recentFilingStreamName(family: FilingFamily, bounds: { filedOnOrAfter: string; filedBefore: string }): string {
  return `courtlistener:filing-recent:v1:${family}:${bounds.filedOnOrAfter}:${bounds.filedBefore}`;
}

export function bulkDocketFromApi(record: CourtListenerDocket): CourtListenerBulkDocket | null {
  const courtId = courtCodeFromUrl(record.court);
  if (!courtId || !record.date_filed) return null;
  return {
    id: String(record.id),
    court_id: courtId,
    docket_number: record.docket_number,
    case_name: record.case_name,
    case_name_full: record.case_name_full ?? null,
    date_filed: record.date_filed,
    cause: record.cause,
    nature_of_suit: record.nature_of_suit,
    jury_demand: record.jury_demand,
    assigned_to_str: record.assigned_to_str,
    referred_to_str: record.referred_to_str,
    date_modified: record.date_modified,
  };
}

export interface RecentFilingCheckpoint {
  version: 1;
  nextUrl: string | null;
  requests: number;
  inserted: number;
  filledDate: number;
  alreadyPresent: number;
  stopped: "complete" | "quota" | null;
}

interface RecentPage {
  records: CourtListenerDocket[];
  next: string | null;
}

/**
 * One CourtListener list page per request. Stops when the list ends or the
 * caller has no requests left. The next URL is the resume point.
 */
export async function walkRecentDocketPages(input: {
  startUrl: string;
  quota: number;
  family: FilingFamily;
  today: string;
  windowDays: number;
  fetchPage: (url: string) => Promise<RecentPage>;
  persist: (records: CourtListenerDocket[]) => Promise<{ inserted: number; filledDate: number; alreadyPresent: number }>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<RecentFilingCheckpoint> {
  const checkpoint: RecentFilingCheckpoint = {
    version: 1, nextUrl: input.startUrl, requests: 0, inserted: 0, filledDate: 0, alreadyPresent: 0, stopped: null,
  };
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  while (checkpoint.nextUrl) {
    if (checkpoint.requests >= input.quota) {
      checkpoint.stopped = "quota";
      return checkpoint;
    }
    if (checkpoint.requests > 0) await sleep(RECENT_FILING_INTERVAL_MS);
    let page: RecentPage;
    try {
      page = await input.fetchPage(checkpoint.nextUrl);
    } catch (error) {
      if (error instanceof CourtListenerRateLimited) {
        checkpoint.stopped = "quota";
        return checkpoint;
      }
      throw error;
    }
    checkpoint.requests += 1;
    const written = await input.persist(page.records);
    checkpoint.inserted += written.inserted;
    checkpoint.filledDate += written.filledDate;
    checkpoint.alreadyPresent += written.alreadyPresent;
    checkpoint.nextUrl = page.next;
  }
  checkpoint.stopped = "complete";
  return checkpoint;
}

async function takeRecentRequest(sql: Sql): Promise<boolean> {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const stream = `courtlistener:filing-recent-quota:${day}`;
  const [row] = await sql<{ n: number }[]>`
    INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
    SELECT id, ${stream}, '1' FROM provider WHERE code = 'courtlistener'
    ON CONFLICT (provider_id, stream_name) DO UPDATE
      SET cursor_value = (ingestion_checkpoint.cursor_value::int + 1)::text, updated_at = now()
      WHERE ingestion_checkpoint.cursor_value::int + 1 <= ${RECENT_FILING_DAILY_REQUESTS}
    RETURNING cursor_value::int AS n
  `;
  return Boolean(row);
}

export interface StoredFeedFill {
  filledDate: number;
  inserted: number;
  alreadyPresent: number;
}

/** Cases the free court feeds already stored, for dates the snapshot does not contain. */
export async function fillStoredFeedFilings(sql: Sql, input: {
  providerId: string;
  family: FilingFamily;
  bounds: { filedOnOrAfter: string; filedBefore: string };
  today: string;
  windowDays: number;
}): Promise<StoredFeedFill> {
  const codes = courtCodesForFamily(input.family);
  const summary: StoredFeedFill = { filledDate: 0, inserted: 0, alreadyPresent: 0 };
  const filledEvents = await sql<{ id: string }[]>`
    UPDATE legal_case AS c
    SET filed_on = src.filed_on, updated_at = c.updated_at
    FROM (
      SELECT e.case_id,
        min((e.official_filed_at AT TIME ZONE COALESCE(NULLIF(reg.time_zone, ''), 'America/New_York'))::date) AS filed_on
      FROM direct_court_event e
      LEFT JOIN direct_court_registry reg ON reg.court_code = e.court_code
      WHERE e.restricted = false AND e.case_id IS NOT NULL AND e.court_code = ANY(${codes}::text[])
      GROUP BY e.case_id
    ) src
    WHERE c.id = src.case_id AND c.filed_on IS NULL
      AND src.filed_on >= ${input.bounds.filedOnOrAfter}::date
      AND src.filed_on < ${input.bounds.filedBefore}::date
    RETURNING c.id
  `;
  const filledItems = await sql<{ id: string }[]>`
    UPDATE legal_case AS c
    SET filed_on = item.issued_on, updated_at = c.updated_at
    FROM free_source_item item
    WHERE item.case_id = c.id AND item.outcome = 'new_case' AND c.filed_on IS NULL
      AND item.court_code = ANY(${codes}::text[])
      AND item.issued_on >= ${input.bounds.filedOnOrAfter}::date
      AND item.issued_on < ${input.bounds.filedBefore}::date
    RETURNING c.id
  `;
  summary.filledDate = filledEvents.length + filledItems.length;
  const events = await sql<{ court_code: string; docket_number: string; caption: string; filed_on: string }[]>`
    SELECT DISTINCT ON (e.court_code, e.docket_number)
      e.court_code, e.docket_number, e.caption,
      (e.official_filed_at AT TIME ZONE COALESCE(NULLIF(reg.time_zone, ''), 'America/New_York'))::date::text AS filed_on
    FROM direct_court_event e
    LEFT JOIN direct_court_registry reg ON reg.court_code = e.court_code
    WHERE e.restricted = false AND e.case_id IS NULL AND e.court_code = ANY(${codes}::text[])
      AND (e.official_filed_at AT TIME ZONE COALESCE(NULLIF(reg.time_zone, ''), 'America/New_York'))::date
        >= ${input.bounds.filedOnOrAfter}::date
      AND (e.official_filed_at AT TIME ZONE COALESCE(NULLIF(reg.time_zone, ''), 'America/New_York'))::date
        < ${input.bounds.filedBefore}::date
    ORDER BY e.court_code, e.docket_number, e.official_filed_at
  `;
  const rows = events.flatMap((event) => {
    if (isRestrictedDocketText(`${event.caption} ${event.docket_number}`)) return [];
    const selected = selectBackfillRow({
      id: "0",
      court_id: event.court_code,
      docket_number: event.docket_number,
      case_name: event.caption,
      date_filed: event.filed_on,
      cause: "",
      nature_of_suit: "",
      jury_demand: "",
      assigned_to_str: "",
      referred_to_str: "",
      date_modified: event.filed_on,
    }, input.family, input.today, input.windowDays);
    return selected ? [selected] : [];
  });
  for (let index = 0; index < rows.length; index += 200) {
    const written = await persistFilingRows(sql, input.providerId, rows.slice(index, index + 200));
    summary.inserted += written.inserted;
    summary.filledDate += written.filledDate;
    summary.alreadyPresent += written.alreadyPresent;
  }
  return summary;
}

export async function backfillRecentFilings(sql: Sql, input: {
  providerId: string;
  family: FilingFamily;
  snapshotDate: string;
  today: string;
  windowDays: number;
  baseUrl: string;
}): Promise<RecentFilingCheckpoint & { bounds: { filedOnOrAfter: string; filedBefore: string } | null }> {
  const bounds = recentFilingBounds(input.snapshotDate, input.today, input.windowDays);
  if (!bounds) {
    return {
      version: 1, nextUrl: null, requests: 0, inserted: 0, filledDate: 0, alreadyPresent: 0, stopped: "complete", bounds: null,
    };
  }
  const stream = recentFilingStreamName(input.family, bounds);
  const [stored] = await sql<{ cursor_value: string }[]>`
    SELECT checkpoint.cursor_value FROM ingestion_checkpoint checkpoint
    JOIN provider ON provider.id = checkpoint.provider_id
    WHERE provider.code = 'courtlistener' AND checkpoint.stream_name = ${stream}
  `;
  let startUrl = recentDocketListUrl(input.baseUrl, input.family, bounds);
  const prior = { requests: 0, inserted: 0, filledDate: 0, alreadyPresent: 0 };
  if (stored?.cursor_value) {
    const parsed = JSON.parse(stored.cursor_value) as Partial<RecentFilingCheckpoint>;
    if (parsed.stopped === "complete") {
      return {
        version: 1, nextUrl: null, requests: parsed.requests ?? 0, inserted: parsed.inserted ?? 0,
        filledDate: parsed.filledDate ?? 0, alreadyPresent: parsed.alreadyPresent ?? 0, stopped: "complete", bounds,
      };
    }
    prior.inserted = parsed.inserted ?? 0;
    prior.filledDate = parsed.filledDate ?? 0;
    prior.alreadyPresent = parsed.alreadyPresent ?? 0;
    prior.requests = parsed.requests ?? 0;
    if (parsed.nextUrl) startUrl = parsed.nextUrl;
  }
  const [quotaRow] = await sql<{ n: number }[]>`
    SELECT cursor_value::int AS n FROM ingestion_checkpoint checkpoint
    JOIN provider ON provider.id = checkpoint.provider_id
    WHERE provider.code = 'courtlistener'
      AND checkpoint.stream_name = ${`courtlistener:filing-recent-quota:${new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date())}`}
  `;
  const quota = Math.max(0, RECENT_FILING_DAILY_REQUESTS - (quotaRow?.n ?? 0));
  setCourtListenerRequestPolicy({ stopOnRateLimit: true });
  try {
    const walked = await walkRecentDocketPages({
      startUrl,
      quota,
      family: input.family,
      today: input.today,
      windowDays: input.windowDays,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      fetchPage: async (url) => {
        if (!await takeRecentRequest(sql)) throw new CourtListenerRateLimited(null);
        const page = await fetchDocketPage({ filedAfter: bounds.filedOnOrAfter, filedBefore: bounds.filedBefore, cursor: url });
        return { records: page.records.map((item) => item.record), next: page.next };
      },
      persist: async (records) => {
        const rows = records.flatMap((record) => {
          const docket = bulkDocketFromApi(record);
          const selected = docket ? selectBackfillRow(docket, input.family, input.today, input.windowDays) : null;
          return selected ? [selected] : [];
        });
        const written = await persistFilingRows(sql, input.providerId, rows);
        return { inserted: written.inserted, filledDate: written.filledDate, alreadyPresent: written.alreadyPresent };
      },
    });
    walked.inserted += prior.inserted;
    walked.filledDate += prior.filledDate;
    walked.alreadyPresent += prior.alreadyPresent;
    walked.requests += prior.requests;
    await sql`
      INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
      VALUES (${input.providerId}, ${stream}, ${JSON.stringify(walked)})
      ON CONFLICT (provider_id, stream_name) DO UPDATE
        SET cursor_value = EXCLUDED.cursor_value, updated_at = now()
    `;
    return { ...walked, bounds };
  } finally {
    setCourtListenerRequestPolicy({});
  }
}
