/**
 * One adapter per court of appeals: where its new opinions and orders are
 * listed today and how to read that listing. Replaces the shared "every PDF
 * link on the page" parser, which picked up rules PDFs once courts redesigned
 * their sites. Checked by hand on 2026-10-31; saved pages are in
 * live-feeds/fixtures and every adapter has a test against them.
 *
 * Both appellate pipelines use these adapters: appellate-official (downloads
 * each PDF and publishes the opinion text) and coa-live-feeds (adds an
 * "opinion released" entry to the case). Pure: requests are computed from the
 * clock, parsing does no I/O.
 */
import { decodeHtml } from "../scotus/official-docket";
import { cleanCaption, feedDate, parseCa11Table, parseCa3List, parseCoaRss, precedentialFrom, type CoaItemKind } from "../../live-feeds/coa-feeds";

export interface AdapterRequest {
  url: string;
  method: "GET" | "POST";
  /** application/x-www-form-urlencoded body for POST. */
  body?: string;
  /** Short name for logs and the source matrix. */
  label: string;
  kind: CoaItemKind;
  precedential: boolean | null;
}

export interface AdapterItem {
  courtCode: string;
  docketNumber: string;
  caption: string;
  releasedOn: string | null;
  documentUrl: string;
  kind: CoaItemKind;
  precedential: boolean | null;
  /**
   * The URL the live-feed pipeline keys its docket entry on when it differs
   * from the document (cafc: the feed's post link; the PDF is documentUrl).
   * Keeps entry ids stable across this change so nothing is stored twice.
   */
  entryKeyUrl?: string;
}

export interface CircuitAdapter {
  code: string;
  /** Human page for the registry and the matrix. */
  listingUrl: string;
  requests(now: Date): AdapterRequest[];
  parse(body: string, request: AdapterRequest): AdapterItem[];
}

const DOCKET = /\b(\d{2})-(\d{1,6})\b/;

function get(url: string, label: string, kind: CoaItemKind, precedential: boolean | null): AdapterRequest {
  return { url, method: "GET", label, kind, precedential };
}

/** YYYY-MM-DD in America/New_York for `now` minus `days`. */
export function easternDate(now: Date, days = 0): string {
  const shifted = new Date(now.getTime() - days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(shifted);
}

function fromRss(code: string) {
  return (body: string, request: AdapterRequest): AdapterItem[] =>
    parseCoaRss(body, code, request).map(({ sourceId: _sourceId, ...item }) => item);
}

/**
 * cafc /feed/: the item link is an HTML post; the PDF is linked inside
 * content:encoded ("/opinions-orders/26-2253.ORDER.10-29-2026_2778960.pdf").
 * Use the PDF so the full-text pipeline can read it.
 */
export function parseCafc(body: string, request: AdapterRequest): AdapterItem[] {
  const pdfByLink = new Map<string, string>();
  for (const match of body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = match[1] ?? "";
    const link = /<link>([^<]+)<\/link>/i.exec(item)?.[1]?.trim();
    const pdf = /href="([^"]+\.pdf)"/i.exec(item)?.[1];
    if (link && pdf) pdfByLink.set(link.replaceAll("&amp;", "&"), new URL(pdf, "https://www.cafc.uscourts.gov/").toString());
  }
  return fromRss("cafc")(body, request).map((item) => ({ ...item, entryKeyUrl: item.documentUrl, documentUrl: pdfByLink.get(item.documentUrl) ?? item.documentUrl }));
}

function strip(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

/** ca1 /opinions: <h3><a href="...25-1101P-01A.pdf">25-1101 US v. Newton</a></h3> ... [ Published ] ... [ Issued:10/29/2026 ] */
export function parseCa1(html: string, request: AdapterRequest): AdapterItem[] {
  const items: AdapterItem[] = [];
  for (const block of html.split(/<li\b[^>]*class="[^"]*views-row/i).slice(1)) {
    const link = /<h3\b[^>]*>\s*<a\b[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const title = strip(link[2] ?? "");
    const docket = DOCKET.exec(title);
    if (!docket) continue;
    const docketNumber = `${docket[1]}-${docket[2]}`;
    const status = /\[\s*(Published|Unpublished|Errata)\s*\]/i.exec(block)?.[1]?.toLowerCase();
    items.push({
      courtCode: "ca1", docketNumber, caption: cleanCaption(title, docketNumber),
      releasedOn: feedDate(/Issued:\s*([\d/]+)/i.exec(block)?.[1]) ?? feedDate(/content="(\d{4}-\d{2}-\d{2})/.exec(block)?.[1]?.replace(/(\d{4})-(\d{2})-(\d{2})/, "$2/$3/$1")),
      documentUrl: new URL(link[1]!, "https://www.ca1.uscourts.gov/").toString(),
      kind: status === "errata" ? "order" : request.kind,
      precedential: status === "published" ? true : status === "unpublished" ? false : request.precedential,
    });
  }
  return items;
}

/** ca2 dtSearch results: Docket #: <a href=".../OPN/25-2652_opn.pdf">25-2652</a> | Date: 10/27/2026 | subjectStr = "caption" */
export function parseCa2(html: string, request: AdapterRequest): AdapterItem[] {
  const items: AdapterItem[] = [];
  for (const row of html.split(/<TR\b[^>]*>/i).slice(1)) {
    const link = /Docket #:\s*<\/B>\s*<a\b[^>]*href="([^"]+\.pdf)"[^>]*>([^<]+)<\/a>/i.exec(row);
    if (!link) continue;
    const docket = DOCKET.exec(link[2] ?? "") ?? DOCKET.exec(link[1] ?? "");
    if (!docket) continue;
    const docketNumber = `${docket[1]}-${docket[2]}`;
    const subject = /var subjectStr = "([^"]*)"/.exec(row)?.[1]?.trim();
    const caption = /var captionStr = "([^"]*)"/.exec(row)?.[1]?.trim();
    const name = strip((subject && subject.length >= 3 ? subject : caption) ?? "");
    if (name.length < 3) continue;
    items.push({
      courtCode: "ca2", docketNumber, caption: name, releasedOn: feedDate(/Date:\s*<\/B>\s*([\d/]+)/i.exec(row)?.[1]),
      documentUrl: link[1]!, kind: request.kind, precedential: request.precedential,
    });
  }
  return items;
}

/** ca4 /opinions/recent-opinions: <h3>25-4661.U US v. Ronald Lefler</h3> ... Link: <a href='...pdf'> ... October 30, 2026 */
export function parseCa4(html: string, request: AdapterRequest): AdapterItem[] {
  const items: AdapterItem[] = [];
  for (const block of html.split(/<li\b[^>]*class="sfnewsListItem/i).slice(1)) {
    const title = strip(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(block)?.[1] ?? "");
    const href = /href=['"]([^'"]+\.pdf)['"]/i.exec(block)?.[1];
    if (!href || !title) continue;
    const dashed = /^(\d{2})-(\d{3,6})(?:\.[A-Z]+)?\s+/.exec(title);
    const compact = /^(\d{2})(\d{4})(?:\.[A-Z]+)?\s+/.exec(title);
    const match = dashed ?? compact;
    if (!match) continue;
    const docketNumber = `${match[1]}-${match[2]}`;
    const caption = title.slice(match[0].length).trim();
    if (caption.length < 3) continue;
    const text = strip(block);
    const order = /court order|order filed/i.test(text) && !/opinion/i.test(text);
    items.push({
      courtCode: "ca4", docketNumber, caption,
      releasedOn: feedDate(/sfmetainfo[^>]*>\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(block)?.[1]),
      documentUrl: new URL(href, "https://www.ca4.uscourts.gov/").toString(),
      kind: order ? "order" : request.kind,
      precedential: /\bunpublished\b/i.test(text) || /\.U\.pdf$/i.test(href) ? false : /\bpublished\b/i.test(text) || /\.P\.pdf$/i.test(href) ? true : request.precedential,
    });
  }
  return items;
}

/** ca6 opinions.php?todo=week: <a href=/opinions.pdf/26a0288p-06.pdf>..</a> | 25-3557 | 10/26/2026 | caption - origin */
export function parseCa6(html: string, request: AdapterRequest): AdapterItem[] {
  const items: AdapterItem[] = [];
  for (const row of html.split(/<tr>/i).slice(1)) {
    const href = /<a href=["']?([^"'\s>]+\.pdf)["']?\s*>([^<]+)<\/a>/i.exec(row);
    if (!href) continue;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1] ?? "");
    if (cells.length < 4) continue;
    const docket = DOCKET.exec(cells[1]!.replace(/<!--[\s\S]*?-->/g, ""));
    if (!docket) continue;
    const docketNumber = `${docket[1]}-${docket[2]}`;
    const caption = strip(cells[3]!.replace(/<font\b[\s\S]*$/i, "")).replace(/\s*-\s*$/, "").trim();
    if (caption.length < 3) continue;
    const number = href[2] ?? "";
    items.push({
      courtCode: "ca6", docketNumber, caption, releasedOn: feedDate(strip(cells[2]!)),
      documentUrl: new URL(href[1]!, "https://www.opn.ca6.uscourts.gov/").toString(),
      kind: request.kind,
      // 26a0288p.06 = published, 26a0440n.06 = not recommended for publication.
      precedential: /\dp\./i.test(number) ? true : /\dn\./i.test(number) ? false : request.precedential,
    });
  }
  return items;
}

/** ca7 processWebInputExternal.pl?Time=week: rows of case # | caption | type | filed | document link (T:fnOp / T:npDp) | author */
export function parseCa7(html: string, request: AdapterRequest): AdapterItem[] {
  const items: AdapterItem[] = [];
  for (const row of html.split(/<TR\b[^>]*>/i).slice(1)) {
    const cells = [...row.matchAll(/<TD\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1] ?? "");
    if (cells.length < 5) continue;
    const docket = DOCKET.exec(strip(cells[0]!));
    const href = /href=['"]([^'"]+)['"]/i.exec(cells[4]!)?.[1]?.replaceAll("&amp;", "&");
    if (!docket || !href) continue;
    const docketNumber = `${docket[1]}-${docket[2]}`;
    const caption = strip(cells[1]!);
    if (caption.length < 3) continue;
    const type = /:T:([a-zA-Z]+):/.exec(href)?.[1] ?? "";
    items.push({
      courtCode: "ca7", docketNumber, caption, releasedOn: feedDate(strip(cells[3]!)),
      documentUrl: new URL(href, "https://media.ca7.uscourts.gov/cgi-bin/OpinionsWeb/").toString(),
      kind: type === "fnOp" ? "opinion" : type === "npDp" ? "opinion" : "order",
      precedential: type === "fnOp" ? true : type === "npDp" ? false : request.precedential,
    });
  }
  return items;
}

/** ca8 TodayOpn.pl: <a href=".../opndir/26/10/251374P.pdf">251374P.pdf</a> 10/30/2026 Caption \n Case No: 25-1374 */
export function parseCa8(html: string, request: AdapterRequest): AdapterItem[] {
  const items: AdapterItem[] = [];
  const pattern = /<a\b[^>]*href="([^"]+\/(\d{6})([PU])\.pdf)"[^>]*>[^<]*<\/a>\s*(?:<\/b>)?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+([^\n<]+)[\s\S]{0,200}?Case No:\s*(\d{2}-\d{1,6})/gi;
  for (const match of html.matchAll(pattern)) {
    const caption = strip(match[5] ?? "");
    if (caption.length < 3) continue;
    items.push({
      courtCode: "ca8", docketNumber: match[6]!, caption, releasedOn: feedDate(match[4]),
      documentUrl: match[1]!, kind: request.kind, precedential: match[3]!.toUpperCase() === "P",
    });
  }
  return items;
}

function ca2Search(index: "OPN" | "SUM", now: Date): AdapterRequest {
  const indexes = { OPN: "*{aa12e167958cdbcaa709fa14b9161a4a} OPN", SUM: "*{aad0964f04f3e9c420e057fd415efe0c} SUM" };
  const body = new URLSearchParams({
    cmd: "search", index: indexes[index], request: "xfirstword",
    fileConditions: `xfilter(date "${easternDate(now, 7)}~~${easternDate(now)}")`, booleanConditions: "",
    pageSize: "200", sort: "date", autoStopLimit: "5000", dtsPdfWh: "x", OrigSearchForm: "/decisions.html", SearchForm: "%%SearchForm%%",
  }).toString();
  return { url: "https://ww3.ca2.uscourts.gov/dtSearch/dtisapi6.dll", method: "POST", body,
    label: index === "OPN" ? "opinions" : "summary-orders", kind: index === "OPN" ? "opinion" : "order", precedential: index === "OPN" ? true : false };
}

export const CIRCUIT_ADAPTERS: Readonly<Record<string, CircuitAdapter>> = {
  ca1: { code: "ca1", listingUrl: "https://www.ca1.uscourts.gov/opinions",
    requests: () => [get("https://www.ca1.uscourts.gov/opinions", "opinions", "opinion", null)], parse: parseCa1 },
  ca2: { code: "ca2", listingUrl: "https://ww3.ca2.uscourts.gov/decisions.html",
    requests: (now) => [ca2Search("OPN", now), ca2Search("SUM", now)], parse: parseCa2 },
  ca3: { code: "ca3", listingUrl: "https://www2.ca3.uscourts.gov/recentop/week/recprec.htm",
    requests: () => [
      get("https://www2.ca3.uscourts.gov/recentop/week/recopinions.xml", "precedential-rss", "opinion", true),
      get("https://www2.ca3.uscourts.gov/recentop/week/recprec.htm", "precedential", "opinion", true),
      get("https://www2.ca3.uscourts.gov/recentop/week/recnonprec.htm", "non-precedential", "opinion", false),
    ],
    parse: (body, request) => request.url.endsWith(".xml") ? fromRss("ca3")(body, request)
      : parseCa3List(body, request).map(({ sourceId: _sourceId, ...item }) => item) },
  ca4: { code: "ca4", listingUrl: "https://www.ca4.uscourts.gov/opinions/recent-opinions",
    requests: () => [get("https://www.ca4.uscourts.gov/opinions/recent-opinions", "recent", "opinion", null)], parse: parseCa4 },
  ca5: { code: "ca5", listingUrl: "https://www.ca5.uscourts.gov/rss.aspx?Feed=Opinions",
    requests: () => [get("https://www.ca5.uscourts.gov/rss.aspx?Feed=Opinions", "opinions-rss", "opinion", null)], parse: fromRss("ca5") },
  ca6: { code: "ca6", listingUrl: "https://www.opn.ca6.uscourts.gov/opinions/opinions.php?todo=week",
    requests: () => [get("https://www.opn.ca6.uscourts.gov/opinions/opinions.php?todo=week", "week", "opinion", null)], parse: parseCa6 },
  ca7: { code: "ca7", listingUrl: "https://media.ca7.uscourts.gov/opinion.html",
    // Time=week replaces the old listing URL that was hard-coded to 2026-07-30.
    requests: () => [get("https://media.ca7.uscourts.gov/cgi-bin/OpinionsWeb/processWebInputExternal.pl?Time=week&Author=any&AuthorName=&Case=any&CaseY1=&CaseY2=&CaseN1=&CaseN2=&CaseN3=&CaseN4=&Submit=Submit&OpsOnly=no",
      "week", "opinion", null)], parse: parseCa7 },
  ca8: { code: "ca8", listingUrl: "https://www.ca8.uscourts.gov/todays-opinions",
    requests: () => [get("https://ecf.ca8.uscourts.gov/cgi-bin/TodayOpn.pl", "today", "opinion", null)], parse: parseCa8 },
  ca9: { code: "ca9", listingUrl: "https://www.ca9.uscourts.gov/decisions/opinions/",
    requests: () => [
      get("https://www.ca9.uscourts.gov/decisions/opinions/index.xml", "opinions-rss", "opinion", true),
      get("https://www.ca9.uscourts.gov/decisions/memoranda/index.xml", "memoranda-rss", "memorandum", false),
    ], parse: fromRss("ca9") },
  ca10: { code: "ca10", listingUrl: "https://www.ca10.uscourts.gov/clerk/opinions/daily",
    requests: () => [get("https://www.ca10.uscourts.gov/opinions/new/daily_decisions.rss", "daily-rss", "opinion", null)], parse: fromRss("ca10") },
  ca11: { code: "ca11", listingUrl: "https://media.ca11.uscourts.gov/opinions/pub/logname.php",
    requests: () => [
      get("https://media.ca11.uscourts.gov/opinions/pub/logname.php", "published-log", "opinion", true),
      get("https://media.ca11.uscourts.gov/opinions/unpub/logname.php", "unpublished-log", "opinion", false),
    ],
    parse: (body, request) => parseCa11Table(body, request.url, request).map(({ sourceId: _sourceId, ...item }) => item) },
  cadc: { code: "cadc", listingUrl: "https://media.cadc.uscourts.gov/opinions/",
    requests: () => [get("https://media.cadc.uscourts.gov/opinions/rss.xml", "opinions-rss", "opinion", null)], parse: fromRss("cadc") },
  cafc: { code: "cafc", listingUrl: "https://www.cafc.uscourts.gov/home/case-information/opinions-orders/",
    requests: () => [get("https://www.cafc.uscourts.gov/feed/", "opinions-orders-rss", "opinion", null)], parse: parseCafc },
};

export function circuitAdapter(code: string): CircuitAdapter | null {
  return CIRCUIT_ADAPTERS[code.trim().toLowerCase()] ?? null;
}

/** Same court + docket + document = one item, across a court's overlapping listings. */
export function dedupeAdapterItems(items: readonly AdapterItem[]): AdapterItem[] {
  const seen = new Map<string, AdapterItem>();
  for (const item of items) {
    const key = `${item.courtCode}|${item.docketNumber.replace(/[^0-9a-z]/gi, "").toLowerCase()}|${item.documentUrl}`;
    const prior = seen.get(key);
    if (!prior) seen.set(key, item);
    else if (prior.precedential === null && item.precedential !== null) seen.set(key, { ...prior, precedential: item.precedential });
  }
  return [...seen.values()];
}

export { precedentialFrom };
