/**
 * Pure rules for the per-court freshness table (/internal/freshness).
 * No I/O here, so the status thresholds, sorting and filtering are unit tested.
 */

export type CourtType = "supreme" | "appellate" | "district";
export type FreshnessStatus = "fresh" | "stale" | "never";
export type FreshnessSource = "bulk" | "feed" | "courtlistener";

export interface CourtFreshnessRow {
  courtCode: string;
  courtType: CourtType;
  name: string;
  circuit: string | null;
  caseCount: number;
  publishedCount: number;
  draftCount: number;
  withheldCount: number;
  newestFiledOn: string | null;
  newestCaseCreatedAt: string | null;
  lastBulkAt: string | null;
  lastFeedAt: string | null;
  lastCourtListenerAt: string | null;
  feedAvailable: boolean;
  feedHealth: string | null;
  feedFailures: number;
  courtListenerRetryAfter: string | null;
  refreshedAt: string;
}

/** A court is fresh when a daily source (live feed or CourtListener tail) succeeded within this window. */
export const FRESH_WINDOW_HOURS = 36;
/** Consecutive feed failures after which a row is flagged as failing, whatever its age. */
export const FAILING_AFTER_FAILURES = 3;

const HOUR_MS = 60 * 60 * 1000;

function time(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Most recent successful update from any source, or null when no source has ever touched the court. */
export function lastUpdatedAt(row: Pick<CourtFreshnessRow, "lastBulkAt" | "lastFeedAt" | "lastCourtListenerAt">): string | null {
  let best: { at: number; value: string } | null = null;
  for (const value of [row.lastBulkAt, row.lastFeedAt, row.lastCourtListenerAt]) {
    const at = time(value);
    if (at !== null && value && (!best || at > best.at)) best = { at, value };
  }
  return best?.value ?? null;
}

/** Most recent update from a daily source. Bulk snapshots are monthly, so they never make a court "fresh" on their own. */
export function lastLiveUpdateAt(row: Pick<CourtFreshnessRow, "lastFeedAt" | "lastCourtListenerAt">): string | null {
  const feed = time(row.lastFeedAt);
  const tail = time(row.lastCourtListenerAt);
  if (feed === null && tail === null) return null;
  return (feed ?? -Infinity) >= (tail ?? -Infinity) ? row.lastFeedAt : row.lastCourtListenerAt;
}

export function classifyFreshness(
  row: Pick<CourtFreshnessRow, "lastBulkAt" | "lastFeedAt" | "lastCourtListenerAt">,
  now = Date.now(),
): FreshnessStatus {
  if (!lastUpdatedAt(row)) return "never";
  const live = time(lastLiveUpdateAt(row));
  if (live !== null && now - live <= FRESH_WINDOW_HOURS * HOUR_MS) return "fresh";
  return "stale";
}

export function isFailing(row: Pick<CourtFreshnessRow, "feedHealth" | "feedFailures">): boolean {
  return row.feedHealth === "degraded" || row.feedFailures >= FAILING_AFTER_FAILURES;
}

/** Hours since the last update from any source; null when never updated. */
export function lagHours(row: Pick<CourtFreshnessRow, "lastBulkAt" | "lastFeedAt" | "lastCourtListenerAt">, now = Date.now()): number | null {
  const at = time(lastUpdatedAt(row));
  if (at === null) return null;
  return Math.max(0, (now - at) / HOUR_MS);
}

/** "12m", "5h", "3d", "2mo". */
export function formatLag(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 60) return `${Math.round(days)}d`;
  return `${Math.round(days / 30)}mo`;
}

/** Relative age of one timestamp, for a single source column. */
export function formatAge(value: string | null, now = Date.now()): string {
  const at = time(value);
  if (at === null) return "never";
  return `${formatLag(Math.max(0, (now - at) / HOUR_MS))} ago`;
}

export type SortKey =
  | "court" | "cases" | "published" | "draft" | "newestFiling"
  | "bulk" | "feed" | "courtlistener" | "lag" | "status";

export interface FreshnessFilter {
  courtType: CourtType | "all";
  status: FreshnessStatus | "all";
  query: string;
}

const TYPE_ORDER: Record<CourtType, number> = { supreme: 0, appellate: 1, district: 2 };
const STATUS_ORDER: Record<FreshnessStatus, number> = { never: 0, stale: 1, fresh: 2 };

/** Circuit-number aware court ordering: ca1, ca2, ... ca11, cadc, cafc. */
export function compareCourtCode(a: string, b: string): number {
  return a.localeCompare(b, "en-US", { numeric: true });
}

function nullableNumber(value: number | null, direction: 1 | -1): number {
  // Nulls ("never") always sort last regardless of direction.
  return value === null ? Number.POSITIVE_INFINITY : value * direction;
}

export function sortRows(rows: readonly CourtFreshnessRow[], key: SortKey, direction: "asc" | "desc", now = Date.now()): CourtFreshnessRow[] {
  const sign: 1 | -1 = direction === "asc" ? 1 : -1;
  const grouped = (a: CourtFreshnessRow, b: CourtFreshnessRow) =>
    TYPE_ORDER[a.courtType] - TYPE_ORDER[b.courtType] || compareCourtCode(a.courtCode, b.courtCode);
  const metric = (row: CourtFreshnessRow): number | null => {
    switch (key) {
      case "cases": return row.caseCount;
      case "published": return row.publishedCount;
      case "draft": return row.draftCount;
      case "newestFiling": return time(row.newestFiledOn);
      case "bulk": return time(row.lastBulkAt);
      case "feed": return time(row.lastFeedAt);
      case "courtlistener": return time(row.lastCourtListenerAt);
      case "lag": return lagHours(row, now);
      case "status": return STATUS_ORDER[classifyFreshness(row, now)];
      default: return null;
    }
  };
  return [...rows].sort((a, b) => {
    if (key === "court") return sign * grouped(a, b);
    const av = metric(a);
    const bv = metric(b);
    return nullableNumber(av, sign) - nullableNumber(bv, sign) || grouped(a, b);
  });
}

export function filterRows(rows: readonly CourtFreshnessRow[], filter: FreshnessFilter, now = Date.now()): CourtFreshnessRow[] {
  const query = filter.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.courtType !== "all" && row.courtType !== filter.courtType) return false;
    if (filter.status !== "all" && classifyFreshness(row, now) !== filter.status) return false;
    if (query && !row.courtCode.toLowerCase().includes(query) && !row.name.toLowerCase().includes(query)) return false;
    return true;
  });
}

export interface FreshnessSummary {
  courts: number;
  fresh: number;
  stale: number;
  never: number;
  failing: number;
  cases: number;
  published: number;
  draft: number;
  withheld: number;
  newestFiledOn: string | null;
  oldestRefreshAt: string | null;
}

export function summarize(rows: readonly CourtFreshnessRow[], now = Date.now()): FreshnessSummary {
  const summary: FreshnessSummary = {
    courts: rows.length, fresh: 0, stale: 0, never: 0, failing: 0,
    cases: 0, published: 0, draft: 0, withheld: 0, newestFiledOn: null, oldestRefreshAt: null,
  };
  for (const row of rows) {
    summary[classifyFreshness(row, now)] += 1;
    if (isFailing(row)) summary.failing += 1;
    summary.cases += row.caseCount;
    summary.published += row.publishedCount;
    summary.draft += row.draftCount;
    summary.withheld += row.withheldCount;
    if (row.newestFiledOn && (!summary.newestFiledOn || row.newestFiledOn > summary.newestFiledOn)) summary.newestFiledOn = row.newestFiledOn;
    if (!summary.oldestRefreshAt || row.refreshedAt < summary.oldestRefreshAt) summary.oldestRefreshAt = row.refreshedAt;
  }
  return summary;
}
