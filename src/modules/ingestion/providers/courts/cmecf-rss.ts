import {
  classifyDirectEvent, isRestrictedDirectEvent, normalizeDocketNumber,
  stableDirectEventIdentity, visitorFriendlyDescription, type DirectCourtEvent,
} from "../../domain/direct-court";
import { conditionalRequestHeaders, type HttpValidators } from "../http-validators";
import type { FederalCourtSource } from "./registry";

const MAX_FEED_BYTES = 5 * 1024 * 1024;

function decodeXml(value: string) { return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'"); }

function tag(xml: string, name: string): string {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(xml);
  return decodeXml((match?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function href(xml: string): string | null {
  const direct = tag(xml, "link");
  if (direct) return direct;
  return /<link\b[^>]*href=["']([^"']+)["']/i.exec(xml)?.[1] ?? null;
}

function docketFrom(value: string): string | null {
  const match = /\b(\d{1,2}:\d{2}-(?:cv|cr|mc|mj|md|bk|ap)-\d{1,7}(?:-[A-Za-z0-9-]+)?)\b/i.exec(value);
  return match ? normalizeDocketNumber(match[1] ?? "") : null;
}

function documentNumber(value: string): string | null {
  return /(?:document|doc\.?|docket entry)\s*#?\s*(\d+)/i.exec(value)?.[1] ?? null;
}

export function parseCmecfRss(xml: string, court: FederalCourtSource): DirectCourtEvent[] {
  if (!xml.trim()) throw new Error("CM/ECF RSS response is empty");
  const items = [...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)];
  const events: DirectCourtEvent[] = [];
  for (const match of items) {
    const item = match[1] ?? "";
    const title = tag(item, "title");
    const description = tag(item, "description") || tag(item, "summary") || tag(item, "content");
    const exactText = [title, description].filter(Boolean).join(" — ").trim();
    const docketNumber = docketFrom(exactText);
    const sourceUrl = href(item) ?? court.rssUrl;
    const filed = tag(item, "pubDate") || tag(item, "updated") || tag(item, "published");
    const filedTimestamp = Date.parse(filed);
    if (!docketNumber || !sourceUrl || !exactText || Number.isNaN(filedTimestamp)) continue;
    const filedAt = new Date(filedTimestamp).toISOString();
    const officialEventId = tag(item, "guid") || tag(item, "id") || null;
    const eventType = classifyDirectEvent(exactText);
    const identity = stableDirectEventIdentity({
      courtCode: court.officialCourtCode, docketNumber, officialEventId,
      filedAt, exactText, documentNumber: documentNumber(exactText),
    });
    const caption = title.replace(docketFrom(title) ?? docketNumber, "").replace(/^\s*[-:–—]\s*|\s*[-:–—]\s*$/g, "").trim() ||
      description.split(/\s+(?:filed|entered|docketed)\b/i)[0]?.trim() || docketNumber;
    events.push({
      courtCode: court.officialCourtCode, docketNumber, caption, officialEventId,
      documentNumber: documentNumber(exactText), filedAt, exactText, eventType,
      visitorDescription: visitorFriendlyDescription(eventType), sourceUrl,
      documentUrl: /\/doc1\//i.test(sourceUrl) ? sourceUrl : null,
      contentHash: identity.contentHash, deduplicationKey: identity.deduplicationKey,
      restricted: isRestrictedDirectEvent(exactText),
    });
  }
  return events;
}

export async function fetchCmecfRss(
  court: FederalCourtSource,
  validators?: HttpValidators | null,
): Promise<{
  rawBody: string;
  retrievedAt: string;
  events: DirectCourtEvent[];
  notModified: boolean;
  etag: string | null;
  lastModified: string | null;
}> {
  if (!court.rssUrl) throw new Error(`${court.officialCourtCode} has no RSS URL`);
  const response = await fetch(court.rssUrl, {
    headers: {
      "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1 court-ingestion",
      ...conditionalRequestHeaders(validators),
    },
    redirect: "error",
  });
  const etag = response.headers.get("etag");
  const lastModified = response.headers.get("last-modified");
  if (response.status === 304) {
    return { rawBody: "", retrievedAt: new Date().toISOString(), events: [], notModified: true, etag, lastModified };
  }
  if (!response.ok) throw new Error(`${court.officialCourtCode} RSS returned HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_FEED_BYTES) throw new Error("CM/ECF RSS response exceeds byte cap");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_FEED_BYTES) throw new Error("CM/ECF RSS response exceeds byte cap");
  const rawBody = new TextDecoder().decode(bytes);
  return { rawBody, retrievedAt: new Date().toISOString(), events: parseCmecfRss(rawBody, court), notModified: false, etag, lastModified };
}
