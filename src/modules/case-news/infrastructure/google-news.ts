import { RateLimitedError, type FetchBudget } from "@/modules/ingestion/live-feeds/polite-fetcher";
import { isTransientNetworkError } from "./gdelt";
import { shortSnippet } from "./rss";

export const GOOGLE_NEWS_RSS_SEARCH = "https://news.google.com/rss/search";
/** One search every 8 s, a few dozen per run: well inside what a feed reader would do. */
export const GOOGLE_NEWS_MIN_INTERVAL_MS = 8_000;

export interface GoogleNewsItem {
  url: string;
  title: string;
  snippet: string | null;
  publishedAt: Date;
  sourceName: string | null;
  sourceDomain: string | null;
}

export function buildGoogleNewsUrl(query: string, days = 90): string {
  const url = new URL(GOOGLE_NEWS_RSS_SEARCH);
  url.searchParams.set("q", `${query} when:${days}d`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  return url.toString();
}

function decodeEntities(value: string): string {
  return value.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function rawTag(xml: string, tag: string): { attrs: string; body: string } | null {
  const match = xml.match(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return null;
  return { attrs: match[1]!, body: match[2]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1") };
}

function plain(value: string | null | undefined): string | null {
  if (!value) return null;
  // Descriptions are entity-encoded HTML: decode, strip tags, decode again.
  const text = decodeEntities(decodeEntities(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text || null;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase().replace(/^(?:www|amp|m|mobile)\./, ""); } catch { return null; }
}

/**
 * Parses a Google News RSS search feed. Keeps only the headline (without the
 * trailing " - Outlet"), the outlet name and domain, the link, the date and a
 * short snippet from the feed description when it says more than the headline.
 */
export function parseGoogleNewsRss(xml: string): GoogleNewsItem[] {
  const items: GoogleNewsItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const body = match[1]!;
    const source = rawTag(body, "source");
    const sourceName = plain(source?.body);
    const sourceUrl = source?.attrs.match(/url="([^"]+)"/)?.[1] ?? null;
    let title = plain(rawTag(body, "title")?.body);
    const url = plain(rawTag(body, "link")?.body);
    const date = plain(rawTag(body, "pubDate")?.body);
    const publishedAt = date ? new Date(date) : null;
    if (!title || !url || !/^https?:\/\//.test(url) || !publishedAt || !Number.isFinite(publishedAt.getTime())) continue;
    if (sourceName && title.endsWith(` - ${sourceName}`)) title = title.slice(0, -(sourceName.length + 3)).trim();
    let description = plain(rawTag(body, "description")?.body);
    if (description && sourceName && description.endsWith(sourceName)) description = description.slice(0, -sourceName.length).trim();
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const snippet = description && !norm(title).startsWith(norm(description)) && !norm(description).startsWith(norm(title)) ? shortSnippet(description) : null;
    items.push({ url, title, snippet, publishedAt, sourceName, sourceDomain: hostOf(sourceUrl) });
  }
  return items;
}

export async function searchGoogleNews(budget: FetchBudget, query: string): Promise<GoogleNewsItem[]> {
  let response: Response;
  try {
    response = await budget.get(buildGoogleNewsUrl(query), "application/rss+xml, application/xml;q=0.9");
  } catch (error) {
    if (isTransientNetworkError(error)) budget.rateLimited = new RateLimitedError("google_news_rss", null);
    throw budget.rateLimited ?? error;
  }
  // Google answers bursts with 503 and a captcha page: stop for this run.
  if (response.status === 503 || response.status === 403) {
    budget.rateLimited = new RateLimitedError("google_news_rss", null);
    throw budget.rateLimited;
  }
  if (!response.ok) throw new Error(`google_news_rss: HTTP ${response.status}`);
  return parseGoogleNewsRss(await response.text());
}
