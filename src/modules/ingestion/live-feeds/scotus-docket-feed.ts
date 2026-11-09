/**
 * Supreme Court new-docket discovery. supremecourt.gov publishes one JSON
 * document per docket (RSS/Cases/JSON/{docket}.json) and returns 404 for a
 * number not yet assigned. Docket numbers are sequential per series within a
 * docket year, so new filings are found by probing just past the highest known
 * number. Pure logic here; fetching and storage are injected.
 */
import { isRestrictedDocketText } from "../domain/federal-stream";
import { classifyEvent, decodeHtml, isoLongDate } from "../providers/scotus/official-docket";

export const SCOTUS_JSON_ORIGIN = "https://www.supremecourt.gov/RSS/Cases/JSON";

export function scotusDocketJsonUrl(docketNumber: string): string {
  return `${SCOTUS_JSON_ORIGIN}/${encodeURIComponent(docketNumber)}.json`;
}

export interface ScotusDocketEntry {
  /** Same id the HTML enrichment (ingest-official-scotus-dockets) writes, so both stay idempotent. */
  sourceRecordId: string;
  entryNumber: string;
  filedOn: string;
  description: string;
  eventType: string;
}

export interface ScotusCounsel {
  side: "petitioner" | "respondent" | "other";
  name: string;
  firm: string | null;
  counselOfRecord: boolean;
}

export interface ScotusFilingLink {
  sourceUrl: string;
  description: string;
  filedOn: string;
}

export interface ScotusDocket {
  docketNumber: string;
  caption: string;
  docketedOn: string | null;
  caseType: string | null;
  lowerCourt: string | null;
  entries: ScotusDocketEntry[];
  /** Counsel named on the Court's JSON. No CourtListener party record. */
  counsel: ScotusCounsel[];
  /** Filing PDF links. Bytes are not downloaded here, so there is no checksum yet. */
  filings: ScotusFilingLink[];
}

function partyName(value: unknown): string {
  return typeof value === "string"
    ? decodeHtml(value).replace(/,\s*(?:Petitioners?|Applicants?|Respondents?|Appellants?|Appellees?|Plaintiffs?|Defendants?)\s*$/i, "").trim()
    : "";
}

/** Parse one docket JSON document. Returns null when it is not a docket. */
export function parseScotusDocketJson(input: unknown): ScotusDocket | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const docketNumber = typeof record.CaseNumber === "string" ? record.CaseNumber.trim() : "";
  if (!/^[0-9]{2}(?:-[0-9]+|A[0-9]+|O[0-9]+|M[0-9]+)$/i.test(docketNumber)) return null;
  const petitioner = partyName(record.PetitionerTitle);
  const respondent = partyName(record.RespondentTitle);
  const caption = petitioner && respondent ? `${petitioner} v. ${respondent}` : petitioner || respondent;
  if (caption.length < 3) return null;
  const proceedings = Array.isArray(record.ProceedingsandOrder) ? record.ProceedingsandOrder : [];
  const entries: ScotusDocketEntry[] = [];
  const filings: ScotusFilingLink[] = [];
  for (const raw of proceedings) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const filedOn = typeof row.Date === "string" ? isoLongDate(row.Date) : null;
    const description = typeof row.Text === "string" ? decodeHtml(row.Text) : "";
    if (!filedOn || !description) continue;
    const index = entries.length + 1;
    entries.push({
      sourceRecordId: `${docketNumber}:event:${filedOn}:${index}`,
      entryNumber: String(index),
      filedOn,
      description,
      eventType: classifyEvent(description),
    });
    const links = Array.isArray(row.Links) ? row.Links : [];
    for (const link of links) {
      if (!link || typeof link !== "object") continue;
      const url = typeof (link as { DocumentUrl?: unknown }).DocumentUrl === "string"
        ? (link as { DocumentUrl: string }).DocumentUrl.trim() : "";
      let parsed: URL;
      try { parsed = new URL(url); } catch { continue; }
      if (parsed.protocol !== "https:" || parsed.hostname !== "www.supremecourt.gov") continue;
      if (isRestrictedDocketText(description)) continue;
      const label = typeof (link as { Description?: unknown }).Description === "string"
        ? decodeHtml((link as { Description: string }).Description) : "Filing";
      if (isRestrictedDocketText(label)) continue;
      filings.push({ sourceUrl: parsed.toString(), description: label, filedOn });
    }
  }
  return {
    docketNumber,
    caption,
    docketedOn: typeof record.DocketedDate === "string" ? isoLongDate(record.DocketedDate) : null,
    caseType: typeof record.sJsonCaseType === "string" ? record.sJsonCaseType : null,
    lowerCourt: typeof record.LowerCourt === "string" && record.LowerCourt.trim() ? decodeHtml(record.LowerCourt) : null,
    entries,
    counsel: readCounsel(record),
    filings,
  };
}

function readCounsel(record: Record<string, unknown>): ScotusCounsel[] {
  const groups = [["Petitioner", "petitioner"], ["Respondent", "respondent"], ["Other", "other"]] as const;
  const counsel: ScotusCounsel[] = [];
  for (const [key, side] of groups) {
    const rows = record[key];
    if (!Array.isArray(rows)) continue;
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const name = typeof row.Attorney === "string" ? decodeHtml(row.Attorney).trim() : "";
      if (name.length < 2 || isRestrictedDocketText(name)) continue;
      const firm = typeof row.Title === "string" && row.Title.trim() ? decodeHtml(row.Title).trim() : null;
      counsel.push({ side, name, firm, counselOfRecord: row.IsCounselofRecord === true });
    }
  }
  return counsel;
}

export interface ScotusSeries {
  key: string;
  first: number;
  last: number;
  docket(n: number): string;
}

/** Docket year: numbering restarts with the new docket year on July 1. */
export function scotusDocketYear(now: Date): number {
  const year = now.getUTCFullYear();
  return (now.getUTCMonth() >= 6 ? year : year - 1) % 100;
}

/** Paid petitions (26-1..), in forma pauperis (26-5001..) and applications (26A1..). */
export function scotusSeries(now: Date): ScotusSeries[] {
  const yy = String(scotusDocketYear(now)).padStart(2, "0");
  return [
    { key: `${yy}-paid`, first: 1, last: 4999, docket: (n) => `${yy}-${n}` },
    { key: `${yy}-ifp`, first: 5001, last: 9999, docket: (n) => `${yy}-${n}` },
    { key: `${yy}-app`, first: 1, last: 4999, docket: (n) => `${yy}A${n}` },
  ];
}

export interface SeriesCursor {
  /** Highest docket number seen to exist. */
  high: number | null;
  /** Lowest number the newest-first backfill has reached. */
  low: number | null;
}

export type ScotusCursor = Record<string, SeriesCursor>;

export function parseScotusCursor(value: string | null | undefined): ScotusCursor {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: ScotusCursor = {};
    for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = raw as Partial<SeriesCursor> | null;
      out[key] = {
        high: Number.isInteger(entry?.high) ? (entry!.high as number) : null,
        low: Number.isInteger(entry?.low) ? (entry!.low as number) : null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export interface DiscoveryDeps {
  /** Fetch one docket; null when it does not exist (404). Throws on budget/429. */
  probe(docketNumber: string): Promise<ScotusDocket | null>;
  /** True when Jurvio already has this docket (no request needed for backfill). */
  known(docketNumber: string): Promise<boolean>;
  /** Store one docket (draft case + entries). */
  persist(docket: ScotusDocket): Promise<void>;
  /** False once the source budget is spent. */
  canFetch(): boolean;
}

export interface DiscoveryOptions {
  /** Consecutive missing numbers that mean "no newer filings yet". */
  missesToStop: number;
  /** Max dockets fetched while walking back from the frontier, per run. */
  backfillPerRun: number;
  /** Numbers probed around a gap before deciding a range is empty. */
  gapTolerance: number;
}

export const DEFAULT_DISCOVERY: DiscoveryOptions = { missesToStop: 5, backfillPerRun: 40, gapTolerance: 3 };

export interface SeriesResult {
  series: string;
  cursor: SeriesCursor;
  probes: number;
  found: number;
  persisted: string[];
}

/**
 * One series, newest first:
 * 1. With no cursor, find the frontier (highest existing number) by galloping
 *    then binary search, so the first run starts at today's filings.
 * 2. Probe upward from the frontier until `missesToStop` consecutive misses.
 * 3. Spend what is left walking downward from the lowest number reached,
 *    skipping dockets Jurvio already has, until the series start.
 */
export async function discoverSeries(
  series: ScotusSeries,
  start: SeriesCursor,
  deps: DiscoveryDeps,
  options: DiscoveryOptions = DEFAULT_DISCOVERY,
): Promise<SeriesResult> {
  const cursor: SeriesCursor = { ...start };
  const cache = new Map<number, ScotusDocket | null>();
  const persisted: string[] = [];
  let probes = 0;

  const fetchNumber = async (n: number): Promise<ScotusDocket | null> => {
    if (cache.has(n)) return cache.get(n)!;
    probes += 1;
    const docket = await deps.probe(series.docket(n));
    cache.set(n, docket);
    return docket;
  };
  const store = async (n: number) => {
    const docket = cache.get(n);
    if (!docket || persisted.includes(docket.docketNumber)) return;
    await deps.persist(docket);
    persisted.push(docket.docketNumber);
  };
  /** First existing number in [n, n + gapTolerance), or null. */
  const existsNear = async (n: number): Promise<number | null> => {
    for (let k = n; k < n + options.gapTolerance && k <= series.last; k += 1) {
      if (await fetchNumber(k)) return k;
    }
    return null;
  };

  try {
    if (cursor.high === null) {
      const firstHit = await existsNear(series.first);
      if (firstHit === null) return { series: series.key, cursor, probes, found: 0, persisted };
      let lo = firstHit;
      let step = 1;
      let hi: number | null = null;
      while (hi === null) {
        const candidate = Math.min(series.last, lo + step);
        const hit = await existsNear(candidate);
        if (hit === null) hi = candidate;
        else if (candidate >= series.last) { lo = hit; hi = series.last + 1; }
        else { lo = hit; step *= 2; }
      }
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const hit = await existsNear(mid);
        if (hit === null) hi = mid;
        else lo = Math.max(lo, hit);
      }
      cursor.high = lo;
      cursor.low = lo + 1;
    }

    // 2. New filings above the frontier.
    let misses = 0;
    let n = cursor.high + 1;
    const fresh: number[] = [];
    while (misses < options.missesToStop && n <= series.last && deps.canFetch()) {
      if (await fetchNumber(n)) { fresh.push(n); misses = 0; cursor.high = n; }
      else misses += 1;
      n += 1;
    }
    for (const hit of fresh.reverse()) await store(hit);

    // 3. Newest-first backfill below the frontier.
    if (cursor.low === null) cursor.low = cursor.high + 1;
    let fetched = 0;
    let next = Math.min(cursor.low - 1, cursor.high);
    while (next >= series.first && fetched < options.backfillPerRun && deps.canFetch()) {
      const docketNumber = series.docket(next);
      if (!cache.has(next) && await deps.known(docketNumber)) {
        cursor.low = next;
        next -= 1;
        continue;
      }
      const docket = await fetchNumber(next);
      fetched += 1;
      if (docket) await store(next);
      cursor.low = next;
      next -= 1;
    }
  } catch (error) {
    // Budget or rate limit: keep what was learned so the next run resumes here.
    if (!(error instanceof Error) || !/budget exhausted|HTTP 429/.test(error.message)) throw error;
  }
  return { series: series.key, cursor, probes, found: persisted.length, persisted };
}
