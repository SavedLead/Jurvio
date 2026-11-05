/**
 * Live feed runs. Each source (and each court of appeals inside the COA
 * source) has its own fetch budget and its own try/catch, so one failing
 * court never blocks the others. Every attempt is recorded in
 * court_source_watermark and the touched courts' court_freshness rows are
 * recomputed at the end.
 */
import type postgres from "postgres";
import type { ArtifactStore } from "../application/artifact-store";
import { readSourceWatermark, recordSourceWatermark, refreshCourtFreshness } from "@/modules/operations/application/court-freshness";
import { coaEntryDescription, normalizeDocket } from "./coa-feeds";
import { CIRCUIT_ADAPTERS, circuitAdapter, dedupeAdapterItems, type AdapterItem } from "../providers/appellate/adapters";
import { FetchBudget, RateLimitedError } from "./polite-fetcher";
import { entryImportance } from "../providers/scotus/official-docket";
import { errorText, httpStatusOf, recordCourtFetch } from "@/modules/operations/application/court-fetch-log";
import { matchOrCreateDraftCase, insertDocketEntryOnce, providerId, resolveCourt, storeFeedArtifact, hasEquivalentEntry } from "./persist";
import {
  DEFAULT_DISCOVERY, discoverSeries, parseScotusCursor, parseScotusDocketJson, scotusDocketJsonUrl, scotusSeries,
  type ScotusCursor, type ScotusDocket,
} from "./scotus-docket-feed";

type Sql = ReturnType<typeof postgres>;

export interface SourceRunResult {
  source: string;
  court: string;
  ok: boolean;
  requests: number;
  itemsFetched: number;
  newCases: number;
  newEntries: number;
  skippedRestricted: number;
  skippedAmbiguous: number;
  /** Items another source had already recorded (cross-source dedupe). */
  skippedDuplicate?: number;
  error?: string;
  retryAfterUntil?: string | null;
}

function emptyResult(source: string, court: string): SourceRunResult {
  return { source, court, ok: false, requests: 0, itemsFetched: 0, newCases: 0, newEntries: 0, skippedRestricted: 0, skippedAmbiguous: 0 };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export interface LiveFeedOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  scotus?: { maxRequests: number; maxMs: number; minIntervalMs: number; backfillPerRun: number };
  coa?: { maxRequestsPerCourt: number; maxMsPerCourt: number; minIntervalMs: number; courts?: readonly string[] };
}

const SCOTUS_DEFAULTS = { maxRequests: 240, maxMs: 8 * 60_000, minIntervalMs: 1_000, backfillPerRun: 40 };
const COA_DEFAULTS = { maxRequestsPerCourt: 4, maxMsPerCourt: 90_000, minIntervalMs: 1_500 };

/** SCOTUS: discover new dockets on supremecourt.gov and store them as draft cases. */
export async function runScotusLiveDockets(sql: Sql, store: ArtifactStore, options: LiveFeedOptions = {}): Promise<SourceRunResult> {
  const result = emptyResult("scotus_official", "scotus");
  const config = { ...SCOTUS_DEFAULTS, ...options.scotus };
  const budget = new FetchBudget({ source: "scotus_official", maxRequests: config.maxRequests, maxMs: config.maxMs,
    minIntervalMs: config.minIntervalMs, fetchImpl: options.fetchImpl });
  let cursor: ScotusCursor = {};
  let newestItemAt: string | null = null;
  try {
    const provider = await providerId(sql, "scotus_official");
    cursor = parseScotusCursor((await readSourceWatermark(sql, "scotus_official", "scotus"))?.cursor_value);
    const now = options.now?.() ?? new Date();
    for (const series of scotusSeries(now)) {
      const outcome = await discoverSeries(series, cursor[series.key] ?? { high: null, low: null }, {
        canFetch: () => budget.canFetch,
        probe: async (docketNumber) => {
          const response = await budget.get(scotusDocketJsonUrl(docketNumber), "application/json");
          if (response.status === 404) return null;
          if (!response.ok) throw new Error(`docket ${docketNumber} returned HTTP ${response.status}`);
          const body = await response.text();
          let parsed: ScotusDocket | null = null;
          try { parsed = parseScotusDocketJson(JSON.parse(body)); } catch { parsed = null; }
          if (parsed) {
            result.itemsFetched += 1;
            (parsed as ScotusDocket & { rawBody?: string }).rawBody = body;
          }
          return parsed;
        },
        known: async (docketNumber) => {
          const [row] = await sql<{ id: string }[]>`
            SELECT legal_case.id FROM legal_case JOIN court ON court.id = legal_case.court_id
            WHERE lower(court.provider_court_id) = 'scotus'
              AND lower(regexp_replace(legal_case.docket_number, '[^a-zA-Z0-9]', '', 'g'))
                = lower(regexp_replace(${docketNumber}, '[^a-zA-Z0-9]', '', 'g'))
            LIMIT 1`;
          return Boolean(row);
        },
        persist: async (docket) => {
          const counts = await persistScotusDocket(sql, store, provider, docket);
          result.newCases += counts.newCase ? 1 : 0;
          result.newEntries += counts.newEntries;
          if (counts.restricted) result.skippedRestricted += 1;
          if (counts.ambiguous) result.skippedAmbiguous += 1;
          const last = docket.entries.at(-1)?.filedOn ?? docket.docketedOn;
          if (last && (!newestItemAt || last > newestItemAt)) newestItemAt = last;
        },
      }, { ...DEFAULT_DISCOVERY, backfillPerRun: config.backfillPerRun });
      cursor[series.key] = outcome.cursor;
    }
    result.ok = !budget.rateLimited;
    if (budget.rateLimited) {
      result.error = budget.rateLimited.message;
      result.retryAfterUntil = budget.rateLimited.retryAfterUntil?.toISOString() ?? null;
    }
  } catch (error) {
    result.error = message(error);
    if (error instanceof RateLimitedError) result.retryAfterUntil = error.retryAfterUntil?.toISOString() ?? null;
  }
  result.requests = budget.requests;
  await recordSourceWatermark(sql, {
    source: "scotus_official", courtCode: "scotus", ok: result.ok, cursor: JSON.stringify(cursor),
    itemsFetched: result.itemsFetched, newCases: result.newCases, newEntries: result.newEntries,
    newestItemAt: newestItemAt ? `${newestItemAt}T00:00:00Z` : null,
    retryAfterUntil: result.retryAfterUntil ?? null, error: result.error ?? null,
  });
  return result;
}

async function persistScotusDocket(sql: Sql, store: ArtifactStore, provider: string, docket: ScotusDocket & { rawBody?: string }) {
  return sql.begin(async (tx) => {
    const artifactId = await storeFeedArtifact(tx, store, {
      providerId: provider, sourceUri: scotusDocketJsonUrl(docket.docketNumber), sourceRecordId: `docket-json:${docket.docketNumber}`,
      keyPrefix: `scotus/docket-json/${docket.docketNumber}`, body: docket.rawBody ?? JSON.stringify(docket),
      mediaType: "application/json", metadata: { docketNumber: docket.docketNumber, entryCount: docket.entries.length },
    });
    const courtId = await resolveCourt(tx, { providerId: provider, courtCode: "scotus",
      name: "Supreme Court of the United States", shortName: "SCOTUS", jurisdiction: "Federal Supreme", artifactId });
    const match = await matchOrCreateDraftCase(tx, {
      providerId: provider, courtId, courtCode: "scotus", docketNumber: docket.docketNumber, caption: docket.caption,
      filedOn: docket.docketedOn, artifactId, identifierType: "scotus_docket", identifierValue: docket.docketNumber,
    });
    if (match.kind === "restricted" || match.kind === "ambiguous") {
      return { newCase: false, newEntries: 0, restricted: match.kind === "restricted", ambiguous: match.kind === "ambiguous" };
    }
    let newEntries = 0;
    for (const entry of docket.entries) {
      const created = await insertDocketEntryOnce(tx, {
        caseId: match.caseId, providerId: provider, providerEntryId: entry.sourceRecordId, entryNumber: entry.entryNumber,
        filedOn: entry.filedOn, description: entry.description, entryType: entry.eventType,
        importance: entryImportance(entry.eventType, entry.description, docket.docketNumber),
        artifactId,
      });
      if (created) newEntries += 1;
    }
    return { newCase: match.kind === "created", newEntries, restricted: false, ambiguous: false };
  });
}

const COA_NAMES: Record<string, string> = {
  ca1: "First Circuit", ca2: "Second Circuit", ca3: "Third Circuit", ca4: "Fourth Circuit", ca5: "Fifth Circuit",
  ca6: "Sixth Circuit", ca7: "Seventh Circuit", ca8: "Eighth Circuit", ca9: "Ninth Circuit", ca10: "Tenth Circuit",
  ca11: "Eleventh Circuit", cadc: "D.C. Circuit", cafc: "Federal Circuit",
};

/** One court of appeals: fetch its listings inside its own budget and store the items. */
export async function runCoaCourt(sql: Sql, store: ArtifactStore, courtCode: string, options: LiveFeedOptions = {}): Promise<SourceRunResult> {
  const result = emptyResult("coa_feed", courtCode);
  const config = { ...COA_DEFAULTS, ...options.coa };
  const budget = new FetchBudget({ source: `coa_feed:${courtCode}`, maxRequests: config.maxRequestsPerCourt,
    maxMs: config.maxMsPerCourt, minIntervalMs: config.minIntervalMs, fetchImpl: options.fetchImpl });
  let newest: string | null = null;
  const errors: string[] = [];
  try {
    const provider = await providerId(sql, "official_cmecf");
    const adapter = circuitAdapter(courtCode);
    if (!adapter) throw new Error(`no live feed configured for ${courtCode}`);
    let succeededSources = 0;
    for (const source of adapter.requests(new Date())) {
      const startedAtMs = Date.now();
      let fetched = false;
      let bytes = 0;
      let parsed = 0;
      const before = result.newCases + result.newEntries;
      try {
        const body = await budget.text(source.url, undefined, { method: source.method, body: source.body });
        fetched = true;
        bytes = Buffer.byteLength(body);
        const items = dedupeAdapterItems(adapter.parse(body, source));
        const artifactId = await storeFeedArtifact(sql, store, {
          providerId: provider, sourceUri: source.url, sourceRecordId: `coa-feed:${courtCode}`,
          keyPrefix: `appellate/live-feed/${courtCode}`, body,
          mediaType: /^\s*<\?xml|<rss\b/i.test(body.slice(0, 500)) ? "application/rss+xml" : "text/html",
          metadata: { courtCode, items: items.length, listing: source.label },
        });
        result.itemsFetched += items.length;
        parsed = items.length;
        for (const item of items) {
          await persistCoaItem(sql, provider, artifactId, item, result);
          if (item.releasedOn && (!newest || item.releasedOn > newest)) newest = item.releasedOn;
        }
        succeededSources += 1;
        await recordCourtFetch(sql, {
          source: "coa_feed", courtCode, url: source.url, startedAtMs, httpStatus: 200, ok: true, bytes,
          items: parsed, newItems: result.newCases + result.newEntries - before,
        });
      } catch (error) {
        errors.push(message(error));
        await recordCourtFetch(sql, {
          source: "coa_feed", courtCode, url: source.url, startedAtMs,
          httpStatus: fetched ? 200 : (error instanceof RateLimitedError ? 429 : httpStatusOf(error)),
          ok: false, bytes: fetched ? bytes : null, error: errorText(error),
        });
        if (error instanceof RateLimitedError) {
          result.retryAfterUntil = error.retryAfterUntil?.toISOString() ?? null;
          break;
        }
      }
    }
    result.ok = succeededSources > 0;
  } catch (error) {
    errors.push(message(error));
  }
  if (errors.length) result.error = errors.join("; ");
  result.requests = budget.requests;
  await recordSourceWatermark(sql, {
    source: "coa_feed", courtCode, ok: result.ok, cursor: newest, itemsFetched: result.itemsFetched,
    newCases: result.newCases, newEntries: result.newEntries, newestItemAt: newest ? `${newest}T00:00:00Z` : null,
    retryAfterUntil: result.retryAfterUntil ?? null, error: result.error ?? null,
  });
  return result;
}

async function persistCoaItem(sql: Sql, provider: string, artifactId: string, item: AdapterItem, result: SourceRunResult) {
  await sql.begin(async (tx) => {
    const courtId = await resolveCourt(tx, { providerId: provider, courtCode: item.courtCode,
      name: `United States Court of Appeals for the ${COA_NAMES[item.courtCode] ?? item.courtCode}`,
      shortName: item.courtCode.toUpperCase(), jurisdiction: "Federal Appellate", artifactId });
    const match = await matchOrCreateDraftCase(tx, {
      providerId: provider, courtId, courtCode: item.courtCode, docketNumber: item.docketNumber, caption: item.caption,
      filedOn: null, decidedOn: item.kind === "order" ? null : item.releasedOn, artifactId, identifierType: "official_appellate_docket",
      identifierValue: `${item.courtCode}:${item.docketNumber}`,
    });
    if (match.kind === "restricted") { result.skippedRestricted += 1; return; }
    if (match.kind === "ambiguous") { result.skippedAmbiguous += 1; return; }
    if (match.kind === "created") result.newCases += 1;
    // Already listed by another free source (appellate CM/ECF RSS, GovInfo) on that day: do not list it twice.
    if (match.kind === "existing" && await hasEquivalentEntry(tx, { caseId: match.caseId, filedOn: item.releasedOn,
      kind: item.kind === "order" ? "order" : "opinion", ownPrefix: "coa-feed:", includeDocuments: false })) {
      result.skippedDuplicate = (result.skippedDuplicate ?? 0) + 1;
      return;
    }
    // One PDF can decide consolidated appeals listed under several dockets, so
    // the entry id carries the docket as well as the document.
    const created = await insertDocketEntryOnce(tx, {
      caseId: match.caseId, providerId: provider, providerEntryId: `coa-feed:${item.courtCode}:${normalizeDocket(item.docketNumber)}:${item.entryKeyUrl ?? item.documentUrl}`, entryNumber: null,
      filedOn: item.releasedOn, description: `${coaEntryDescription(item)}: ${item.documentUrl}`,
      entryType: item.kind === "order" ? "order" : "opinion", importance: item.kind === "order" ? "routine" : "high", artifactId,
    });
    if (created) result.newEntries += 1;
  });
}

/** All configured courts of appeals, one isolated budget each. */
export async function runCoaLiveFeeds(sql: Sql, store: ArtifactStore, options: LiveFeedOptions = {}): Promise<SourceRunResult[]> {
  const courts = options.coa?.courts ?? Object.keys(CIRCUIT_ADAPTERS);
  const results: SourceRunResult[] = [];
  for (const court of courts) {
    try {
      results.push(await runCoaCourt(sql, store, court, options));
    } catch (error) {
      // Even recording the watermark failed (database trouble): report and move on.
      results.push({ ...emptyResult("coa_feed", court), error: message(error) });
    }
  }
  return results;
}

export async function refreshTouchedCourts(sql: Sql, results: readonly SourceRunResult[]) {
  const courts = [...new Set(results.map((result) => result.court).filter((court) => court !== "_all"))];
  return refreshCourtFreshness(sql, { courtCodes: courts });
}
