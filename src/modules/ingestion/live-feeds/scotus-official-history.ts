/**
 * Resumable supremecourt.gov backfill for docket years 2017 through the
 * current docket year (paid, in forma pauperis, and applications).
 *
 * Cases and docket lines are drafts. This module does not write
 * publication_decision, entity_alert, or docket_entry rows that are
 * displayable, so a history load cannot notify subscribers. Filing PDFs are
 * stored as links only. CourtListener is not read.
 */
import type postgres from "postgres";
import type { ArtifactStore } from "../application/artifact-store";
import { syncOfficialOrderIndex } from "../application/ingest-official-scotus-orders";
import { fetchOfficialOrdersIndex } from "../providers/scotus/official-orders";
import { fetchOfficialSlipOpinionIndex } from "../providers/scotus/official-opinions";
import { isRestrictedDocketText } from "../domain/federal-stream";
import { entryImportance } from "../providers/scotus/official-docket";
import { BudgetExhaustedError, FetchBudget, RateLimitedError } from "./polite-fetcher";
import {
  insertDocketEntryOnce, matchOrCreateDraftCase, providerId, resolveCourt, storeFeedArtifact,
} from "./persist";
import {
  parseScotusDocketJson, scotusDocketJsonUrl, scotusDocketYear,
  type ScotusDocket,
} from "./scotus-docket-feed";

type Sql = ReturnType<typeof postgres>;

export const HISTORY_FROM_YEAR = 17;
export const HISTORY_MISS_LIMIT = 15;
/** One request every 1.5s, about 10 minutes of fetching each 20-minute cycle. */
export const HISTORY_REQUESTS_PER_HOUR = 1_200;
export const HISTORY_SERIES = ["paid", "ifp", "app"] as const;
export type HistorySeriesName = (typeof HISTORY_SERIES)[number];

export interface HistoryCounts {
  requests: number;
  stored: number;
  missing: number;
  skipped: number;
  failed: number;
  links: number;
  counsel: number;
}

export interface HistoryCursor {
  year: number;
  series: HistorySeriesName;
  next: number;
  misses: number;
  done: string[];
  orders: string[];
  slips: string[];
  complete: boolean;
  counts: HistoryCounts;
}

export function emptyHistoryCounts(): HistoryCounts {
  return { requests: 0, stored: 0, missing: 0, skipped: 0, failed: 0, links: 0, counsel: 0 };
}

export function initialHistoryCursor(): HistoryCursor {
  return {
    year: HISTORY_FROM_YEAR, series: "paid", next: 1, misses: 0, done: [], orders: [], slips: [],
    complete: false, counts: emptyHistoryCounts(),
  };
}

export function seriesStart(series: HistorySeriesName): number {
  return series === "ifp" ? 5001 : 1;
}

export function seriesLast(series: HistorySeriesName): number {
  return series === "ifp" ? 9999 : 4999;
}

export function historyDocket(year: number, series: HistorySeriesName, n: number): string {
  const yy = String(year).padStart(2, "0");
  return series === "app" ? `${yy}A${n}` : `${yy}-${n}`;
}

/** The number ranges this job will walk. A series stops after 15 consecutive 404s. */
export function plannedHistoryRanges(throughYear: number): string[] {
  const ranges: string[] = [];
  for (let year = HISTORY_FROM_YEAR; year <= throughYear; year += 1) {
    const yy = String(year).padStart(2, "0");
    ranges.push(`${yy}-1..${yy}-4999`, `${yy}-5001..${yy}-9999`, `${yy}A1..${yy}A4999`);
  }
  return ranges;
}

function clone(cursor: HistoryCursor): HistoryCursor {
  return {
    ...cursor,
    done: [...cursor.done],
    orders: [...cursor.orders],
    slips: [...cursor.slips],
    counts: { ...cursor.counts },
  };
}

function finishSeries(cursor: HistoryCursor, throughYear: number): HistoryCursor {
  const next = clone(cursor);
  const key = `${String(next.year).padStart(2, "0")}-${next.series}`;
  if (!next.done.includes(key)) next.done.push(key);
  const index = HISTORY_SERIES.indexOf(next.series);
  if (index < HISTORY_SERIES.length - 1) {
    next.series = HISTORY_SERIES[index + 1]!;
    next.next = seriesStart(next.series);
    next.misses = 0;
    return next;
  }
  if (next.year >= throughYear) {
    next.complete = true;
    return next;
  }
  next.year += 1;
  next.series = "paid";
  next.next = 1;
  next.misses = 0;
  return next;
}

/** A docket Jurvio already stored from this source. Does not count as a miss. */
export function noteSkip(cursor: HistoryCursor, throughYear: number): HistoryCursor {
  const next = clone(cursor);
  next.counts.skipped += 1;
  next.misses = 0;
  next.next += 1;
  if (next.next > seriesLast(next.series)) return finishSeries(next, throughYear);
  return next;
}

/** One Court response. `found` is false for HTTP 404. */
export function noteProbe(cursor: HistoryCursor, found: boolean, throughYear: number): HistoryCursor {
  const next = clone(cursor);
  next.counts.requests += 1;
  if (found) {
    next.counts.stored += 1;
    next.misses = 0;
  } else {
    next.counts.missing += 1;
    next.misses += 1;
  }
  next.next += 1;
  if (next.misses >= HISTORY_MISS_LIMIT || next.next > seriesLast(cursor.series)) return finishSeries(next, throughYear);
  return next;
}

export function parseHistoryCursor(value: unknown): HistoryCursor {
  const base = initialHistoryCursor();
  if (!value || typeof value !== "object") return base;
  const raw = value as Partial<HistoryCursor>;
  const series = HISTORY_SERIES.includes(raw.series as HistorySeriesName) ? raw.series as HistorySeriesName : "paid";
  const year = Number.isInteger(raw.year) && (raw.year as number) >= HISTORY_FROM_YEAR ? raw.year as number : HISTORY_FROM_YEAR;
  return {
    ...base,
    year,
    series,
    next: Number.isInteger(raw.next) && (raw.next as number) >= seriesStart(series) ? raw.next as number : seriesStart(series),
    misses: Number.isInteger(raw.misses) && (raw.misses as number) >= 0 ? raw.misses as number : 0,
    done: Array.isArray(raw.done) ? raw.done.filter((item) => typeof item === "string") : [],
    orders: Array.isArray(raw.orders) ? raw.orders.filter((item) => typeof item === "string") : [],
    slips: Array.isArray(raw.slips) ? raw.slips.filter((item) => typeof item === "string") : [],
    complete: raw.complete === true,
    counts: { ...base.counts, ...(raw.counts ?? {}) },
  };
}

/** Hours if every remaining request were still ahead. Null until a year has been sampled. */
export function estimateHistoryHours(cursor: HistoryCursor, throughYear: number): number | null {
  const sampledYears = Math.max(0, cursor.year - HISTORY_FROM_YEAR) + (cursor.series === "paid" && cursor.next <= 1 ? 0 : 0.25);
  if (cursor.counts.requests < 30 || sampledYears <= 0) return null;
  const perYear = cursor.counts.requests / sampledYears;
  const yearsLeft = Math.max(0, throughYear - cursor.year + (cursor.complete ? 0 : 1));
  return Math.round((perYear * yearsLeft) / HISTORY_REQUESTS_PER_HOUR);
}

async function alreadyOfficial(sql: Sql, provider: string, docketNumber: string): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    SELECT e.id FROM case_identifier i
    JOIN docket_entry e ON e.case_id = i.case_id AND e.provider_id = i.provider_id
    WHERE i.provider_id = ${provider} AND i.identifier_type = 'scotus_docket' AND i.identifier_value = ${docketNumber}
    LIMIT 1`;
  return Boolean(row);
}

async function storeDocket(sql: Sql, store: ArtifactStore, provider: string, docket: ScotusDocket, body: string): Promise<void> {
  if (isRestrictedDocketText(docket.caption)) return;
  await sql.begin(async (tx) => {
    const artifactId = await storeFeedArtifact(tx, store, {
      providerId: provider, sourceUri: scotusDocketJsonUrl(docket.docketNumber),
      sourceRecordId: `docket-json:${docket.docketNumber}`,
      keyPrefix: `scotus/docket-json/${docket.docketNumber}`, body, mediaType: "application/json",
      metadata: { docketNumber: docket.docketNumber, entryCount: docket.entries.length, lane: "history" },
    });
    const courtId = await resolveCourt(tx, {
      providerId: provider, courtCode: "scotus", name: "Supreme Court of the United States",
      shortName: "SCOTUS", jurisdiction: "Federal Supreme", artifactId,
    });
    const match = await matchOrCreateDraftCase(tx, {
      providerId: provider, courtId, courtCode: "scotus", docketNumber: docket.docketNumber, caption: docket.caption,
      filedOn: docket.docketedOn, artifactId, identifierType: "scotus_docket", identifierValue: docket.docketNumber,
    });
    if (match.kind === "restricted" || match.kind === "ambiguous") return;
    for (const entry of docket.entries) {
      await insertDocketEntryOnce(tx, {
        caseId: match.caseId, providerId: provider, providerEntryId: entry.sourceRecordId, entryNumber: entry.entryNumber,
        filedOn: entry.filedOn, description: entry.description, entryType: entry.eventType,
        importance: entryImportance(entry.eventType, entry.description, docket.docketNumber), artifactId,
      });
    }
    for (const person of docket.counsel) {
      await tx`
        INSERT INTO scotus_counsel (case_id, side, name, firm, counsel_of_record)
        VALUES (${match.caseId}, ${person.side}, ${person.name}, ${person.firm}, ${person.counselOfRecord})
        ON CONFLICT (case_id, side, name) DO NOTHING`;
    }
    for (const filing of docket.filings) {
      await tx`
        INSERT INTO scotus_filing_link (case_id, source_url, description, filed_on)
        VALUES (${match.caseId}, ${filing.sourceUrl}, ${filing.description}, ${filing.filedOn})
        ON CONFLICT (case_id, source_url) DO NOTHING`;
    }
  });
}

function courtFetch(budget: FetchBudget): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith("https://www.supremecourt.gov/")) throw new Error("Refusing a non-Court URL");
    return budget.get(url);
  };
}

export async function runScotusOfficialHistory(
  sql: Sql,
  store: ArtifactStore,
  options: { maxRequests?: number; maxMs?: number; minIntervalMs?: number; now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<HistoryCursor & { alertsQueued: 0; pdfsDownloaded: 0; ranges: string[]; estimateHours: number | null; skipped: string | null }> {
  const throughYear = scotusDocketYear(options.now ?? new Date());
  const ranges = plannedHistoryRanges(throughYear);
  const [table] = await sql<{ present: string | null }[]>`SELECT to_regclass('scotus_official_checkpoint')::text AS present`;
  if (!table?.present) {
    return { ...initialHistoryCursor(), alertsQueued: 0, pdfsDownloaded: 0, ranges, estimateHours: null, skipped: "migration 0202 is not applied" };
  }
  const [saved] = await sql<{ cursor: HistoryCursor }[]>`
    SELECT cursor FROM scotus_official_checkpoint WHERE lane = 'dockets-2017'`;
  let cursor = parseHistoryCursor(saved?.cursor);
  if (cursor.complete) {
    return { ...cursor, alertsQueued: 0, pdfsDownloaded: 0, ranges, estimateHours: 0, skipped: null };
  }
  const budget = new FetchBudget({
    source: "scotus_official_history",
    maxRequests: options.maxRequests ?? 120,
    maxMs: options.maxMs ?? 10 * 60_000,
    minIntervalMs: options.minIntervalMs ?? 1_500,
    fetchImpl: options.fetchImpl,
  });
  const provider = await providerId(sql, "scotus_official");
  const stepCap = (options.maxRequests ?? 120) * 5;
  let steps = 0;
  const save = async () => {
    await sql`
      INSERT INTO scotus_official_checkpoint (lane, cursor, updated_at)
      VALUES ('dockets-2017', ${sql.json(JSON.parse(JSON.stringify(cursor)))}, now())
      ON CONFLICT (lane) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`;
  };
  try {
    while (budget.canFetch && !cursor.complete && steps < stepCap) {
      steps += 1;
      const docketNumber = historyDocket(cursor.year, cursor.series, cursor.next);
      if (await alreadyOfficial(sql, provider, docketNumber)) {
        cursor = noteSkip(cursor, throughYear);
        continue;
      }
      const response = await budget.get(scotusDocketJsonUrl(docketNumber), "application/json");
      if (response.status === 404) {
        cursor = noteProbe(cursor, false, throughYear);
        continue;
      }
      if (!response.ok) {
        cursor.counts.failed += 1;
        break;
      }
      const body = await response.text();
      const parsed = parseScotusDocketJson(JSON.parse(body));
      if (!parsed) {
        cursor = noteProbe(cursor, false, throughYear);
        continue;
      }
      await storeDocket(sql, store, provider, parsed, body);
      cursor = noteProbe(cursor, true, throughYear);
      cursor.counts.links += parsed.filings.length;
      cursor.counts.counsel += parsed.counsel.length;
    }
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError || error instanceof RateLimitedError)) {
      cursor.counts.failed += 1;
      await save();
      throw error;
    }
  }
  await save();
  for (let year = HISTORY_FROM_YEAR; year <= throughYear; year += 1) {
    const yy = String(year).padStart(2, "0");
    if (!HISTORY_SERIES.every((series) => cursor.done.includes(`${yy}-${series}`))) continue;
    if (budget.canFetch && !cursor.orders.includes(yy)) {
      const index = await fetchOfficialOrdersIndex(yy, courtFetch(budget));
      await syncOfficialOrderIndex(sql, index.entries, index.retrievedAt);
      cursor.orders.push(yy);
    }
    if (budget.canFetch && !cursor.slips.includes(yy)) {
      const index = await fetchOfficialSlipOpinionIndex(yy, courtFetch(budget));
      for (const record of index.records) {
        if (isRestrictedDocketText(record.caseName)) continue;
        await sql`
          INSERT INTO scotus_slip_index (source_record_id, term_year, docket_number, case_name, filed_on, source_url, retrieved_at)
          VALUES (${record.sourceRecordId}, ${yy}, ${record.docketNumber}, ${record.caseName}, ${record.filedOn}, ${record.pdfUrl}, ${index.retrievedAt})
          ON CONFLICT (source_record_id) DO UPDATE SET source_url = EXCLUDED.source_url, retrieved_at = EXCLUDED.retrieved_at`;
      }
      cursor.slips.push(yy);
    }
  }
  await save();
  return {
    ...cursor, alertsQueued: 0, pdfsDownloaded: 0, ranges, skipped: null,
    estimateHours: cursor.complete ? 0 : estimateHistoryHours(cursor, throughYear),
  };
}
