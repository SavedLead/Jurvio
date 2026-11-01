/**
 * Two more free sources, each cross-checked against everything else Jurvio has:
 *   court_site           - district court website opinion lists (providers/courts/site-opinions.ts)
 *   appellate_pacer_rss  - appellate CM/ECF public "Recent Entries" RSS (providers/appellate/pacer-rss.ts)
 *   courtlistener_feed   - CourtListener's public per-court opinion Atom feed, for districts with no
 *                          public PACER RSS and no GovInfo packages (providers/courts/courtlistener-feed.ts)
 * Every item is recorded once in free_source_item. Entries go on the case only
 * when no other source already has the same kind of entry within a day
 * (hasEquivalentEntry). New cases are draft/not_verified; sealed or
 * restricted captions and docket text are never stored. Nothing here publishes.
 */
import type postgres from "postgres";
import type { ArtifactStore } from "../application/artifact-store";
import { isRestrictedDocketText } from "../domain/federal-stream";
import { SITE_OPINION_SOURCES, parseSiteOpinions, type SiteOpinionItem, type SiteOpinionSource } from "../providers/courts/site-opinions";
import { APPELLATE_RSS_COURTS, appellateRssUrl, parseAppellateRss, type AppellateRssItem } from "../providers/appellate/pacer-rss";
import {
  COURTLISTENER_FEED_COURTS, courtListenerFeedUrl, parseCourtListenerFeed, type CourtListenerFeedItem,
} from "../providers/courts/courtlistener-feed";
import { FetchBudget } from "./polite-fetcher";
import {
  findFederalCase, hasEquivalentEntry, insertDocketEntryOnce, matchOrCreateDraftCase, providerId, resolveCourt, storeFeedArtifact,
} from "./persist";
import { errorText, httpStatusOf, recordCourtFetch } from "@/modules/operations/application/court-fetch-log";
import { recordSourceWatermark } from "@/modules/operations/application/court-freshness";

type Sql = ReturnType<typeof postgres>;
type Tx = postgres.TransactionSql;
type Outcome = "matched" | "entry" | "new_case" | "restricted" | "ambiguous" | "unmatched";

export interface FreeSourceOptions {
  fetchImpl?: typeof fetch;
  minIntervalMs?: number;
  now?: Date;
  courts?: readonly string[];
}

export interface FreeSourceCourtResult {
  source: "court_site" | "appellate_pacer_rss" | "courtlistener_feed";
  court: string;
  ok: boolean;
  items: number;
  outcomes: Record<Outcome | "seen_before" | "too_old", number>;
  error?: string;
}

/** Court-site items older than this are left to GovInfo and the backfills. */
const SITE_MAX_AGE_DAYS = 60;

const COURT_NAMES: Readonly<Record<string, string>> = {
  ca2: "Second Circuit", ca4: "Fourth Circuit", ca6: "Sixth Circuit", ca10: "Tenth Circuit", ca11: "Eleventh Circuit",
  cadc: "District of Columbia Circuit", cafc: "Federal Circuit",
};

function emptyOutcomes(): FreeSourceCourtResult["outcomes"] {
  return { matched: 0, entry: 0, new_case: 0, restricted: 0, ambiguous: 0, unmatched: 0, seen_before: 0, too_old: 0 };
}

async function seen(sql: Sql, source: string, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await sql<{ item_key: string }[]>`
    SELECT item_key FROM free_source_item WHERE source = ${source} AND item_key = ANY(${keys}::text[])`;
  return new Set(rows.map((row) => row.item_key));
}

async function mark(tx: Tx, input: { source: string; itemKey: string; courtCode: string; docketNumber: string | null;
  issuedOn: string | null; outcome: Outcome; caseId: string | null }) {
  await tx`
    INSERT INTO free_source_item (source, item_key, court_code, docket_number, issued_on, outcome, case_id)
    VALUES (${input.source}, ${input.itemKey}, ${input.courtCode}, ${input.docketNumber}, ${input.issuedOn}, ${input.outcome}, ${input.caseId})
    ON CONFLICT (source, item_key) DO NOTHING`;
}

async function districtInfo(sql: Sql, courtCode: string) {
  const [row] = await sql<{ jurvio_court_code: string | null; court_name: string }[]>`
    SELECT jurvio_court_code, court_name FROM direct_court_registry WHERE court_code = ${courtCode}`;
  return { code: row?.jurvio_court_code ?? courtCode, name: row?.court_name ?? courtCode.toUpperCase() };
}

// ---------------------------------------------------------------- court sites

export async function runCourtSiteOpinions(sql: Sql, store: ArtifactStore, options: FreeSourceOptions = {}): Promise<FreeSourceCourtResult[]> {
  const sources = SITE_OPINION_SOURCES.filter((source) => !options.courts?.length || options.courts.includes(source.courtCode));
  const results: FreeSourceCourtResult[] = [];
  const provider = await providerId(sql, "official_cmecf");
  for (const source of sources) {
    results.push(await runCourtSite(sql, store, provider, source, options));
  }
  return results;
}

async function runCourtSite(sql: Sql, store: ArtifactStore, provider: string, source: SiteOpinionSource, options: FreeSourceOptions) {
  const result: FreeSourceCourtResult = { source: "court_site", court: source.courtCode, ok: false, items: 0, outcomes: emptyOutcomes() };
  const budget = new FetchBudget({ source: `court_site:${source.courtCode}`, maxRequests: 1, maxMs: 60_000,
    minIntervalMs: options.minIntervalMs ?? 0, fetchImpl: options.fetchImpl });
  const startedAtMs = Date.now();
  const now = options.now ?? new Date();
  const oldest = new Date(now.getTime() - SITE_MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  let body = "";
  let newItems = 0;
  try {
    body = await budget.text(source.url, "text/html");
    const items = parseSiteOpinions(body, source);
    result.items = items.length;
    const artifactId = await storeFeedArtifact(sql, store, { providerId: provider, sourceUri: source.url,
      sourceRecordId: `court-site:${source.courtCode}`, keyPrefix: `district/court-site/${source.courtCode}`, body,
      mediaType: "text/html", metadata: { courtCode: source.courtCode, items: items.length } });
    const known = await seen(sql, "court_site", items.map((item) => item.documentUrl));
    const district = await districtInfo(sql, source.courtCode);
    for (const item of items) {
      if (known.has(item.documentUrl)) { result.outcomes.seen_before += 1; continue; }
      if (item.issuedOn && item.issuedOn < oldest) { result.outcomes.too_old += 1; continue; }
      const outcome = await persistSiteItem(sql, provider, artifactId, { ...item, issuedOn: item.issuedOn ?? today }, district);
      result.outcomes[outcome] += 1;
      if (outcome === "entry" || outcome === "new_case") newItems += 1;
    }
    result.ok = true;
  } catch (error) {
    result.error = errorText(error);
  }
  await recordCourtFetch(sql, { source: "court_site", courtCode: source.courtCode, url: source.url, startedAtMs,
    httpStatus: result.ok ? 200 : httpStatusOf(result.error ?? ""), ok: result.ok, bytes: body ? Buffer.byteLength(body) : null,
    items: result.ok ? result.items : null, newItems: result.ok ? newItems : null, error: result.error ?? null });
  await recordSourceWatermark(sql, { source: "court_site", courtCode: source.courtCode, ok: result.ok, itemsFetched: result.items,
    newCases: result.outcomes.new_case, newEntries: result.outcomes.entry, error: result.error ?? null });
  return result;
}

async function persistSiteItem(sql: Sql, provider: string, artifactId: string, item: SiteOpinionItem,
  district: { code: string; name: string }): Promise<Outcome> {
  return sql.begin(async (tx) => {
    const base = { source: "court_site", itemKey: item.documentUrl, courtCode: item.courtCode, docketNumber: item.docketNumber, issuedOn: item.issuedOn };
    const done = async (outcome: Outcome, caseId: string | null = null) => { await mark(tx, { ...base, outcome, caseId }); return outcome; };
    if (isRestrictedDocketText(item.caption)) return done("restricted");
    if (!item.docketNumber) return done("unmatched");
    const existing = await findFederalCase(tx, { courtCode: district.code, docketNumber: item.docketNumber, district: true });
    if (existing === "ambiguous") return done("ambiguous");
    let caseId = existing;
    let created = false;
    if (!caseId) {
      // Only a full docket (office:yy-type-number) may create a case; anything
      // shorter could split one case into two.
      if (!item.docketComplete) return done("unmatched");
      const courtId = await resolveCourt(tx, { providerId: provider, courtCode: district.code, name: district.name,
        shortName: district.code.toUpperCase(), jurisdiction: "Federal District", artifactId });
      const match = await matchOrCreateDraftCase(tx, { providerId: provider, courtId, courtCode: district.code,
        docketNumber: item.docketNumber, caption: item.caption, filedOn: null, decidedOn: item.issuedOn, artifactId,
        identifierType: "court_site_docket", identifierValue: `${item.courtCode}:${item.docketNumber}` });
      if (match.kind === "restricted") return done("restricted");
      if (match.kind === "ambiguous") return done("ambiguous");
      caseId = match.caseId;
      created = match.kind === "created";
    }
    if (!created && await hasEquivalentEntry(tx, { caseId, filedOn: item.issuedOn, kind: "any", ownPrefix: "court-site:" })) {
      return done("matched", caseId);
    }
    await insertDocketEntryOnce(tx, { caseId, providerId: provider, providerEntryId: `court-site:${item.courtCode}:${item.documentUrl}`,
      entryNumber: item.entryNumber, filedOn: item.issuedOn, description: `Opinion or order posted on the court website: ${item.documentUrl}`,
      entryType: "opinion", importance: "high", artifactId });
    return done(created ? "new_case" : "entry", caseId);
  });
}

// --------------------------------------------------------- appellate CM/ECF RSS

export async function runAppellatePacerRss(sql: Sql, store: ArtifactStore, options: FreeSourceOptions = {}): Promise<FreeSourceCourtResult[]> {
  const courts = APPELLATE_RSS_COURTS.filter((court) => !options.courts?.length || options.courts.includes(court));
  const provider = await providerId(sql, "official_cmecf");
  const results: FreeSourceCourtResult[] = [];
  for (const court of courts) results.push(await runAppellateRssCourt(sql, store, provider, court, options));
  return results;
}

async function runAppellateRssCourt(sql: Sql, store: ArtifactStore, provider: string, court: string, options: FreeSourceOptions) {
  const result: FreeSourceCourtResult = { source: "appellate_pacer_rss", court, ok: false, items: 0, outcomes: emptyOutcomes() };
  const url = appellateRssUrl(court);
  const budget = new FetchBudget({ source: `appellate_pacer_rss:${court}`, maxRequests: 1, maxMs: 60_000,
    minIntervalMs: options.minIntervalMs ?? 0, fetchImpl: options.fetchImpl });
  const startedAtMs = Date.now();
  let body = "";
  let newItems = 0;
  let newest: string | null = null;
  try {
    body = await budget.text(url, "application/rss+xml");
    if (/not configured for feed/i.test(body)) throw new Error(`${court}: appellate RSS is not configured`);
    const items = parseAppellateRss(body, court);
    result.items = items.length;
    const artifactId = await storeFeedArtifact(sql, store, { providerId: provider, sourceUri: url, sourceRecordId: `appellate-rss:${court}`,
      keyPrefix: `appellate/pacer-rss/${court}`, body, mediaType: "application/rss+xml", metadata: { courtCode: court, items: items.length } });
    const known = await seen(sql, "appellate_pacer_rss", items.map((item) => item.entryKey));
    for (const item of items) {
      if (known.has(item.entryKey)) { result.outcomes.seen_before += 1; continue; }
      const outcome = await persistAppellateRssItem(sql, provider, artifactId, item);
      result.outcomes[outcome] += 1;
      if (outcome === "entry" || outcome === "new_case") newItems += 1;
      if (item.filedOn && (!newest || item.filedOn > newest)) newest = item.filedOn;
    }
    result.ok = true;
  } catch (failure) {
    result.error = errorText(failure);
  }
  await recordCourtFetch(sql, { source: "appellate_pacer_rss", courtCode: court, url, startedAtMs,
    httpStatus: result.ok ? 200 : httpStatusOf(result.error ?? ""), ok: result.ok, bytes: body ? Buffer.byteLength(body) : null,
    items: result.ok ? result.items : null, newItems: result.ok ? newItems : null, error: result.error ?? null });
  await recordSourceWatermark(sql, { source: "appellate_pacer_rss", courtCode: court, ok: result.ok, itemsFetched: result.items,
    newCases: result.outcomes.new_case, newEntries: result.outcomes.entry, newestItemAt: newest ? `${newest}T00:00:00Z` : null,
    error: result.error ?? null });
  return result;
}

async function persistAppellateRssItem(sql: Sql, provider: string, artifactId: string, item: AppellateRssItem): Promise<Outcome> {
  return sql.begin(async (tx) => {
    const base = { source: "appellate_pacer_rss", itemKey: item.entryKey, courtCode: item.courtCode, docketNumber: item.docketNumber, issuedOn: item.filedOn };
    const done = async (outcome: Outcome, caseId: string | null = null) => { await mark(tx, { ...base, outcome, caseId }); return outcome; };
    if (isRestrictedDocketText(item.caption) || isRestrictedDocketText(item.entryText)) return done("restricted");
    const courtId = await resolveCourt(tx, { providerId: provider, courtCode: item.courtCode, artifactId,
      name: `United States Court of Appeals for the ${COURT_NAMES[item.courtCode] ?? item.courtCode}`,
      shortName: item.courtCode.toUpperCase(), jurisdiction: "Federal Appellate" });
    const match = await matchOrCreateDraftCase(tx, { providerId: provider, courtId, courtCode: item.courtCode,
      docketNumber: item.docketNumber, caption: item.caption, filedOn: null,
      decidedOn: item.kind === "opinion" || item.kind === "judgment" ? item.filedOn : null, artifactId,
      identifierType: "official_appellate_docket", identifierValue: `${item.courtCode}:${item.docketNumber}` });
    if (match.kind === "restricted") return done("restricted");
    if (match.kind === "ambiguous") return done("ambiguous");
    const created = match.kind === "created";
    if (!created && item.kind !== "other"
      && await hasEquivalentEntry(tx, { caseId: match.caseId, filedOn: item.filedOn, kind: item.kind, ownPrefix: "appellate-rss:" })) {
      return done("matched", match.caseId);
    }
    await insertDocketEntryOnce(tx, { caseId: match.caseId, providerId: provider,
      providerEntryId: `appellate-rss:${item.courtCode}:${item.entryKey}`, entryNumber: null, filedOn: item.filedOn,
      description: item.entryText, entryType: item.kind === "opinion" ? "opinion" : item.kind === "other" ? "filing" : "order",
      importance: item.kind === "other" ? "routine" : "high", artifactId });
    return done(created ? "new_case" : "entry", match.caseId);
  });
}

// ------------------------------------------------ CourtListener per-court feeds

export async function runCourtListenerFeeds(sql: Sql, store: ArtifactStore, options: FreeSourceOptions = {}): Promise<FreeSourceCourtResult[]> {
  const courts = COURTLISTENER_FEED_COURTS.filter((court) => !options.courts?.length || options.courts.includes(court));
  const official = await providerId(sql, "official_cmecf");
  const courtlistener = await providerId(sql, "courtlistener");
  const results: FreeSourceCourtResult[] = [];
  for (const court of courts) results.push(await runCourtListenerFeedCourt(sql, store, { official, courtlistener }, court, options));
  return results;
}

async function runCourtListenerFeedCourt(sql: Sql, store: ArtifactStore, providers: { official: string; courtlistener: string },
  court: string, options: FreeSourceOptions) {
  const result: FreeSourceCourtResult = { source: "courtlistener_feed", court, ok: false, items: 0, outcomes: emptyOutcomes() };
  const url = courtListenerFeedUrl(court);
  const budget = new FetchBudget({ source: `courtlistener_feed:${court}`, maxRequests: 1, maxMs: 60_000,
    minIntervalMs: options.minIntervalMs ?? 0, fetchImpl: options.fetchImpl });
  const startedAtMs = Date.now();
  const now = options.now ?? new Date();
  const oldest = new Date(now.getTime() - SITE_MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  let body = "";
  let newItems = 0;
  let newest: string | null = null;
  try {
    body = await budget.text(url, "application/atom+xml");
    const items = parseCourtListenerFeed(body, court);
    result.items = items.length;
    const artifactId = await storeFeedArtifact(sql, store, { providerId: providers.courtlistener, sourceUri: url,
      sourceRecordId: `cl-feed:${court}`, keyPrefix: `district/courtlistener-feed/${court}`, body,
      mediaType: "application/atom+xml", metadata: { courtCode: court, items: items.length } });
    const known = await seen(sql, "courtlistener_feed", items.map((item) => item.itemKey));
    const district = await districtInfo(sql, court);
    for (const item of items) {
      if (known.has(item.itemKey)) { result.outcomes.seen_before += 1; continue; }
      if (!item.issuedOn || item.issuedOn < oldest) { result.outcomes.too_old += 1; continue; }
      const outcome = await persistCourtListenerItem(sql, providers, artifactId, item, district);
      result.outcomes[outcome] += 1;
      if (outcome === "entry" || outcome === "new_case") newItems += 1;
      if (!newest || item.issuedOn > newest) newest = item.issuedOn;
    }
    result.ok = true;
  } catch (failure) {
    result.error = errorText(failure);
  }
  await recordCourtFetch(sql, { source: "courtlistener_feed", courtCode: court, url, startedAtMs,
    httpStatus: result.ok ? 200 : httpStatusOf(result.error ?? ""), ok: result.ok, bytes: body ? Buffer.byteLength(body) : null,
    items: result.ok ? result.items : null, newItems: result.ok ? newItems : null, error: result.error ?? null });
  await recordSourceWatermark(sql, { source: "courtlistener_feed", courtCode: court, ok: result.ok, itemsFetched: result.items,
    newCases: result.outcomes.new_case, newEntries: result.outcomes.entry, newestItemAt: newest ? `${newest}T00:00:00Z` : null,
    error: result.error ?? null });
  return result;
}

async function persistCourtListenerItem(sql: Sql, providers: { official: string; courtlistener: string }, artifactId: string,
  item: CourtListenerFeedItem, district: { code: string; name: string }): Promise<Outcome> {
  return sql.begin(async (tx) => {
    const base = { source: "courtlistener_feed", itemKey: item.itemKey, courtCode: item.courtCode, docketNumber: item.docketNumber, issuedOn: item.issuedOn };
    const done = async (outcome: Outcome, caseId: string | null = null) => { await mark(tx, { ...base, outcome, caseId }); return outcome; };
    if (isRestrictedDocketText(item.caption) || isRestrictedDocketText(item.header)) return done("restricted");
    if (item.otherCourt || !item.docketNumber) return done("unmatched");
    const existing = await findFederalCase(tx, { courtCode: district.code, docketNumber: item.docketNumber, district: true });
    if (existing === "ambiguous") return done("ambiguous");
    let caseId = existing;
    let created = false;
    if (!caseId) {
      // Only a full docket (office:yy-type-number) may create a case.
      if (!item.docketComplete) return done("unmatched");
      const courtId = await resolveCourt(tx, { providerId: providers.official, courtCode: district.code, name: district.name,
        shortName: district.code.toUpperCase(), jurisdiction: "Federal District", artifactId });
      const match = await matchOrCreateDraftCase(tx, { providerId: providers.official, courtId, courtCode: district.code,
        docketNumber: item.docketNumber, caption: item.caption, filedOn: null, decidedOn: item.issuedOn, artifactId,
        identifierType: "courtlistener_feed_docket", identifierValue: `${item.courtCode}:${item.docketNumber}` });
      if (match.kind === "restricted") return done("restricted");
      if (match.kind === "ambiguous") return done("ambiguous");
      caseId = match.caseId;
      created = match.kind === "created";
    }
    if (!created && await hasEquivalentEntry(tx, { caseId, filedOn: item.issuedOn, kind: "opinion", ownPrefix: "cl-feed:" })) {
      return done("matched", caseId);
    }
    // RECAP document numbers are the court's own docket numbers: the same
    // number on the case from another source (district RSS) is the same filing.
    if (!created && item.entryNumber) {
      const [same] = await tx<{ id: string }[]>`
        SELECT id FROM docket_entry WHERE case_id = ${caseId} AND entry_number = ${item.entryNumber}
          AND coalesce(provider_entry_id, '') NOT LIKE 'cl-feed:%' LIMIT 1`;
      if (same) return done("matched", caseId);
    }
    await insertDocketEntryOnce(tx, { caseId, providerId: providers.courtlistener,
      providerEntryId: `cl-feed:${item.courtCode}:${item.opinionId ?? item.itemKey}`, entryNumber: item.entryNumber, filedOn: item.issuedOn,
      description: `Opinion (CourtListener court feed): ${item.documentUrl}`, entryType: "opinion", importance: "high", artifactId });
    return done(created ? "new_case" : "entry", caseId);
  });
}
