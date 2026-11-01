/**
 * State attorneys general: press releases about federal-court cases, starting with
 * the largest states. Each office's own newsroom (RSS where it exists, else its
 * listing page) and each new release page. Releases that name no federal court or
 * federal docket are kept as title + link only (not_court); the rest go through the
 * same stated court + docket extraction and exact matching as the federal agencies.
 */
import { findCourtMentions } from "../domain/federal-courts";
import { findDistrictDockets } from "../domain/district-docket";
import { extractCaseReferences, restrictedReason } from "../domain/extract";
import { collapse, excerpt, htmlToText, isoDate, links, rssItems, rssTag } from "../domain/html";
import { documentKind, type AgencyItem, type AgencySourceDefinition } from "../domain/item";
import type { SourceAdapter, SourceContext, SourceOutcome } from "./context";
import { dedupeDocuments } from "./doj";

export interface StateAgConfig {
  state: string;
  office: string;
  listUrl: string;
  format: "rss" | "html";
  /** Release page paths on the office's own host. */
  linkPattern?: RegExp;
  /** Where the release body starts on its page, and where it ends. */
  bodyStart?: RegExp;
  bodyEnd?: RegExp;
  /** The RSS item carries the whole release (no page fetch needed). */
  fullTextInFeed?: boolean;
  disabledReason?: string;
}

export const STATE_AGS: readonly StateAgConfig[] = [
  { state: "CA", office: "California Attorney General", listUrl: "https://oag.ca.gov/news/feed", format: "rss",
    bodyStart: /class="region region-content"/, bodyEnd: /<footer|class="region region-footer/ },
  { state: "NY", office: "New York State Attorney General", listUrl: "https://ag.ny.gov/press-releases", format: "html",
    linkPattern: /^\/press-release\/\d{4}\/[a-z0-9-]+$/, bodyStart: /class="node-content/, bodyEnd: /<footer/ },
  { state: "TX", office: "Texas Attorney General", listUrl: "https://www.texasattorneygeneral.gov/news/releases", format: "html",
    linkPattern: /^\/news\/releases\/[a-z0-9-]+$/, bodyStart: /class="main-content-wysiwyg-container/, bodyEnd: /<footer/ },
  { state: "FL", office: "Florida Attorney General", listUrl: "https://www.myfloridalegal.com/newsrelease", format: "html",
    linkPattern: /^\/newsrelease\/[a-z0-9-]+$/, bodyEnd: /<footer/ },
  { state: "IL", office: "Illinois Attorney General", listUrl: "https://illinoisattorneygeneral.gov/news-room/", format: "html",
    linkPattern: /^\/news\/story\/[a-z0-9-]+$/, bodyStart: /class="news-body/, bodyEnd: /<footer/ },
  { state: "PA", office: "Pennsylvania Attorney General", listUrl: "https://www.attorneygeneral.gov/feed/", format: "rss", fullTextInFeed: true },
  { state: "MA", office: "Massachusetts Attorney General", listUrl: "https://www.mass.gov/collections/ago-press-releases", format: "html",
    linkPattern: /^\/news\/[a-z0-9-]+$/, bodyStart: /<main/, bodyEnd: /<footer/ },
  { state: "WA", office: "Washington State Attorney General", listUrl: "https://www.atg.wa.gov/news/news-releases", format: "html",
    linkPattern: /^\/news\/news-releases\/[a-z0-9-]+$/, bodyStart: /<article/, bodyEnd: /<\/article>/ },
  { state: "NJ", office: "New Jersey Attorney General", listUrl: "https://www.njoag.gov/news/", format: "html",
    linkPattern: /^\/[a-z0-9-]{20,}\/?$/, bodyStart: /<main|<article/, bodyEnd: /<footer|<\/article>/ },
  { state: "US-MULTI", office: "National Association of Attorneys General (multistate actions)", listUrl: "https://www.naag.org/news-resources/press-releases/", format: "html",
    linkPattern: /^\/press-releases\/[a-z0-9-]+\/?$/, bodyStart: /<main|<article/, bodyEnd: /<footer|<\/article>/ },
];

export const stateSourceCode = (config: Pick<StateAgConfig, "state">) =>
  config.state === "US-MULTI" ? "state-ag-multistate" : `state-ag-${config.state.toLowerCase()}`;

export function stateDefinition(config: StateAgConfig): AgencySourceDefinition {
  return {
    code: stateSourceCode(config), name: `${config.office} press releases`, agencyKind: "state_ag", jurisdiction: config.state,
    publisher: config.office, homeUrl: new URL(config.listUrl).origin, feedUrl: config.listUrl, enabled: !config.disabledReason,
    disabledReason: config.disabledReason,
  };
}

/** Newsroom pages that list their whole archive (Illinois: 1,100+ links) are read only for their newest releases. */
const LISTING_LIMIT = 60;

export interface ReleaseLink { url: string; title: string; publishedAt: string | null; body?: string }

export function parseStateListing(body: string, config: StateAgConfig): ReleaseLink[] {
  const origin = new URL(config.listUrl).origin;
  if (config.format === "rss") {
    return rssItems(body).flatMap((item) => {
      const url = rssTag(item, "link")?.trim();
      const title = collapse(rssTag(item, "title") ?? "");
      if (!url || !title || !url.startsWith("https://") || new URL(url).pathname === "/") return [];
      return [{ url, title, publishedAt: isoDate(rssTag(item, "pubDate")),
        body: config.fullTextInFeed ? rssTag(item, "content:encoded") ?? rssTag(item, "description") ?? undefined : undefined }];
    });
  }
  const seen = new Set<string>();
  return links(body, config.listUrl).flatMap((link) => {
    const url = new URL(link.url);
    url.hash = "";
    if (url.origin !== origin || !config.linkPattern?.test(url.pathname) || seen.has(url.pathname)) return [];
    seen.add(url.pathname);
    // Some newsrooms put the date in the link text ("October 29, 2026 ATTORNEY GENERAL ...").
    const title = link.label.replace(/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}, \d{4}\s*/i, "");
    return [{ url: url.toString(), title, publishedAt: null }];
  }).filter((link) => link.title.length > 12).slice(0, LISTING_LIMIT);
}

/** The release body between the configured markers (the whole page when a marker is missing). */
export function releaseBody(html: string, config: StateAgConfig): string {
  let body = html;
  const start = config.bodyStart ? body.search(config.bodyStart) : -1;
  if (start >= 0) body = body.slice(start);
  const end = config.bodyEnd ? body.slice(1).search(config.bodyEnd) : -1;
  if (end >= 0) body = body.slice(0, end + 1);
  return body;
}

const FEDERAL_COURT_WORDS = /\b(?:U\.?\s?S\.? District Court|United States District Court|federal (?:district )?court|federal judge)\b/i;
const MULTISTATE = /\b(?:multistate|bipartisan coalition|coalition of \d+|coalition of (?:attorneys general|states))\b/i;

export function stateReleaseItem(config: StateAgConfig, link: ReleaseLink, html: string, now?: Date): AgencyItem {
  const body = link.body ?? releaseBody(html, config);
  const text = htmlToText(body);
  const title = collapse(link.title || htmlToText(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? ""));
  const published = link.publishedAt ?? isoDate(/datetime="([^"]+)"/.exec(body)?.[1] ?? /content="(\d{4}-\d\d-\d\dT[^"]+)"/.exec(html)?.[1] ?? null);
  const federal = findCourtMentions(text).length > 0 || findDistrictDockets(text, now).length > 0 || FEDERAL_COURT_WORDS.test(text);
  const base = {
    sourceCode: stateSourceCode(config), sourceRecordId: new URL(link.url).pathname.replace(/\/$/, ""), sourceUrl: link.url,
    title, issuingOffice: config.office, publishedAt: published, keyDates: [], settlementAmount: null,
  };
  if (!federal) {
    return { ...base, itemKind: "press_release", officialExcerpt: null, documents: [], references: [], notCourt: true, restrictedReason: restrictedReason(title) };
  }
  const documents = dedupeDocuments(links(body, link.url)
    .filter((doc) => /\.pdf(?:$|\?)/i.test(doc.url))
    .map((doc) => ({ url: doc.url, label: doc.label || "Document", kind: documentKind(doc.label, doc.url) })));
  return {
    ...base, itemKind: MULTISTATE.test(text) ? "press_release_multistate" : "press_release",
    officialExcerpt: excerpt(text, 300), documents, references: extractCaseReferences(`${title}\n${text}`, now),
    statedCourts: [...new Set(findCourtMentions(text).map((mention) => mention.code))],
    restrictedReason: restrictedReason(title, text, ...documents.map((doc) => doc.label)), matchText: text,
  };
}

const DETAILS_PER_RUN = 8;

function stateAdapter(config: StateAgConfig): SourceAdapter {
  return {
    definition: stateDefinition(config),
    budget: { maxRequests: DETAILS_PER_RUN + 1, maxMs: 4 * 60_000, minIntervalMs: 3_000 },
    async run(context: SourceContext): Promise<SourceOutcome> {
      const listing = parseStateListing(await context.fetchText(config.listUrl, config.format === "rss" ? "application/rss+xml" : "text/html"), config);
      if (listing.length === 0) throw new Error(`${config.listUrl}: no releases found (layout changed?)`);
      const recordId = (link: ReleaseLink) => new URL(link.url).pathname.replace(/\/$/, "");
      const known = await context.known(listing.map(recordId));
      const outcome: SourceOutcome = { itemsSeen: listing.length, items: [], warnings: [] };
      for (const link of listing.filter((candidate) => !known.has(recordId(candidate))).slice(0, DETAILS_PER_RUN)) {
        if (link.body !== undefined) { outcome.items.push(stateReleaseItem(config, link, "", context.now)); continue; }
        if (!context.canFetch()) break;
        try {
          outcome.items.push(stateReleaseItem(config, link, await context.fetchText(link.url, "text/html"), context.now));
        } catch (error) {
          outcome.warnings.push(`${link.url}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return outcome;
    },
  };
}


export const STATE_AG_ADAPTERS: SourceAdapter[] = STATE_AGS.map(stateAdapter);
