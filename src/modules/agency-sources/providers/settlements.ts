/**
 * Class-action settlement administrators and the court-approved settlement websites
 * they list. JND Legal Administration publishes its whole case list (case name,
 * case number, settlement amount, settlement website) in the page's Nuxt payload;
 * the case number is used only when it is a district docket and the listing names
 * the court. Each listed settlement website is then read (homepage only, robots.txt
 * checked, at most a few per run, each at most weekly) for the case number and
 * court it states, its key deadlines and the court documents it posts.
 *
 * Epiq, Kroll and Angeion publish no public case index Jurvio can read (checked
 * 2026-10-31): they are registered but not polled, and their settlement websites
 * enter through JND-style listings or agency releases instead.
 */
import { findCourtMentions } from "../domain/federal-courts";
import { findDistrictDockets } from "../domain/district-docket";
import { extractCaseReferences, restrictedReason } from "../domain/extract";
import { collapse, htmlToText, links } from "../domain/html";
import { documentKind, type AgencyItem, type AgencySourceDefinition, type KeyDate } from "../domain/item";
import type { SourceAdapter, SourceContext, SourceOutcome } from "./context";
import { dedupeDocuments } from "./doj";

export const JND_SOURCE: AgencySourceDefinition = {
  code: "settlement-admin-jnd", name: "JND Legal Administration case list", agencyKind: "settlement_admin", jurisdiction: "US",
  publisher: "JND Legal Administration", homeUrl: "https://www.jndla.com/cases", feedUrl: "https://www.jndla.com/cases", enabled: true,
};
export const SETTLEMENT_SITES_SOURCE: AgencySourceDefinition = {
  code: "settlement-websites", name: "Court-approved class settlement websites", agencyKind: "settlement_admin", jurisdiction: "US",
  publisher: "Court-approved settlement website", homeUrl: "https://www.jndla.com/cases", feedUrl: null, enabled: true,
};
export const UNPOLLED_ADMINISTRATORS: AgencySourceDefinition[] = [
  { code: "settlement-admin-epiq", name: "Epiq class action administration", agencyKind: "settlement_admin", jurisdiction: "US", publisher: "Epiq",
    homeUrl: "https://www.epiqglobal.com/en-us/services/class-action-mass-tort/class-action-administration", feedUrl: null, enabled: false,
    disabledReason: "no public case index (2026-10-31: case-list URLs 404; dm.epiq11.com covers bankruptcy, not class actions)" },
  { code: "settlement-admin-kroll", name: "Kroll settlement administration", agencyKind: "settlement_admin", jurisdiction: "US", publisher: "Kroll",
    homeUrl: "https://www.kroll.com/en/services/settlement-administration", feedUrl: null, enabled: false,
    disabledReason: "kroll.com and restructuring.ra.kroll.com return HTTP 403 to Jurvio's declared User-Agent (2026-10-31)" },
  { code: "settlement-admin-angeion", name: "Angeion Group", agencyKind: "settlement_admin", jurisdiction: "US", publisher: "Angeion Group",
    homeUrl: "https://www.angeiongroup.com/", feedUrl: null, enabled: false,
    disabledReason: "no public case index (2026-10-31: only a 'landmark cases' marketing list, no case numbers)" },
];

export interface JndCase {
  projectCode: string; caseName: string; caseNumber: string; settlementAmount: string | null; status: string | null;
  websiteUrl: string | null; descriptionText: string;
}

type Payload = unknown[];

function resolve(payload: Payload, value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < payload.length) value = payload[value];
  if (Array.isArray(value)) {
    if (typeof value[0] === "string" && ["Reactive", "ShallowReactive", "Ref", "ShallowRef"].includes(value[0])) return resolve(payload, value[1], depth + 1);
    return value.map((entry) => resolve(payload, entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, resolve(payload, entry, depth + 1)]));
  }
  return value;
}

function elementValue(payload: Payload, element: unknown): unknown {
  const resolved = resolve(payload, element);
  return resolved && typeof resolved === "object" && "value" in (resolved as object) ? (resolved as { value: unknown }).value : resolved;
}

/** JND's Kontent.ai case items from the Nuxt payload (devalue-encoded array). */
export function parseJndCases(html: string): JndCase[] {
  const match = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error("jndla.com: no __NUXT_DATA__ payload (layout changed?)");
  const payload = JSON.parse(match[1]!) as Payload;
  const cases: JndCase[] = [];
  const seen = new Set<string>();
  for (const entry of payload) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !("case_number" in entry) || !("project_code" in entry)) continue;
    const item = entry as Record<string, unknown>;
    const text = (key: string) => {
      const value = elementValue(payload, item[key]);
      return typeof value === "string" ? collapse(value) : null;
    };
    const status = elementValue(payload, item.status);
    const projectCode = text("project_code");
    if (!projectCode || seen.has(projectCode)) continue;
    seen.add(projectCode);
    const website = text("case_website_url");
    cases.push({
      projectCode, caseName: text("case_name") ?? projectCode, caseNumber: text("case_number") ?? "",
      settlementAmount: text("settlement_amount"),
      status: Array.isArray(status) && status[0] && typeof status[0] === "object" ? String((status[0] as { name?: string }).name ?? "") || null : null,
      websiteUrl: website && /^https:\/\//.test(website) ? website : null,
      descriptionText: htmlToText(String(elementValue(payload, item.description) ?? "")),
    });
  }
  return cases;
}

/** A JND listing entry as an item, only when its case number is a district docket. */
export function jndItem(entry: JndCase, now?: Date): AgencyItem | null {
  const dockets = findDistrictDockets(entry.caseNumber, now);
  if (dockets.length === 0) return null;
  // The listing's case number field states the docket(s); the court comes only from its description.
  const description = entry.descriptionText;
  const courts = [...new Set(findCourtMentions(description).map((mention) => mention.code))];
  const references = dockets.map((docket) => ({
    docket, courtCode: courts.length === 1 ? courts[0]! : null,
    courtEvidence: courts.length === 1 ? findCourtMentions(description)[0]!.text : null,
  }));
  return {
    sourceCode: JND_SOURCE.code, sourceRecordId: entry.projectCode, sourceUrl: JND_SOURCE.homeUrl, title: entry.caseName,
    itemKind: "settlement_listing", issuingOffice: "JND Legal Administration", publishedAt: null, officialExcerpt: null,
    documents: entry.websiteUrl ? [{ url: entry.websiteUrl, label: "Settlement website", kind: "settlement_website" }] : [],
    keyDates: [],
    settlementAmount: entry.settlementAmount, references, statedCourts: courts,
    restrictedReason: restrictedReason(entry.caseName, description), matchText: `${entry.caseName}\n${description}`,
    changeKey: `${entry.caseNumber}|${entry.settlementAmount ?? ""}|${entry.status ?? ""}|${entry.websiteUrl ?? ""}`,
  };
}

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const DATE = new RegExp(`(${MONTH}\\s+\\d{1,2},\\s+\\d{4}|\\d{1,2}/\\d{1,2}/\\d{4})`, "i");
const DEADLINES: Array<[string, RegExp]> = [
  ["Claim deadline", /\b(?:claims?(?: form)?(?: filing| submission)? deadline|deadline to (?:file|submit) (?:a )?claims?|submit (?:a |your )?claim (?:form )?(?:by|no later than|on or before))\b/i],
  ["Exclusion (opt-out) deadline", /\b(?:exclusion|opt[- ]out|request (?:for|to be excluded)[^.]{0,20}) deadline|deadline to (?:exclude yourself|opt out|request exclusion)|exclude yourself[^.]{0,40}?(?:by|no later than|on or before)\b/i],
  ["Objection deadline", /\b(?:objection deadline|deadline to (?:object|file an objection)|object[^.]{0,40}?(?:by|no later than|on or before))\b/i],
  ["Final approval hearing", /\b(?:final (?:approval|fairness) hearing)\b/i],
];

function toIsoDay(value: string): string | null {
  const parsed = Date.parse(value.replace(/(\w{3})\w*\.?\s/, "$1 "));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

/** Deadlines a settlement website states: a label followed (within 160 characters) by a date. */
export function settlementDeadlines(text: string): KeyDate[] {
  const flat = collapse(text);
  const found: KeyDate[] = [];
  for (const [label, pattern] of DEADLINES) {
    const match = pattern.exec(flat);
    if (!match) continue;
    const after = flat.slice(match.index, match.index + match[0].length + 160);
    const date = DATE.exec(after);
    const iso = date ? toIsoDay(date[1]!) : null;
    if (iso) found.push({ label, date: iso });
  }
  return found;
}

export function settlementSiteItem(entry: JndCase, html: string, now: Date = new Date()): AgencyItem {
  const body = html.replace(/<(?:nav|header|footer)\b[\s\S]*?<\/(?:nav|header|footer)>/gi, " ");
  const text = htmlToText(body);
  const site = new URL(entry.websiteUrl!);
  const documents = dedupeDocuments(links(body, site.toString())
    .filter((link) => /\.pdf(?:$|\?)/i.test(link.url) || /complaint|settlement agreement|order|notice|motion|judgment/i.test(link.label))
    .filter((link) => new URL(link.url).hostname.endsWith(site.hostname.replace(/^www\./, "")))
    .map((link) => ({ url: link.url, label: link.label || "Document", kind: documentKind(link.label, link.url) })))
    .slice(0, 20);
  return {
    sourceCode: SETTLEMENT_SITES_SOURCE.code, sourceRecordId: site.hostname.replace(/^www\./, ""), sourceUrl: site.toString(),
    title: entry.caseName, itemKind: "settlement_notice", issuingOffice: `Settlement website (administrator: JND Legal Administration)`,
    publishedAt: null, officialExcerpt: null, documents, keyDates: settlementDeadlines(text),
    settlementAmount: entry.settlementAmount, references: extractCaseReferences(text, now),
    statedCourts: [...new Set(findCourtMentions(text).map((mention) => mention.code))],
    restrictedReason: restrictedReason(entry.caseName, ...documents.map((document) => document.label)), matchText: text,
    changeKey: now.toISOString(),
  };
}

const JND_REFRESH_MS = 20 * 60 * 60_000;
const SITES_PER_RUN = 6;
const SITE_REVISIT_MS = 7 * 24 * 60 * 60_000;

/** JND: re-read the (5 MB) list at most every 20 hours. */
async function runJnd(context: SourceContext): Promise<SourceOutcome> {
  if (context.cursor && context.now.getTime() - Date.parse(context.cursor) < JND_REFRESH_MS) {
    return { itemsSeen: 0, items: [], warnings: [], cursor: context.cursor };
  }
  const cases = parseJndCases(await context.fetchText(JND_SOURCE.feedUrl!, "text/html"));
  const items = cases.map((entry) => jndItem(entry, context.now)).filter((item): item is AgencyItem => Boolean(item));
  const known = await context.known(items.map((item) => item.sourceRecordId));
  return {
    itemsSeen: cases.length, warnings: [], cursor: context.now.toISOString(),
    items: items.filter((item) => known.get(item.sourceRecordId) !== item.changeKey),
  };
}

/** Settlement websites named by stored JND entries that state a federal docket, each read at most weekly. */
async function runSettlementSites(context: SourceContext): Promise<SourceOutcome> {
  const listed = (await context.storedItems(JND_SOURCE.code)).flatMap((item) => {
    const website = item.documents.find((document) => document.kind === "settlement_website")?.url;
    if (!website || item.dockets.length === 0) return [];
    return [{ projectCode: item.sourceRecordId, caseName: item.title, caseNumber: item.dockets.join("; "), settlementAmount: item.settlementAmount,
      status: null, websiteUrl: website, descriptionText: "", courtKnown: item.statedCourts.length === 1 }];
  });
  const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");
  const known = await context.known(listed.map((entry) => host(entry.websiteUrl)));
  const due = listed
    .filter((entry) => { const seen = known.get(host(entry.websiteUrl)); return !seen || context.now.getTime() - Date.parse(seen) > SITE_REVISIT_MS; })
    .sort((a, b) => Number(b.courtKnown) - Number(a.courtKnown))
    .slice(0, SITES_PER_RUN);
  const outcome: SourceOutcome = { itemsSeen: listed.length, items: [], warnings: [] };
  for (const entry of due) {
    if (!context.canFetch()) break;
    try {
      outcome.items.push(settlementSiteItem(entry, await context.fetchText(entry.websiteUrl, "text/html"), context.now));
    } catch (error) {
      outcome.warnings.push(`${entry.websiteUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return outcome;
}

export const SETTLEMENT_SITES_ADAPTER: SourceAdapter = {
  definition: SETTLEMENT_SITES_SOURCE, budget: { maxRequests: SITES_PER_RUN * 2, maxMs: 5 * 60_000, minIntervalMs: 3_000 }, run: runSettlementSites,
};

export const JND_ADAPTER: SourceAdapter = { definition: JND_SOURCE, budget: { maxRequests: 1, maxMs: 2 * 60_000, minIntervalMs: 1_000 }, run: runJnd };
export const UNPOLLED_ADMINISTRATOR_ADAPTERS: SourceAdapter[] = UNPOLLED_ADMINISTRATORS.map((definition) => ({ definition, budget: { maxRequests: 0, maxMs: 0, minIntervalMs: 0 } }));
