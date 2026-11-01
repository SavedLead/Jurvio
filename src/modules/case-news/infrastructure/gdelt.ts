import { RateLimitedError, type FetchBudget } from "@/modules/ingestion/live-feeds/polite-fetcher";
import type { CaseNewsTerms, PartyTerm } from "../domain/case-terms";

export const GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc";
/** GDELT asks for at most one request every 5 seconds. */
export const GDELT_MIN_INTERVAL_MS = 6_000;

export interface GdeltArticle {
  url: string;
  title: string;
  domain: string;
  publishedAt: Date;
  language: string | null;
}

function quoteTerm(value: string): string | null {
  const cleaned = value.replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 3) return null;
  return /\s|[-.'’&]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

function partyQueryTerm(party: PartyTerm | null): string | null {
  if (!party) return null;
  const value = party.kind === "organization" && party.anchor && party.anchorDistinctiveness === 1 ? party.anchor : party.key;
  return value ? quoteTerm(value) : null;
}

function orGroup(terms: string[]): string | null {
  const quoted = terms.map(quoteTerm).filter((term): term is string => Boolean(term));
  if (!quoted.length) return null;
  return quoted.length === 1 ? quoted[0]! : `(${quoted.join(" OR ")})`;
}

/**
 * GDELT full-text query for a case: both named sides (when searchable) and the
 * court. Every returned article is guaranteed to contain all terms in its text,
 * which is the "court in full text" evidence the matcher relies on.
 */
export function buildPartiesQuery(terms: CaseNewsTerms): string | null {
  const court = orGroup(terms.courtTerms);
  if (!court) return null;
  const left = partyQueryTerm(terms.left);
  const right = partyQueryTerm(terms.right);
  const parts = [left, right].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return null;
  // One side only (e.g. "United States v. Acme Corp"): the other side cannot be searched by name.
  if (parts.length === 1 && Math.max(terms.left.distinctiveness, terms.right?.distinctiveness ?? 0) < 1) return null;
  return `${parts.join(" ")} ${court} sourcelang:english`;
}

/** Docket query for district-style dockets ("24-cv-01234"), which are distinctive on their own. */
export function buildDocketQuery(docketNumber: string, terms: CaseNewsTerms): string | null {
  if (!terms.docketDistinctive) return null;
  const match = docketNumber.match(/^(?:\d+:)?(\d{2})-([a-z]{2,4})-0*(\d{1,6})/i);
  if (!match) return null;
  const [, year, kind, number] = match;
  const padded = number!.padStart(5, "0");
  const variants = [...new Set([`${year}-${kind!.toLowerCase()}-${padded}`, `${year}-${kind!.toLowerCase()}-${number}`])];
  return `${orGroup(variants)} sourcelang:english`;
}

function gdeltDate(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

export function buildGdeltUrl(query: string, options: { start?: Date; end?: Date; maxRecords?: number } = {}): string {
  const url = new URL(GDELT_DOC_API);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("maxrecords", String(options.maxRecords ?? 75));
  if (options.start) url.searchParams.set("startdatetime", gdeltDate(options.start));
  if (options.end) url.searchParams.set("enddatetime", gdeltDate(options.end));
  if (!options.start && !options.end) url.searchParams.set("timespan", "3months");
  return url.toString();
}

export class GdeltQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GdeltQueryError";
  }
}

function parseSeenDate(value: string): Date | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  return Number.isFinite(date.getTime()) ? date : null;
}

function decodeEntities(value: string): string {
  return value.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, "\"").replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/**
 * Parses an artlist JSON body. GDELT answers rate limiting and bad queries with
 * HTTP 200 and a plain-text message, so the body decides.
 */
export function parseGdeltArtList(body: string): GdeltArticle[] {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) {
    if (/limit requests/i.test(trimmed)) throw new RateLimitedError("gdelt", new Date(Date.now() + 10 * 60_000));
    throw new GdeltQueryError(trimmed.slice(0, 200));
  }
  let parsed: { articles?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(trimmed) as typeof parsed;
  } catch {
    throw new GdeltQueryError("GDELT returned invalid JSON");
  }
  const articles: GdeltArticle[] = [];
  for (const row of parsed.articles ?? []) {
    const url = typeof row.url === "string" ? row.url : null;
    const title = typeof row.title === "string" ? decodeEntities(row.title).replace(/\s+/g, " ").trim() : null;
    const publishedAt = typeof row.seendate === "string" ? parseSeenDate(row.seendate) : null;
    if (!url || !/^https?:\/\//.test(url) || !title || !publishedAt) continue;
    articles.push({
      url,
      title,
      domain: typeof row.domain === "string" ? row.domain.toLowerCase() : "",
      publishedAt,
      language: typeof row.language === "string" ? row.language : null,
    });
  }
  return articles;
}

export async function searchGdelt(budget: FetchBudget, query: string, options: { start?: Date; end?: Date } = {}): Promise<GdeltArticle[]> {
  const body = await budget.text(buildGdeltUrl(query, options), "application/json");
  try {
    return parseGdeltArtList(body);
  } catch (error) {
    if (error instanceof RateLimitedError) budget.rateLimited = error;
    throw error;
  }
}
