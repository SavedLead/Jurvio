import type { FetchBudget } from "@/modules/ingestion/live-feeds/polite-fetcher";

export interface RssNewsItem {
  url: string;
  title: string;
  snippet: string | null;
  publishedAt: Date;
}

/** Feeds whose terms allow use on our site (see domain/sources.ts). */
export const COURTHOUSE_NEWS_FEEDS = [
  "https://www.courthousenews.com/feed/",
  "https://www.courthousenews.com/category/appeals/feed/",
  "https://www.courthousenews.com/category/courts/feed/",
  "https://www.courthousenews.com/category/law/feed/",
] as const;

export const SNIPPET_MAX_CHARS = 200;

function decodeEntities(value: string): string {
  return value.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function textOf(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return null;
  const raw = match[1]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  return decodeEntities(raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null;
}

/** The source's own short description, cut at a word boundary. Never article text. */
export function shortSnippet(value: string | null, max = SNIPPET_MAX_CHARS): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s*The post .* appeared first on .*$/i, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).replace(/[\s,;:.-]+$/, "")}…`;
}

export function parseRssItems(xml: string): RssNewsItem[] {
  const items: RssNewsItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const body = match[1]!;
    const title = textOf(body, "title");
    const url = textOf(body, "link");
    const date = textOf(body, "pubDate");
    const publishedAt = date ? new Date(date) : null;
    if (!title || !url || !/^https?:\/\//.test(url) || !publishedAt || !Number.isFinite(publishedAt.getTime())) continue;
    items.push({ url, title, snippet: shortSnippet(textOf(body, "description")), publishedAt });
  }
  return items;
}

export async function fetchRssFeeds(budget: FetchBudget, feeds: readonly string[]): Promise<{ items: RssNewsItem[]; errors: string[] }> {
  const byUrl = new Map<string, RssNewsItem>();
  const errors: string[] = [];
  for (const feed of feeds) {
    if (!budget.canFetch) break;
    try {
      for (const item of parseRssItems(await budget.text(feed, "application/rss+xml, application/xml;q=0.9"))) byUrl.set(item.url, item);
    } catch (error) {
      errors.push(`${feed}: ${String(error)}`);
    }
  }
  return { items: [...byUrl.values()], errors };
}
