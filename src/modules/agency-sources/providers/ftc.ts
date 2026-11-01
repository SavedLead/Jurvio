/**
 * Federal Trade Commission cases and proceedings (ftc.gov legal library).
 * The listing gives each case's "Type of Action" (Federal = a federal court
 * case, Administrative = an FTC administrative matter) and "Last Updated".
 * A federal case page states "Civil Action Number" and "Federal Court" as
 * fields, and lists the filings (complaint, orders, stipulated judgments).
 * robots.txt asks for Crawl-delay: 5, which is the request spacing here.
 */
import { courtFromField } from "../domain/federal-courts";
import { parseDistrictDocket } from "../domain/district-docket";
import { extractCaseReferences, restrictedReason, structuredReference } from "../domain/extract";
import { collapse, excerpt, htmlToText, isoDate, links, region } from "../domain/html";
import { documentKind, type AgencyItem, type AgencySourceDefinition, type KeyDate } from "../domain/item";
import type { SourceAdapter, SourceContext, SourceOutcome } from "./context";
import { dedupeDocuments } from "./doj";

export const FTC_SOURCE: AgencySourceDefinition = {
  code: "ftc-cases-proceedings", name: "FTC cases and proceedings", agencyKind: "ftc", jurisdiction: "US",
  publisher: "Federal Trade Commission", homeUrl: "https://www.ftc.gov/legal-library/browse/cases-proceedings",
  feedUrl: "https://www.ftc.gov/legal-library/browse/cases-proceedings?sort_by=field_date", enabled: true,
};

export interface FtcListingEntry { path: string; url: string; title: string; actionType: string | null; lastUpdated: string | null }

function field(html: string, label: string): string | null {
  const match = new RegExp(`<div class="field__label">\\s*${label}\\s*</div>[\\s\\S]*?<div class="field__item">([\\s\\S]*?)</div>`, "i").exec(html);
  return match ? collapse(htmlToText(match[1]!)) || null : null;
}

export function parseFtcListing(html: string): FtcListingEntry[] {
  const entries: FtcListingEntry[] = [];
  for (const match of html.matchAll(/<article about="(\/legal-library\/browse\/cases-proceedings\/[^"]+)" class="node node--type-case [^"]*">([\s\S]*?)<\/article>/g)) {
    const card = match[2]!;
    const title = /<h3 class="node-title"><a [^>]*>([\s\S]*?)<\/a>/.exec(card);
    const updated = /field--name-field-date[\s\S]*?<time datetime="([^"]+)"/.exec(card);
    entries.push({
      path: match[1]!, url: `https://www.ftc.gov${match[1]}`, title: title ? collapse(htmlToText(title[1]!)) : match[1]!.split("/").at(-1)!,
      actionType: field(card, "Type of Action"), lastUpdated: updated?.[1] ?? null,
    });
  }
  return entries;
}

export function parseFtcCase(html: string, entry: FtcListingEntry, now?: Date): AgencyItem {
  const main = region(html, /<main\b[\s\S]*?<\/main>/i);
  const civilAction = field(main, "Civil Action Number");
  const courtField = field(main, "Federal Court");
  const matter = field(main, "FTC Matter/File Number");
  const status = field(main, "Case Status");
  const summary = /Case Summary<\/h2>([\s\S]*?)<\/div>\s*<\/div>/i.exec(main);
  const docket = civilAction ? parseDistrictDocket(civilAction, now) : null;
  const courtCode = courtFromField(courtField);
  const references = docket
    ? structuredReference(docket, courtCode, `Federal Court: ${courtField ?? "not stated"}`)
    : extractCaseReferences(htmlToText(main), now);
  const keyDates: KeyDate[] = [];
  const documents = [];
  const timeline = main.split(/(?=<article about="[^"]*timeline-item)/).slice(1).map((part) => part.split(/<article about="(?![^"]*timeline-item)/)[0]!);
  for (const item of timeline) {
    const date = /<time datetime="([^"]+)"/.exec(item)?.[1];
    for (const link of links(item, entry.url)) {
      if (!/\.pdf(?:$|\?)|\/system\/files\//i.test(link.url)) continue;
      documents.push({ url: link.url, label: `${date ? `${date.slice(0, 10)}: ` : ""}${link.label}`, kind: documentKind(link.label, link.url) });
    }
  }
  if (status) keyDates.push({ label: `Case status: ${status}`, date: (entry.lastUpdated ?? "").slice(0, 10) });
  const caption = collapse(htmlToText(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? entry.title));
  return {
    sourceCode: FTC_SOURCE.code, sourceRecordId: entry.path.split("/").at(-1)!, sourceUrl: entry.url,
    title: caption || entry.title, itemKind: "case_page", issuingOffice: matter ? `FTC Matter ${matter}` : null,
    publishedAt: isoDate(entry.lastUpdated), officialExcerpt: summary ? excerpt(htmlToText(summary[1]!)) : null,
    documents: dedupeDocuments(documents), keyDates: keyDates.filter((date) => date.date), settlementAmount: null, references,
    restrictedReason: restrictedReason(caption, summary?.[1], ...documents.map((document) => document.label)),
    matchText: htmlToText(main),
  };
}

const DETAILS_PER_RUN = 12;

async function runFtc(context: SourceContext): Promise<SourceOutcome> {
  const entries = parseFtcListing(await context.fetchText(FTC_SOURCE.feedUrl!, "text/html"));
  if (entries.length === 0) throw new Error("ftc.gov listing: no case cards found (layout changed?)");
  const recordId = (entry: FtcListingEntry) => entry.path.split("/").at(-1)!;
  const known = await context.known(entries.map(recordId));
  const outcome: SourceOutcome = { itemsSeen: entries.length, items: [], warnings: [] };
  // New cases, and known ones whose "Last Updated" moved (new filings in the timeline).
  const due = entries.filter((entry) => !known.has(recordId(entry)) || known.get(recordId(entry)) !== entry.lastUpdated);
  for (const entry of due.slice(0, DETAILS_PER_RUN)) {
    if (!/^federal$/i.test(entry.actionType ?? "")) {
      outcome.items.push({
        sourceCode: FTC_SOURCE.code, sourceRecordId: recordId(entry), sourceUrl: entry.url, title: entry.title,
        itemKind: "administrative_proceeding", issuingOffice: "Federal Trade Commission", publishedAt: isoDate(entry.lastUpdated),
        officialExcerpt: null, documents: [], keyDates: [], settlementAmount: null, references: [], notCourt: true,
        restrictedReason: restrictedReason(entry.title), changeKey: entry.lastUpdated,
      });
      continue;
    }
    if (!context.canFetch()) break;
    try {
      outcome.items.push({ ...parseFtcCase(await context.fetchText(entry.url, "text/html"), entry, context.now), changeKey: entry.lastUpdated });
    } catch (error) {
      outcome.warnings.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return outcome;
}

export const FTC_ADAPTER: SourceAdapter = {
  definition: FTC_SOURCE,
  budget: { maxRequests: DETAILS_PER_RUN + 1, maxMs: 4 * 60_000, minIntervalMs: 5_000 },
  run: runFtc,
};
