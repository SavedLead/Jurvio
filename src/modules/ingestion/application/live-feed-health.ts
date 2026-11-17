import type postgres from "postgres";
import { siteOrigin } from "@/lib/config/site-url";
import { atomFeed, type ActivityFeedItem } from "@/modules/scotus/domain/activity-feed";

type Sql = ReturnType<typeof postgres>;

/** No new district filing for this long, during court hours, means the lane is stuck. */
export const DISTRICT_STALE_MINUTES = 90;
/** No new appeals filing for this long, during court hours, means the lane is stuck. */
export const APPEALS_STALE_MINUTES = 60;

export interface FeedFreshness {
  lastItemAt: string | null;
  ageMinutes: number | null;
  stale: boolean;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
}

export interface LiveFeedHealth {
  generatedAt: string;
  courtHours: boolean;
  ok: boolean;
  district: FeedFreshness;
  appeals: FeedFreshness;
}

export function inFederalCourtHours(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  if (weekday === "Sat" || weekday === "Sun") return false;
  return hour >= 8 && hour < 18;
}

export function ageMinutes(at: Date | string | null, now: Date): number | null {
  if (!at) return null;
  const time = at instanceof Date ? at.getTime() : Date.parse(at);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.round((now.getTime() - time) / 60_000));
}

export function feedIsStale(age: number | null, limit: number, courtHours: boolean): boolean {
  if (!courtHours) return false;
  return age === null || age > limit;
}

interface StampRow {
  newest: Date | string | null;
}

interface RunRow {
  started_at: Date | string | null;
  ok: boolean | null;
}

async function newestDistrictItem(sql: Sql): Promise<Date | string | null> {
  const [row] = await sql<StampRow[]>`
    SELECT max(event.first_seen_at) AS newest
    FROM direct_court_event event
    WHERE event.last_seen_at > now() - interval '30 hours'
      AND event.restricted = false
  `;
  return row?.newest ?? null;
}

async function newestAppealsItem(sql: Sql): Promise<Date | string | null> {
  const [row] = await sql<StampRow[]>`
    SELECT max(entry.created_at) AS newest
    FROM docket_entry entry
    WHERE entry.created_at > now() - interval '36 hours'
      AND entry.provider_entry_id LIKE 'appellate-rss:%'
  `;
  return row?.newest ?? null;
}

async function lastRun(sql: Sql, lane: string): Promise<RunRow> {
  const [row] = await sql<RunRow[]>`
    SELECT started_at, ok
    FROM scheduler_lane_run
    WHERE lane = ${lane}
    ORDER BY started_at DESC
    LIMIT 1
  `;
  return row ?? { started_at: null, ok: null };
}

function freshness(at: Date | string | null, run: RunRow, limit: number, now: Date, courtHours: boolean): FeedFreshness {
  const age = ageMinutes(at, now);
  return {
    lastItemAt: at instanceof Date ? at.toISOString() : at,
    ageMinutes: age,
    stale: feedIsStale(age, limit, courtHours),
    lastRunAt: run.started_at instanceof Date ? run.started_at.toISOString() : run.started_at,
    lastRunOk: run.ok,
  };
}

/** Ages only. No captions, docket numbers, or error text. */
export async function readLiveFeedHealth(sql: Sql, now = new Date()): Promise<LiveFeedHealth> {
  const courtHours = inFederalCourtHours(now);
  const [districtAt, appealsAt, districtRun, appealsRun] = await Promise.all([
    newestDistrictItem(sql),
    newestAppealsItem(sql),
    lastRun(sql, "direct-court"),
    lastRun(sql, "appellate-pacer-rss"),
  ]);
  const district = freshness(districtAt, districtRun, DISTRICT_STALE_MINUTES, now, courtHours);
  const appeals = freshness(appealsAt, appealsRun, APPEALS_STALE_MINUTES, now, courtHours);
  return {
    generatedAt: now.toISOString(),
    courtHours,
    ok: !district.stale && !appeals.stale,
    district,
    appeals,
  };
}

interface FeedRow {
  id: string;
  caption: string;
  summary: string;
  filed_at: Date | string | null;
  public_id: string | null;
  court_code: string;
}

function itemUrl(origin: string, publicId: string | null): string {
  return publicId ? `${origin}/case/${publicId}` : `${origin}/cases`;
}

function stamp(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

export async function districtFeedXml(sql: Sql): Promise<string> {
  const origin = siteOrigin();
  const rows = await sql<FeedRow[]>`
    SELECT event.deduplication_key AS id, event.caption, event.visitor_description AS summary,
      event.first_seen_at AS filed_at, legal_case.public_id, event.court_code
    FROM direct_court_event event
    LEFT JOIN legal_case ON legal_case.id = event.case_id AND legal_case.publication = 'published'
    WHERE event.restricted = false
      AND event.publication_state = 'published'
      AND event.last_seen_at > now() - interval '30 hours'
      AND event.first_seen_at > now() - interval '24 hours'
    ORDER BY event.first_seen_at DESC
    LIMIT 40
  `;
  return feedXml(origin, `${origin}/feeds/district`, "Jurvio district court filings", "New filings from district court RSS feeds. Each court's feed keeps about 24 hours, and this list does too.", rows);
}

export async function appealsFeedXml(sql: Sql): Promise<string> {
  const origin = siteOrigin();
  const rows = await sql<FeedRow[]>`
    SELECT entry.provider_entry_id AS id, legal_case.caption, left(entry.description, 240) AS summary,
      entry.created_at AS filed_at, legal_case.public_id, court.provider_court_id AS court_code
    FROM docket_entry entry
    JOIN legal_case ON legal_case.id = entry.case_id AND legal_case.publication = 'published'
    JOIN court ON court.id = legal_case.court_id
    WHERE entry.provider_entry_id LIKE 'appellate-rss:%'
      AND entry.created_at > now() - interval '24 hours'
    ORDER BY entry.created_at DESC
    LIMIT 40
  `;
  return feedXml(origin, `${origin}/feeds/appeals`, "Jurvio court of appeals filings", "New filings from the courts of appeals that publish a 24-hour RSS feed.", rows);
}

function feedXml(origin: string, selfUrl: string, title: string, subtitle: string, rows: FeedRow[]): string {
  const items: ActivityFeedItem[] = rows.map((row) => ({
    id: `${selfUrl}#${row.id}`,
    title: `${row.court_code}: ${row.caption}`,
    url: itemUrl(origin, row.public_id),
    updated: stamp(row.filed_at),
    summary: row.summary || "New court filing.",
    category: "filing",
  }));
  return atomFeed({
    id: selfUrl,
    title,
    selfUrl,
    subtitle,
    updated: items[0]?.updated ?? new Date().toISOString(),
    items,
  });
}
