/**
 * Appellate CM/ECF (NextGen) public RSS: "Recent Entries" of type orders,
 * opinions and judgments, no login. Checked 2026-10-31 on all 13 circuits at
 * ecf.<court>.uscourts.gov/n/beam/servlet/TransportRoom?servlet=RSSGenerator:
 * configured on ca2, ca4, ca6, ca10, ca11, cadc and cafc; the other six answer
 * "not configured for feed". Document links (docs1) need PACER and are never
 * fetched. Pure: parsing only.
 */
import { decodeHtml } from "../scotus/official-docket";
import { feedDate } from "../../live-feeds/coa-feeds";

export const APPELLATE_RSS_COURTS = ["ca2", "ca4", "ca6", "ca10", "ca11", "cadc", "cafc"] as const;
export const APPELLATE_RSS_NOT_CONFIGURED = ["ca1", "ca3", "ca5", "ca7", "ca8", "ca9"] as const;

export function appellateRssUrl(court: string): string {
  return `https://ecf.${court}.uscourts.gov/n/beam/servlet/TransportRoom?servlet=RSSGenerator`;
}

export interface AppellateRssItem {
  courtCode: string;
  docketNumber: string;
  caption: string;
  /** Docket text without the document link, e.g. "Per Curiam Order Filed (Special Panel)". */
  entryText: string;
  kind: "opinion" | "order" | "judgment" | "other";
  filedOn: string | null;
  /** Stable per entry: the guid (carries partId). */
  entryKey: string;
  docketUrl: string;
}

function tag(item: string, name: string): string {
  const raw = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(item)?.[1] ?? "";
  return decodeHtml(raw.replace(/^<!\[CDATA\[|\]\]>$/g, "")).trim();
}

export function entryKind(text: string): AppellateRssItem["kind"] {
  if (/\bopinion\b/i.test(text)) return "opinion";
  if (/\bjudgment\b/i.test(text)) return "judgment";
  if (/\border\b/i.test(text)) return "order";
  return "other";
}

export function parseAppellateRss(xml: string, courtCode: string): AppellateRssItem[] {
  const items: AppellateRssItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = match[1] ?? "";
    const title = tag(item, "title");
    const docket = /^(\d{2}-\d{1,6})\b/.exec(title)?.[1];
    if (!docket) continue;
    const description = tag(item, "description").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
    const entryText = decodeHtml(description.replace(/<a\b[\s\S]*?<\/a>/gi, " ").replace(/<[^>]+>/g, " "))
      .replace(/[[\]()]/g, " ").replace(/\s+/g, " ").trim();
    const guid = tag(item, "guid") || `${tag(item, "link")}#${tag(item, "pubDate")}#${entryText}`;
    items.push({
      courtCode, docketNumber: docket, caption: title.slice(docket.length).replace(/\s+/g, " ").trim().slice(0, 500) || docket,
      entryText: entryText.slice(0, 1000), kind: entryKind(entryText), filedOn: feedDate(tag(item, "pubDate")),
      entryKey: guid, docketUrl: tag(item, "link"),
    });
  }
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.entryKey) && Boolean(seen.add(item.entryKey)));
}
