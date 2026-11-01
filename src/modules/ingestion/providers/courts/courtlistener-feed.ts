/**
 * CourtListener per-court opinion feeds (public Atom, no account or API token):
 * https://www.courtlistener.com/feed/court/{court}/ lists the court's 20 newest
 * opinions with title, filing date, the first lines of the opinion and a RECAP
 * PDF link. Used for districts that publish no public PACER RSS and have no
 * GovInfo USCOURTS packages (checked 2026-11-01): gasd, msnd, oknd, vaed.
 * The feed is not the CourtListener REST API, so it does not touch the API
 * token's quota. Pure: parsing only.
 */

export const COURTLISTENER_FEED_COURTS = ["gasd", "msnd", "oknd", "vaed"] as const;

export function courtListenerFeedUrl(court: string): string {
  return `https://www.courtlistener.com/feed/court/${court}/`;
}

export interface CourtListenerFeedItem {
  courtCode: string;
  /** The CourtListener opinion URL (stable per opinion). */
  itemKey: string;
  opinionId: string | null;
  /** Normalized docket ("1:25-cv-01708", "26-cv-00479"), or null when the header has none. */
  docketNumber: string | null;
  /** True when the docket has office, year, case type and number, so a case may be created from it. */
  docketComplete: boolean;
  caption: string;
  /** Header text from the feed (first lines of the opinion), used only for the restricted check. */
  header: string;
  issuedOn: string | null;
  documentUrl: string;
  /** RECAP document number from the PDF path, when present. */
  entryNumber: string | null;
  /** The header names a different district (CourtListener occasionally files an opinion under the wrong court). */
  otherCourt: boolean;
}

const COURT_DISTRICT: Readonly<Record<string, string>> = {
  gasd: "southern district of georgia", msnd: "northern district of mississippi",
  oknd: "northern district of oklahoma", vaed: "eastern district of virginia",
};

/** True when the header names one or more districts and none of them is this court. */
export function namesOtherDistrict(header: string, courtCode: string): boolean {
  const own = COURT_DISTRICT[courtCode];
  if (!own) return false;
  const named = [...header.matchAll(/\b(northern|southern|eastern|western|middle|central)\s+district\s+of\s+([a-z]+(?:\s+(?:carolina|dakota|virginia|york|mexico|jersey|hampshire|island))?)/gi)]
    .map((m) => `${m[1]} district of ${m[2]}`.toLowerCase().replace(/\s+/g, " "));
  return named.length > 0 && !named.includes(own);
}

function decodeEntities(value: string): string {
  return value
    .replaceAll(/&lt;/g, "<").replaceAll(/&gt;/g, ">").replaceAll(/&quot;/g, '"')
    .replaceAll(/&#39;|&#x27;/g, "'").replaceAll(/&nbsp;/g, " ").replaceAll(/&amp;/g, "&");
}

function plain(value: string): string {
  // The summary is HTML escaped once inside the XML: unescape, drop tags, unescape again.
  return decodeEntities(decodeEntities(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

interface DocketHit { index: number; docket: string; complete: boolean }

/**
 * The case number in an opinion header. Earliest match wins (the caption block
 * comes first). Forms seen in the feeds:
 *   3:26-cv-00266-JDM-JMV, 1:25-cv-78, 2:26cv1148, 3:23CV801  -> office:yy-type-number (complete)
 *   CV 124-005, CR418-12 (S.D. Ga.: division digit + yy)      -> complete
 *   26-CV-0479-CVE-JFJ                                         -> yy-type-number (match only)
 */
export function headerDocket(text: string): { docket: string; complete: boolean } | null {
  const hits: DocketHit[] = [];
  const pad = (number: string) => number.padStart(5, "0");
  const withOffice = /\b(\d):\s?(\d{2})\s?-?\s?(cv|cr|mc|mj|po|md|bk|ap|pt|sw|gj|ml)\s?-?\s?(\d{1,6})\b/gi;
  for (const m of text.matchAll(withOffice)) {
    hits.push({ index: m.index ?? 0, docket: `${m[1]}:${m[2]}-${m[3]!.toLowerCase()}-${pad(m[4]!)}`, complete: true });
  }
  const sdga = /\b(CV|CR)\s?(\d)(\d{2})-(\d{1,6})\b/g;
  for (const m of text.matchAll(sdga)) {
    hits.push({ index: m.index ?? 0, docket: `${m[2]}:${m[3]}-${m[1]!.toLowerCase()}-${pad(m[4]!)}`, complete: true });
  }
  const noOffice = /(?<![\d:])\b(\d{2})-(cv|cr|mc|mj|po|md)-(\d{1,6})\b/gi;
  for (const m of text.matchAll(noOffice)) {
    hits.push({ index: m.index ?? 0, docket: `${m[1]}-${m[2]!.toLowerCase()}-${pad(m[3]!)}`, complete: false });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.index - b.index || Number(b.complete) - Number(a.complete));
  return { docket: hits[0]!.docket, complete: hits[0]!.complete };
}

function tag(entry: string, name: string): string | null {
  return new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(entry)?.[1] ?? null;
}

export function parseCourtListenerFeed(xml: string, courtCode: string): CourtListenerFeedItem[] {
  const items: CourtListenerFeedItem[] = [];
  const seen = new Set<string>();
  for (const entry of xml.split(/<entry>/).slice(1)) {
    const alternate = /<link href="([^"]+)" rel="alternate"/.exec(entry)?.[1] ?? tag(entry, "id")?.trim() ?? null;
    if (!alternate || seen.has(alternate)) continue;
    seen.add(alternate);
    const enclosure = /<link href="([^"]+)"[^>]*rel="enclosure"/.exec(entry)?.[1] ?? null;
    const header = plain(tag(entry, "summary") ?? "").replace(/Original document\s*$/i, "").trim().slice(0, 1000);
    const docket = headerDocket(header);
    const published = (tag(entry, "published") ?? tag(entry, "updated") ?? "").trim();
    const recap = enclosure ? /gov\.uscourts\.[a-z0-9]+\.\d+\.(\d+)\.\d+\.pdf$/i.exec(enclosure) : null;
    items.push({
      courtCode,
      itemKey: alternate,
      opinionId: /\/opinion\/(\d+)\//.exec(alternate)?.[1] ?? null,
      docketNumber: docket?.docket ?? null,
      docketComplete: docket?.complete ?? false,
      caption: plain(tag(entry, "title") ?? "").slice(0, 500),
      header,
      issuedOn: /^\d{4}-\d{2}-\d{2}/.test(published) ? published.slice(0, 10) : null,
      documentUrl: enclosure ?? alternate,
      entryNumber: recap?.[1] ?? null,
      otherCourt: namesOtherDistrict(header, courtCode),
    });
  }
  return items;
}
