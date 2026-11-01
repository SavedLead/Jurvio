/**
 * Courts of appeals live feeds: where each circuit publishes new opinions and
 * orders, and pure parsers for those pages. No I/O here.
 *
 * Checked by hand on 2026-10-30. Circuits without a working machine-readable
 * listing are listed in COA_WITHOUT_FEED with the reason; they stay on the
 * existing appellate-official pipeline and the CourtListener tail.
 */
import { decodeHtml } from "../providers/scotus/official-docket";

export type CoaFeedFormat = "rss" | "ca11-table" | "ca3-list";
export type CoaItemKind = "opinion" | "order" | "memorandum";

export interface CoaFeedSource {
  url: string;
  format: CoaFeedFormat;
  kind: CoaItemKind;
  /** Default when the item itself does not say. */
  precedential: boolean | null;
}

export const COA_FEED_SOURCES: Readonly<Record<string, readonly CoaFeedSource[]>> = {
  ca3: [
    { url: "https://www2.ca3.uscourts.gov/recentop/week/recopinions.xml", format: "rss", kind: "opinion", precedential: true },
    { url: "https://www2.ca3.uscourts.gov/recentop/week/recnonprec.htm", format: "ca3-list", kind: "opinion", precedential: false },
  ],
  ca5: [{ url: "https://www.ca5.uscourts.gov/rss.aspx?Feed=Opinions", format: "rss", kind: "opinion", precedential: null }],
  ca9: [
    { url: "https://www.ca9.uscourts.gov/decisions/opinions/index.xml", format: "rss", kind: "opinion", precedential: true },
    { url: "https://www.ca9.uscourts.gov/decisions/memoranda/index.xml", format: "rss", kind: "memorandum", precedential: false },
  ],
  ca10: [{ url: "https://www.ca10.uscourts.gov/opinions/new/daily_decisions.rss", format: "rss", kind: "opinion", precedential: null }],
  ca11: [
    { url: "https://media.ca11.uscourts.gov/opinions/pub/logname.php", format: "ca11-table", kind: "opinion", precedential: true },
    { url: "https://media.ca11.uscourts.gov/opinions/unpub/logname.php", format: "ca11-table", kind: "opinion", precedential: false },
  ],
  cadc: [{ url: "https://media.cadc.uscourts.gov/opinions/rss.xml", format: "rss", kind: "opinion", precedential: null }],
  cafc: [{ url: "https://www.cafc.uscourts.gov/feed/", format: "rss", kind: "opinion", precedential: null }],
};

/**
 * Circuits with no usable public listing. Empty since 2026-10-31: every
 * circuit has a per-court adapter in providers/appellate/adapters.ts, which
 * both appellate pipelines now use. COA_FEED_SOURCES above remains as the
 * parser presets for the original seven feeds.
 */
export const COA_WITHOUT_FEED: Readonly<Record<string, string>> = {};

export interface CoaFeedItem {
  courtCode: string;
  docketNumber: string;
  caption: string;
  releasedOn: string | null;
  documentUrl: string;
  sourceId: string;
  kind: CoaItemKind;
  precedential: boolean | null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DOCKET = /\b(\d{2}-\d{1,6})\b/;

function pad(value: number | string) {
  return String(value).padStart(2, "0");
}

/** Accepts 10/29/2026, 10-29-2026, "October 29, 2026" and RFC 822 dates; returns YYYY-MM-DD. */
export function feedDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  const mdy = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/.exec(text);
  if (mdy) return `${mdy[3]}-${pad(mdy[1]!)}-${pad(mdy[2]!)}`;
  const rfc = /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i.exec(text);
  if (rfc) return `${rfc[3]}-${pad(MONTHS.indexOf(rfc[2]!.slice(0, 3).toLowerCase()) + 1)}-${pad(rfc[1]!)}`;
  const long = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(text);
  if (long) return `${long[3]}-${pad(MONTHS.indexOf(long[1]!.slice(0, 3).toLowerCase()) + 1)}-${pad(long[2]!)}`;
  return null;
}

function tag(item: string, name: string): string | null {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(item);
  if (!match) return null;
  const raw = (match[1] ?? "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  // Descriptions are often entity-encoded HTML (&lt;br/&gt;); decode twice.
  return decodeHtml(decodeHtml(raw.replaceAll("&lt;", "<").replaceAll("&gt;", ">")));
}

function linkTag(item: string): string | null {
  const match = /<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(item);
  const value = match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
  return value ? value.replaceAll("&amp;", "&") : null;
}

export function precedentialFrom(text: string, fallback: boolean | null): boolean | null {
  if (/\b(non-?precedential|not precedential|unpublished)\b/i.test(text)) return false;
  if (/\b(precedential|published)\b/i.test(text)) return true;
  return fallback;
}

/** Strip the docket number, separators and status tags a feed puts around a caption. */
export function cleanCaption(value: string, docketNumber: string): string {
  return value
    .replace(new RegExp(`^\\s*(?:No\\.\\s*)?${docketNumber.replace("-", "\\-")}\\s*[:|,–-]?\\s*`), "")
    .replace(/\s*\[(?:ORDER|OPINION|ERRATA|JUDGMENT)\]/gi, "")
    .replace(/,?\s*(?:Non-?precedential|Precedential)\s*$/i, "")
    .replace(/,?\s*Filed\s+\d{1,2}\/\d{1,2}\/\d{4}\s*$/i, "")
    .replace(/^An opinion was released in case [^,]+,\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function docketFrom(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (!value) continue;
    // Link file names: /25-1888.pdf, /25-60590.0.pdf, /24-5231-2199837.pdf
    const match = DOCKET.exec(value);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function parseCoaRss(xml: string, courtCode: string, source: Pick<CoaFeedSource, "kind" | "precedential">): CoaFeedItem[] {
  const items: CoaFeedItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = match[1] ?? "";
    const title = tag(item, "title") ?? "";
    const description = tag(item, "description") ?? "";
    const link = linkTag(item);
    if (!link) continue;
    const fileName = decodeURIComponent(link.split("?")[0]!.split("/").pop() ?? "");
    const docketNumber = docketFrom(title, fileName, description);
    if (!docketNumber) continue;
    const caption = cleanCaption(title, docketNumber) || cleanCaption(description, docketNumber);
    if (caption.length < 3) continue;
    const guid = tag(item, "guid");
    const text = `${title} ${description} ${tag(item, "category") ?? ""}`;
    items.push({
      courtCode,
      docketNumber,
      caption,
      releasedOn: feedDate(/Filed\s+(\S+)/i.exec(title)?.[1]) ?? feedDate(/Released\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(description)?.[1])
        ?? feedDate(tag(item, "pubDate")),
      documentUrl: link,
      sourceId: `${courtCode}:${guid || link}`,
      kind: /\[ORDER\]/i.test(title) ? "order" : source.kind,
      precedential: precedentialFrom(text, source.precedential),
    });
  }
  return items;
}

/** media.ca11.uscourts.gov/opinions/{pub,unpub}/logname.php: case name | appeal # | district # | type | date */
export function parseCa11Table(html: string, baseUrl: string, source: Pick<CoaFeedSource, "kind" | "precedential">): CoaFeedItem[] {
  const items: CoaFeedItem[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>)/gi)) {
    const cells = [...(row[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1] ?? "");
    if (cells.length < 5) continue;
    const href = /href\s*=\s*["']([^"']+\.pdf)["']/i.exec(cells[0]!)?.[1];
    const docketNumber = DOCKET.exec(decodeHtml(cells[1]!))?.[1];
    const caption = decodeHtml(cells[0]!);
    if (!href || !docketNumber || caption.length < 3) continue;
    const documentUrl = new URL(href, baseUrl).toString();
    items.push({
      courtCode: "ca11",
      docketNumber,
      caption,
      releasedOn: feedDate(decodeHtml(cells[4]!)),
      documentUrl,
      sourceId: `ca11:${documentUrl}`,
      kind: source.kind,
      precedential: source.precedential,
    });
  }
  return items;
}

/** www2.ca3.uscourts.gov/recentop/week/*.htm: "Filed 10/14/2026, No. 25-2134<br/><a href=...pdf>Caption</a>" */
export function parseCa3List(html: string, source: Pick<CoaFeedSource, "kind" | "precedential">): CoaFeedItem[] {
  const items: CoaFeedItem[] = [];
  const pattern = /Filed\s+(\d{1,2}\/\d{1,2}\/\d{4}),\s*No\.\s*([\d-]+)[\s\S]{0,40}?<a\b[^>]*href\s*=\s*["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const docketNumber = DOCKET.exec(match[2] ?? "")?.[1];
    const caption = decodeHtml(match[4] ?? "");
    if (!docketNumber || caption.length < 3) continue;
    const documentUrl = new URL(match[3]!, "https://www2.ca3.uscourts.gov/").toString();
    items.push({
      courtCode: "ca3",
      docketNumber,
      caption,
      releasedOn: feedDate(match[1]),
      documentUrl,
      sourceId: `ca3:${documentUrl}`,
      kind: source.kind,
      precedential: source.precedential,
    });
  }
  return items;
}

export function parseCoaFeed(body: string, courtCode: string, source: CoaFeedSource): CoaFeedItem[] {
  switch (source.format) {
    case "rss": return parseCoaRss(body, courtCode, source);
    case "ca11-table": return parseCa11Table(body, source.url, source);
    case "ca3-list": return parseCa3List(body, source);
  }
}

/** Same court + docket + document = same item, across overlapping feeds. Newest first. */
export function dedupeCoaItems(items: readonly CoaFeedItem[]): CoaFeedItem[] {
  const seen = new Map<string, CoaFeedItem>();
  for (const item of items) {
    const key = `${item.courtCode}|${normalizeDocket(item.docketNumber)}|${item.documentUrl}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()].sort((a, b) => (b.releasedOn ?? "").localeCompare(a.releasedOn ?? ""));
}

/** The match key used against legal_case.docket_number (same rule as the appellate pipeline). */
export function normalizeDocket(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function coaEntryDescription(item: Pick<CoaFeedItem, "kind" | "precedential">): string {
  if (item.kind === "order") return "Order released";
  if (item.kind === "memorandum") return "Memorandum disposition released (unpublished)";
  if (item.precedential === true) return "Published opinion released";
  if (item.precedential === false) return "Unpublished opinion released";
  return "Opinion released";
}
