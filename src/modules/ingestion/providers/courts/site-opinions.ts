/**
 * District court website opinion pages: the free "Opinions" lists some
 * districts keep on their uscourts.gov site, in addition to GovInfo. Checked
 * on 2026-10-31 by probing every district's site (/judges-info/opinions,
 * /opinions, ...): these six list current opinions with PDFs. The others
 * either link to GovInfo (read by the govinfo-daily job) or list only
 * archives from before 2015 (alnd, ctd, insd, kywd, tned).
 * Pure: parsing only.
 */
import { decodeHtml } from "../scotus/official-docket";

export interface SiteOpinionSource {
  courtCode: string;
  url: string;
}

export const SITE_OPINION_SOURCES: readonly SiteOpinionSource[] = [
  { courtCode: "ded", url: "https://www.ded.uscourts.gov/judges-info/opinions" },
  { courtCode: "nhd", url: "https://www.nhd.uscourts.gov/opinions" },
  { courtCode: "pamd", url: "https://www.pamd.uscourts.gov/judges-info/opinions" },
  { courtCode: "vid", url: "https://www.vid.uscourts.gov/judges-info/opinions" },
  { courtCode: "wied", url: "https://www.wied.uscourts.gov/opinions" },
  { courtCode: "wvsd", url: "https://www.wvsd.uscourts.gov/judges-info/opinions" },
];

export interface SiteOpinionItem {
  courtCode: string;
  /**
   * Normalized docket ("1:25-cv-01083", "26-cv-00761"), or the bare
   * "yy-number" when the court leaves out the case type (ded). Null when none.
   */
  docketNumber: string | null;
  /** True when the docket has office, year, case type and number, so a case may be created from it. */
  docketComplete: boolean;
  caption: string;
  issuedOn: string | null;
  documentUrl: string;
  entryNumber: string | null;
}

const FULL_DOCKET = /\b(?:(\d{1,2}):)?(\d{2})-([a-z]{2,4})-(\d{1,6})\b/i;
/** "25-973", or the first of "15-611, 15-612". */
const BARE_DOCKET = /^\s*(\d{2})-(\d{1,6})\b/;
/** "26mc61", "25cv1083". */
const COMPACT_DOCKET = /^\s*(\d{2})([a-z]{2,4})(\d{1,6})\b/i;

function text(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Normalized docket from free text: office (when present), 2-digit year, lowercase type, 5-digit number. */
export function siteDocket(value: string): { docket: string; complete: boolean } | null {
  const full = FULL_DOCKET.exec(value);
  if (full) {
    const [, office, year, type, number] = full;
    return { docket: `${office ? `${office}:` : ""}${year}-${type!.toLowerCase()}-${number!.padStart(5, "0")}`, complete: Boolean(office) };
  }
  const compact = COMPACT_DOCKET.exec(value);
  if (compact) return { docket: `${compact[1]}-${compact[2]!.toLowerCase()}-${compact[3]!.padStart(5, "0")}`, complete: false };
  const bare = BARE_DOCKET.exec(value);
  if (bare) return { docket: `${bare[1]}-${bare[2]!.padStart(5, "0")}`, complete: false };
  return null;
}

function usDate(value: string): string | null {
  const iso = /content="(\d{4}-\d{2}-\d{2})T/.exec(value)?.[1];
  if (iso) return iso;
  const us = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(text(value));
  if (!us) return null;
  const year = us[3]!.length === 2 ? `20${us[3]}` : us[3]!;
  return `${year}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
}

function absolute(href: string, base: string): string {
  try { return new URL(decodeHtml(href), base).toString(); } catch { return href; }
}

function cleanSiteCaption(value: string, docket: string | null): string {
  let caption = value
    .replace(FULL_DOCKET, " ")
    .replace(/\(ECF No\.?\s*\d+\)/i, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})\b/g, " ")
    .replace(/\.pdf$/i, "")
    .replace(/-[A-Z]{2,4}(?:-[A-Z]{2,4})*\b/g, " ")
    .replace(/\s*,\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (docket && caption.startsWith(docket)) caption = caption.slice(docket.length).trim();
  return caption.replace(/^[,\s-]+|[,\s-]+$/g, "").slice(0, 500);
}

/** ded: one table per date (date in <caption>), rows of title | case | judge | file. */
function parseDatedTables(html: string, courtCode: string, base: string): SiteOpinionItem[] {
  const items: SiteOpinionItem[] = [];
  for (const table of html.split(/<table class="views-table/).slice(1)) {
    const issuedOn = usDate(/<caption>([\s\S]*?)<\/caption>/.exec(table)?.[1] ?? "");
    const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(table)?.[1] ?? "";
    for (const row of body.split(/<tr\b/).slice(1)) {
      const cell = (name: string) => new RegExp(`views-field-${name}[^>]*>([\\s\\S]*?)</td>`).exec(row)?.[1] ?? "";
      const href = /href="([^"]+\.pdf)"/i.exec(cell("field-opinion-file"))?.[1];
      if (!href) continue;
      const docket = siteDocket(text(cell("field-case")));
      items.push({ courtCode, docketNumber: docket?.docket ?? null, docketComplete: docket?.complete ?? false,
        caption: cleanSiteCaption(text(cell("title")), null), issuedOn, documentUrl: absolute(href, base), entryNumber: null });
    }
  }
  return items;
}

/** Drupal views-row lists (nhd, pamd, vid, wied, wvsd). */
function parseViewsRows(html: string, courtCode: string, base: string): SiteOpinionItem[] {
  const items: SiteOpinionItem[] = [];
  for (const row of html.split(/<div class="views-row\b/).slice(1)) {
    const link = /<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/i.exec(row);
    if (!link) continue;
    const href = link[1]!;
    if (!/\/opinions?\//i.test(href)) continue;
    const anchor = text(link[2]!.replace(/<span[^>]*date-display[^>]*>[\s\S]*?<\/span>/g, " "));
    const caseField = text(/views-field-field-case-number[^>]*>([\s\S]*?)<\/div>\s*<\/div>/.exec(row)?.[1] ?? "");
    const bold = text(/<strong>([\s\S]*?)<\/strong>/.exec(row)?.[1] ?? "");
    const fileName = decodeURIComponent(href.split("/").pop() ?? "");
    const docket = siteDocket(caseField) ?? siteDocket(anchor) ?? siteDocket(bold) ?? siteDocket(fileName);
    const captionSource = bold || anchor || fileName;
    items.push({
      courtCode, docketNumber: docket?.docket ?? null, docketComplete: docket?.complete ?? false,
      caption: cleanSiteCaption(captionSource, docket?.docket ?? null),
      issuedOn: usDate(row), documentUrl: absolute(href, base),
      entryNumber: /\(ECF No\.?\s*(\d+)\)/i.exec(anchor)?.[1] ?? null,
    });
  }
  return items;
}

export function parseSiteOpinions(html: string, source: SiteOpinionSource): SiteOpinionItem[] {
  const items = html.includes('<table class="views-table') && /<caption>[\s\S]*?dc:date/.test(html)
    ? parseDatedTables(html, source.courtCode, source.url)
    : parseViewsRows(html, source.courtCode, source.url);
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.documentUrl) && Boolean(seen.add(item.documentUrl)));
}
