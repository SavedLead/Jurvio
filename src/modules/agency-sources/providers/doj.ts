/**
 * U.S. Department of Justice press releases: justice.gov's public JSON API
 * (api/v1/press_releases.json), one stream for the Office of Public Affairs,
 * every litigating division and all 94 U.S. Attorneys' Offices (the
 * "component" field names the issuing office, e.g. "USAO - Florida, Northern").
 */
import { extractCaseReferences, restrictedReason, type CaseReference } from "../domain/extract";
import { collapse, excerpt, htmlToText, isoDate, links } from "../domain/html";
import { documentKind, type AgencyItem, type AgencySourceDefinition } from "../domain/item";
import type { SourceAdapter, SourceContext, SourceOutcome } from "./context";

export const DOJ_SOURCE: AgencySourceDefinition = {
  code: "doj-press-releases", name: "U.S. Department of Justice press releases (OPA, divisions, 94 U.S. Attorneys' Offices)",
  agencyKind: "doj", jurisdiction: "US", publisher: "U.S. Department of Justice", homeUrl: "https://www.justice.gov/news",
  feedUrl: "https://www.justice.gov/api/v1/press_releases.json", enabled: true,
};

// Sorted by creation time. The API's paging is not stable (consecutive pages overlap), so a
// run reads back until 12 hours before the newest release it saw last time, not just until
// the first page with nothing new.
export const dojPageUrl = (page: number, pageSize = 50) =>
  `https://www.justice.gov/api/v1/press_releases.json?pagesize=${pageSize}&page=${page}&sort=created&direction=DESC`;

interface DojComponent { name?: string }
interface DojRecord {
  uuid?: string; url?: string; title?: string; body?: string; date?: string; changed?: string; created?: string; number?: string;
  component?: DojComponent[] | string;
}

function issuingOffice(components: DojRecord["component"], url: string): string | null {
  const names = Array.isArray(components) ? components.map((component) => component.name ?? "").filter(Boolean) : [];
  const usao = names.find((name) => /^USAO\b/.test(name));
  if (usao) return usao;
  if (/\/opa\//.test(url)) return "Office of Public Affairs";
  return names.find((name) => !/\((?:FBI|ATF|DEA|USMS)\)|Bureau|Administration/.test(name)) ?? names[0] ?? null;
}

const DOJ_DOCUMENT = /\/media\/\d+\/dl|\.pdf(?:$|\?)/i;

/** "<time datetime=\"2026-10-30T08:15:45-04:00\">…" → ISO. */
export function dojCreatedAt(value: string | undefined): string | null {
  const match = value ? /datetime="([^"]+)"/.exec(value) : null;
  return isoDate(match?.[1] ?? null);
}

export function parseDojPage(json: unknown, now?: Date): { items: AgencyItem[]; total: number; oldestCreated: string | null; newestCreated: string | null } {
  const results = (json as { results?: DojRecord[] })?.results;
  if (!Array.isArray(results)) throw new Error("justice.gov API: no results array");
  const items: AgencyItem[] = [];
  const created = results.map((record) => dojCreatedAt(record.created)).filter((value): value is string => Boolean(value)).sort();
  for (const record of results) {
    if (!record.uuid || !record.url || !record.title) continue;
    const url = record.url.startsWith("https://") ? record.url : `https://www.justice.gov${record.url}`;
    const body = record.body ?? "";
    const text = htmlToText(body);
    const title = collapse(htmlToText(record.title));
    const documents = links(body, url)
      .filter((link) => DOJ_DOCUMENT.test(link.url))
      .map((link) => ({ url: link.url.replace(/\?inline$/, ""), label: link.label || "Document", kind: documentKind(link.label, link.url) }));
    const seconds = Number(record.date);
    const publishedAt = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : isoDate(record.date);
    items.push({
      sourceCode: DOJ_SOURCE.code, sourceRecordId: record.uuid, sourceUrl: url, title,
      itemKind: "press_release", issuingOffice: issuingOffice(record.component, url), publishedAt,
      officialExcerpt: excerpt(text), documents: dedupeDocuments(documents), keyDates: [], settlementAmount: null,
      references: agreeWithOffice(extractCaseReferences(`${title}\n${text}`, now), issuingOffice(record.component, url)),
      restrictedReason: restrictedReason(title, text, ...documents.map((document) => document.label)),
      matchText: text,
    });
  }
  return { items, total: results.length, oldestCreated: created[0] ?? null, newestCreated: created.at(-1) ?? null };
}

/**
 * A U.S. Attorney's Office prosecutes in its own district. When the court read from the
 * text is a different district, the reading is not trusted: the reference goes to review.
 */
export function agreeWithOffice(references: CaseReference[], office: string | null): CaseReference[] {
  const district = usaoDistrict(office);
  if (!district) return references;
  return references.map((reference) => reference.courtCode && reference.courtCode !== district
    ? { ...reference, courtCode: null, courtEvidence: `court read as ${reference.courtCode} but issued by ${office}` }
    : reference);
}

export function dedupeDocuments<T extends { url: string }>(documents: T[]): T[] {
  const seen = new Set<string>();
  return documents.filter((document) => (seen.has(document.url) ? false : (seen.add(document.url), true)));
}

const OVERLAP_MS = 12 * 60 * 60_000;

/**
 * Newest first. Reads pages until one reaches 12 hours before the previous run's newest
 * release (6 pages at most; 4 on a first run), so an unstable page boundary cannot hide one.
 */
async function runDoj(context: SourceContext): Promise<SourceOutcome> {
  const maxPages = context.firstRun ? 4 : 6;
  const stopBefore = context.cursor ? Date.parse(context.cursor) - OVERLAP_MS : null;
  const outcome: SourceOutcome = { itemsSeen: 0, items: [], warnings: [], cursor: context.cursor };
  const seen = new Set<string>();
  for (let page = 0; page < maxPages && context.canFetch(); page++) {
    const parsed = parseDojPage(JSON.parse(await context.fetchText(dojPageUrl(page), "application/json")), context.now);
    const items = parsed.items.filter((item) => !seen.has(item.sourceRecordId));
    items.forEach((item) => seen.add(item.sourceRecordId));
    outcome.itemsSeen += items.length;
    if (parsed.newestCreated && (!outcome.cursor || parsed.newestCreated > outcome.cursor)) outcome.cursor = parsed.newestCreated;
    const known = await context.known(items.map((item) => item.sourceRecordId));
    outcome.items.push(...items.filter((item) => !known.has(item.sourceRecordId)));
    if (parsed.total === 0) break;
    if (stopBefore !== null && parsed.oldestCreated && Date.parse(parsed.oldestCreated) < stopBefore) break;
    if (stopBefore === null && !context.firstRun && items.every((item) => known.has(item.sourceRecordId))) break;
  }
  return outcome;
}

export const DOJ_ADAPTER: SourceAdapter = {
  definition: DOJ_SOURCE,
  budget: { maxRequests: 6, maxMs: 4 * 60_000, minIntervalMs: 2_000 },
  run: runDoj,
};

const USAO_DIRECTIONS: Record<string, string> = { northern: "n", southern: "s", eastern: "e", western: "w", middle: "m", central: "c" };

/** "USAO - Florida, Northern" → "flnd"; "USAO - Maine" → "med". Null when it is not a USAO component. */
export function usaoDistrict(office: string | null, stateCodes: Record<string, string> = STATE_CODES): string | null {
  const match = office ? /^USAO\s*-\s*([^,]+?)(?:,\s*(\w+))?\s*$/i.exec(office) : null;
  if (!match) return null;
  const state = stateCodes[match[1]!.trim().toLowerCase()];
  if (!state) return null;
  const direction = match[2] ? USAO_DIRECTIONS[match[2].toLowerCase()] : "";
  if (direction === undefined) return null;
  return `${state}${direction}d`;
}

const STATE_CODES: Record<string, string> = Object.fromEntries(Object.entries({
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut", de: "Delaware",
  dc: "District of Columbia", fl: "Florida", ga: "Georgia", gu: "Guam", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa",
  ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota",
  ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire", nj: "New Jersey", nm: "New Mexico",
  ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania", pr: "Puerto Rico",
  ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah", vt: "Vermont", vi: "Virgin Islands",
  va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming",
}).map(([code, name]) => [name.toLowerCase(), code]));
