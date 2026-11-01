/**
 * U.S. Securities and Exchange Commission: litigation releases (federal court
 * actions; the release page states the caption, civil action number and
 * court, e.g. "6:26-cv-05267-JDA (D.S.C. filed Oct. 29, 2026)", and links the
 * complaint) and administrative proceedings (in-house SEC orders, which are
 * not federal court cases and are stored as such).
 *
 * SEC fair access: declared User-Agent with contact e-mail, well under 10
 * requests per second (one request every 250 ms here, a handful per run).
 */
import { extractCaseReferences, restrictedReason } from "../domain/extract";
import { collapse, excerpt, htmlToText, isoDate, links, region, rssItems, rssTag } from "../domain/html";
import { documentKind, type AgencyItem, type AgencySourceDefinition } from "../domain/item";
import type { SourceAdapter, SourceContext, SourceOutcome } from "./context";
import { dedupeDocuments } from "./doj";

export const SEC_LR_SOURCE: AgencySourceDefinition = {
  code: "sec-litigation-releases", name: "SEC litigation releases and complaints", agencyKind: "sec", jurisdiction: "US",
  publisher: "U.S. Securities and Exchange Commission", homeUrl: "https://www.sec.gov/enforcement-litigation/litigation-releases",
  feedUrl: "https://www.sec.gov/enforcement-litigation/litigation-releases/rss", enabled: true,
};
export const SEC_AP_SOURCE: AgencySourceDefinition = {
  code: "sec-administrative-proceedings", name: "SEC administrative proceedings", agencyKind: "sec", jurisdiction: "US",
  publisher: "U.S. Securities and Exchange Commission", homeUrl: "https://www.sec.gov/enforcement-litigation/administrative-proceedings",
  feedUrl: "https://www.sec.gov/enforcement-litigation/administrative-proceedings/rss", enabled: true,
};

/** SEC asks automated clients to declare who they are and a contact e-mail. */
export function secUserAgent(configured = process.env.INGESTION_USER_AGENT): string {
  return configured && /@/.test(configured) ? configured : "Jurvio legal research ingestion contact@jurvio.com";
}

export interface SecFeedEntry { releaseNumber: string; title: string; url: string; publishedAt: string | null }

export function parseSecRss(xml: string): SecFeedEntry[] {
  return rssItems(xml).flatMap((item) => {
    const url = rssTag(item, "link")?.trim();
    const releaseNumber = rssTag(item, "dc:creator")?.trim() || url?.split("/").at(-1)?.replace(/\.pdf$/i, "").toUpperCase();
    const title = collapse(rssTag(item, "title") ?? "");
    if (!url || !releaseNumber || !title || !url.startsWith("https://")) return [];
    return [{ releaseNumber, title, url, publishedAt: isoDate(rssTag(item, "pubDate")) }];
  });
}

/** One litigation release page: its text from "Litigation Release No." on, and the linked court filings. */
export function parseSecLitigationRelease(html: string, entry: SecFeedEntry, now?: Date): AgencyItem {
  const main = region(html, /<main\b[\s\S]*?<\/main>/i, /<article\b[\s\S]*?<\/article>/i);
  const fullText = htmlToText(main);
  const start = fullText.search(/Litigation Release No\./i);
  const text = start >= 0 ? fullText.slice(start) : fullText;
  const documents = dedupeDocuments(links(main, entry.url)
    .filter((link) => /\/files\/litigation\/|\.pdf(?:$|\?)/i.test(link.url))
    .map((link) => ({ url: link.url, label: link.label || "Court filing", kind: documentKind(link.label, link.url) })));
  // The line under the release number states the court case: "SEC v. Name, No. (Court filed ...)".
  return {
    sourceCode: SEC_LR_SOURCE.code, sourceRecordId: entry.releaseNumber, sourceUrl: entry.url,
    title: `${entry.releaseNumber}: ${entry.title}`, itemKind: "litigation_release", issuingOffice: "Division of Enforcement",
    publishedAt: entry.publishedAt, officialExcerpt: excerpt(text.replace(/^Litigation Release No\.\s*\d+\s*\/\s*[A-Z][a-z]+\.? \d{1,2}, \d{4}\s*/, "")), documents, keyDates: [],
    settlementAmount: null, references: extractCaseReferences(text, now),
    restrictedReason: restrictedReason(entry.title, text, ...documents.map((document) => document.label)),
    matchText: text,
  };
}

export function secAdministrativeItem(entry: SecFeedEntry): AgencyItem {
  return {
    sourceCode: SEC_AP_SOURCE.code, sourceRecordId: entry.releaseNumber, sourceUrl: entry.url, title: `${entry.releaseNumber}: ${entry.title}`,
    itemKind: "administrative_proceeding", issuingOffice: "Securities and Exchange Commission", publishedAt: entry.publishedAt,
    officialExcerpt: null, documents: [{ url: entry.url, label: `Order ${entry.releaseNumber}`, kind: "order" }], keyDates: [],
    settlementAmount: null, references: [], notCourt: true, restrictedReason: restrictedReason(entry.title),
  };
}

const LR_DETAILS_PER_RUN = 25;

async function runSecLitigation(context: SourceContext): Promise<SourceOutcome> {
  const entries = parseSecRss(await context.fetchText(SEC_LR_SOURCE.feedUrl!, "application/rss+xml"));
  const known = await context.known(entries.map((entry) => entry.releaseNumber));
  const outcome: SourceOutcome = { itemsSeen: entries.length, items: [], warnings: [] };
  for (const entry of entries.filter((candidate) => !known.has(candidate.releaseNumber)).slice(0, LR_DETAILS_PER_RUN)) {
    if (!context.canFetch()) break;
    try {
      outcome.items.push(parseSecLitigationRelease(await context.fetchText(entry.url, "text/html"), entry, context.now));
    } catch (error) {
      outcome.warnings.push(`${entry.releaseNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return outcome;
}

async function runSecAdministrative(context: SourceContext): Promise<SourceOutcome> {
  const entries = parseSecRss(await context.fetchText(SEC_AP_SOURCE.feedUrl!, "application/rss+xml"));
  const known = await context.known(entries.map((entry) => entry.releaseNumber));
  return { itemsSeen: entries.length, items: entries.filter((entry) => !known.has(entry.releaseNumber)).map(secAdministrativeItem), warnings: [] };
}

const SEC_BUDGET = { maxRequests: LR_DETAILS_PER_RUN + 2, maxMs: 3 * 60_000, minIntervalMs: 250 };
export const SEC_ADAPTERS: SourceAdapter[] = [
  { definition: SEC_LR_SOURCE, budget: SEC_BUDGET, run: runSecLitigation },
  { definition: SEC_AP_SOURCE, budget: { ...SEC_BUDGET, maxRequests: 2 }, run: runSecAdministrative },
];
