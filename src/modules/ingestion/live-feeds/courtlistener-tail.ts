/**
 * CourtListener tail: dockets modified since a stored watermark, oldest
 * change first, for the federal courts Jurvio tracks. One listing page gives
 * docket number, caption, filing date and court, so a run costs a few
 * requests and no per-docket fetches. A 429 stops the run at once and the
 * Retry-After time is stored; the next run does not call CourtListener again
 * before then.
 */
import type postgres from "postgres";
import { env } from "@/lib/config/env";
import type { ArtifactStore } from "../application/artifact-store";
import {
  CourtListenerDeadlineReached, CourtListenerRateLimited, fetchDocketPage, setCourtListenerRequestPolicy,
} from "../providers/courtlistener/client";
import type { CourtListenerDocket } from "../providers/courtlistener/schema";
import { readSourceWatermark, recordSourceWatermark } from "@/modules/operations/application/court-freshness";
import { matchOrCreateDraftCase, providerId, resolveCourt, storeFeedArtifact } from "./persist";
import type { SourceRunResult } from "./run-live-feeds";

type Sql = ReturnType<typeof postgres>;

/** The watermark row for the tail as a whole (per-court rows carry freshness). */
export const TAIL_COURT = "_all";

export interface TailCursor {
  /** Lower bound (inclusive) of the current date_modified window. */
  modifiedAfter: string;
  /** Upper bound (exclusive) of the window being walked. */
  modifiedBefore: string | null;
  /** CourtListener's next-page URL inside the current window, when mid-window. */
  next: string | null;
}

export function parseTailCursor(value: string | null | undefined, now: Date, initialLookbackHours = 48): TailCursor {
  const fallback: TailCursor = { modifiedAfter: new Date(now.getTime() - initialLookbackHours * 3_600_000).toISOString(), modifiedBefore: null, next: null };
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as Partial<TailCursor>;
    if (typeof parsed.modifiedAfter !== "string" || Number.isNaN(Date.parse(parsed.modifiedAfter))) return fallback;
    const next = typeof parsed.next === "string" && parsed.next.startsWith("https://www.courtlistener.com/") ? parsed.next : null;
    const before = typeof parsed.modifiedBefore === "string" && !Number.isNaN(Date.parse(parsed.modifiedBefore)) ? parsed.modifiedBefore : null;
    return { modifiedAfter: parsed.modifiedAfter, modifiedBefore: next ? before : null, next };
  } catch {
    return fallback;
  }
}

/** "https://www.courtlistener.com/api/rest/v4/courts/nysd/" -> "nysd" */
export function courtCodeFromUrl(value: string): string | null {
  return /\/courts\/([a-z0-9]+)\/?$/i.exec(value.trim())?.[1]?.toLowerCase() ?? null;
}

/** First page of a window: federal supreme, appellate and district courts only. */
export function tailFirstPageUrl(baseUrl: string, window: { modifiedAfter: string; modifiedBefore: string }): string {
  const url = new URL("dockets/", `${baseUrl.replace(/\/+$/, "")}/`);
  url.searchParams.set("date_modified__gte", window.modifiedAfter);
  url.searchParams.set("date_modified__lt", window.modifiedBefore);
  url.searchParams.set("court__jurisdiction__in", "F,FD,FS");
  url.searchParams.set("order_by", "date_modified,id");
  return url.toString();
}

export interface TailPage {
  records: Array<{ record: CourtListenerDocket; rawBody: string; sourceUri: string }>;
  next: string | null;
}

export interface TailDeps {
  fetchPage(url: string): Promise<TailPage>;
  /** Store one docket. Returns whether a new case was created. */
  persist(courtCode: string, docket: CourtListenerDocket, page: TailPage): Promise<"created" | "existing" | "skipped">;
  tracked(courtCode: string): boolean;
}

export interface TailOutcome {
  cursor: TailCursor;
  pages: number;
  itemsFetched: number;
  perCourt: Map<string, { items: number; newCases: number }>;
  newCases: number;
  rateLimitedUntil: Date | null;
  stoppedBy: "caught_up" | "page_limit" | "rate_limited" | "deadline";
}

/**
 * Walk one window page by page. The cursor only moves past a page after every
 * record on it is stored, so a crash or 429 repeats at most one page.
 */
export async function walkTail(start: TailCursor, now: Date, deps: TailDeps, maxPages: number): Promise<TailOutcome> {
  const cursor: TailCursor = { ...start };
  if (!cursor.modifiedBefore) cursor.modifiedBefore = new Date(now.getTime() - 5 * 60_000).toISOString();
  const outcome: TailOutcome = { cursor, pages: 0, itemsFetched: 0, perCourt: new Map(), newCases: 0, rateLimitedUntil: null, stoppedBy: "page_limit" };
  let newestSeen = cursor.modifiedAfter;
  while (outcome.pages < maxPages) {
    const url = cursor.next ?? tailFirstPageUrl(env().COURTLISTENER_API_BASE_URL, {
      modifiedAfter: cursor.modifiedAfter, modifiedBefore: cursor.modifiedBefore! });
    let page: TailPage;
    try {
      page = await deps.fetchPage(url);
    } catch (error) {
      if (error instanceof CourtListenerRateLimited) {
        outcome.rateLimitedUntil = new Date(Date.now() + (error.retryAfterMs ?? 15 * 60_000));
        outcome.stoppedBy = "rate_limited";
        return outcome;
      }
      if (error instanceof CourtListenerDeadlineReached) { outcome.stoppedBy = "deadline"; return outcome; }
      throw error;
    }
    outcome.pages += 1;
    for (const { record } of page.records) {
      outcome.itemsFetched += 1;
      if (record.date_modified > newestSeen) newestSeen = record.date_modified;
      const court = courtCodeFromUrl(record.court);
      if (!court || !deps.tracked(court)) continue;
      const result = await deps.persist(court, record, page);
      const stats = outcome.perCourt.get(court) ?? { items: 0, newCases: 0 };
      stats.items += 1;
      if (result === "created") { stats.newCases += 1; outcome.newCases += 1; }
      outcome.perCourt.set(court, stats);
    }
    if (page.next) {
      cursor.next = page.next;
    } else {
      // Window done: the next one starts where this one ended.
      cursor.modifiedAfter = cursor.modifiedBefore!;
      cursor.modifiedBefore = null;
      cursor.next = null;
      outcome.stoppedBy = "caught_up";
      return outcome;
    }
  }
  return outcome;
}

export async function runCourtListenerTail(sql: Sql, store: ArtifactStore, options: {
  trackedCourts: ReadonlySet<string>; maxPages?: number; deadlineMs?: number; now?: () => Date;
  fetchPage?: TailDeps["fetchPage"];
}): Promise<SourceRunResult[]> {
  const now = options.now?.() ?? new Date();
  const summary: SourceRunResult = { source: "courtlistener", court: TAIL_COURT, ok: false, requests: 0, itemsFetched: 0,
    newCases: 0, newEntries: 0, skippedRestricted: 0, skippedAmbiguous: 0 };
  const prior = await readSourceWatermark(sql, "courtlistener", TAIL_COURT);
  if (prior?.retry_after_until && Date.parse(prior.retry_after_until) > now.getTime()) {
    summary.ok = true;
    summary.error = `paused until ${new Date(prior.retry_after_until).toISOString()} (Retry-After)`;
    summary.retryAfterUntil = new Date(prior.retry_after_until).toISOString();
    // Keep the pause recorded; do not count as a failure.
    await recordSourceWatermark(sql, { source: "courtlistener", courtCode: TAIL_COURT, ok: true,
      retryAfterUntil: summary.retryAfterUntil, error: summary.error });
    return [summary];
  }
  const cursor = parseTailCursor(prior?.cursor_value, now);
  setCourtListenerRequestPolicy({ stopOnRateLimit: true, deadlineMs: options.deadlineMs ?? Date.now() + 6 * 60_000 });
  const courtResults: SourceRunResult[] = [];
  try {
    const provider = await providerId(sql, "courtlistener");
    const courtIds = new Map<string, string>();
    const outcome = await walkTail(cursor, now, {
      tracked: (court) => options.trackedCourts.has(court),
      fetchPage: options.fetchPage ?? (async (url) => {
        const page = await fetchDocketPage({ modifiedAfter: "", modifiedBefore: "", cursor: url });
        return { records: page.records.map((item) => ({ record: item.record, rawBody: item.rawBody, sourceUri: item.sourceUri })), next: page.next };
      }),
      persist: async (court, docket) => {
        if (!docket.docket_number.trim() || docket.case_name.trim().length < 3) return "skipped";
        return sql.begin(async (tx) => {
          const artifactId = await storeFeedArtifact(tx, store, {
            providerId: provider, sourceUri: docket.resource_uri, sourceRecordId: `courtlistener-tail:${docket.id}`,
            keyPrefix: `courtlistener/tail/${court}`, body: JSON.stringify(docket), mediaType: "application/json",
            metadata: { docketId: docket.id, dateModified: docket.date_modified },
          });
          let courtId = courtIds.get(court);
          if (!courtId) {
            courtId = await resolveCourt(tx, { providerId: provider, courtCode: court, name: court.toUpperCase(),
              shortName: court.toUpperCase(), jurisdiction: "Federal", artifactId });
            courtIds.set(court, courtId);
          }
          const match = await matchOrCreateDraftCase(tx, {
            providerId: provider, courtId, courtCode: court, docketNumber: docket.docket_number.trim(),
            caption: docket.case_name.trim(), filedOn: docket.date_filed ?? null, artifactId,
            identifierType: "courtlistener_docket_id", identifierValue: String(docket.id),
          });
          if (match.kind === "restricted") summary.skippedRestricted += 1;
          if (match.kind === "ambiguous") summary.skippedAmbiguous += 1;
          return match.kind === "created" ? "created" : match.kind === "existing" ? "existing" : "skipped";
        });
      },
    }, options.maxPages ?? 5);
    summary.requests = outcome.pages + (outcome.stoppedBy === "rate_limited" ? 1 : 0);
    summary.itemsFetched = outcome.itemsFetched;
    summary.newCases = outcome.newCases;
    summary.ok = outcome.stoppedBy !== "rate_limited";
    if (outcome.rateLimitedUntil) {
      summary.retryAfterUntil = outcome.rateLimitedUntil.toISOString();
      summary.error = `CourtListener 429; paused until ${summary.retryAfterUntil}`;
    }
    await recordSourceWatermark(sql, { source: "courtlistener", courtCode: TAIL_COURT, ok: summary.ok,
      cursor: JSON.stringify(outcome.cursor), itemsFetched: summary.itemsFetched, newCases: summary.newCases,
      retryAfterUntil: summary.retryAfterUntil ?? null, error: summary.error ?? null });
    for (const [court, stats] of outcome.perCourt) {
      await recordSourceWatermark(sql, { source: "courtlistener", courtCode: court, ok: true,
        itemsFetched: stats.items, newCases: stats.newCases });
      courtResults.push({ source: "courtlistener", court, ok: true, requests: 0, itemsFetched: stats.items,
        newCases: stats.newCases, newEntries: 0, skippedRestricted: 0, skippedAmbiguous: 0 });
    }
  } catch (error) {
    summary.error = error instanceof Error ? error.message : String(error);
    await recordSourceWatermark(sql, { source: "courtlistener", courtCode: TAIL_COURT, ok: false, error: summary.error });
  } finally {
    setCourtListenerRequestPolicy({});
  }
  return [summary, ...courtResults];
}
