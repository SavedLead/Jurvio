/**
 * Supreme Court orders-list monitor (phase 1).
 *
 * Reads the Court's public Orders of the Court index and the text of a
 * scheduled order list. Slip opinions, the 3-hour docket probe, and the
 * 10-minute emergency lane are separate jobs; this module does not call them.
 *
 * Certiorari denials stay distinct from merits rulings. Sealed and restricted
 * lines are counted and then dropped: caption, wording, and plain English are
 * not kept. Historical lists are marked backfilled. Feed mail stays off until
 * a later reviewed change; case-follow mail is not wired from these rows.
 */
import { createHash } from "node:crypto";
import { isRestrictedDocketText } from "@/modules/ingestion/domain/federal-stream";

export const ORDERS_PARSER_VERSION = "scotus-orders-v1";
export const ORDERS_ORIGIN = "https://www.supremecourt.gov";
/** Lists posted more than this many days before the run are history. */
export const LIVE_WINDOW_DAYS = 2;
/**
 * Subscriber mail for a new orders feed stays off. Historical rows stay
 * suppressed even if a later change flips this constant.
 */
export const ORDERS_FEED_NOTIFICATIONS_ENABLED = false;

export type OrdersLabel = "order_list" | "miscellaneous" | "separate_writing";

export type OrdersKind =
  | "cert_denied"
  | "cert_granted"
  | "summary_disposition"
  | "rehearing_denied"
  | "habeas_denied"
  | "mandamus_denied"
  | "prohibition_denied"
  | "attorney_discipline"
  | "motion_granted"
  | "motion_denied"
  | "pending_order"
  | "amendment"
  | "separate_writing"
  | "merits_ruling"
  | "other"
  | "withheld";

export type OrdersParseStatus = "pending" | "indexed" | "parsed" | "failed";

export interface OfficialOrdersItem {
  label: OrdersLabel;
  sourceUrl: string;
  postedOn: string;
  docketNumber: string | null;
  caption: string | null;
  authorText: string | null;
  citation: string | null;
}

export interface ParsedOrdersEntry {
  docketNumber: string | null;
  section: string;
  kind: OrdersKind;
  merits: boolean;
  caption: string | null;
  exactWording: string | null;
  authorText: string | null;
  withheld: boolean;
  /** Hash of wording that was dropped. Not the wording itself. */
  withholdKey: string | null;
}

export interface CaseCandidate {
  id: string;
  docketNumber: string;
  supremeCourtTerm: number | null;
}

export interface OrdersMatch {
  status: "matched" | "unmatched" | "ambiguous" | "withheld";
  caseId: string | null;
  count: number;
}

export interface OrdersAlertDecision {
  caseFollowEmail: false;
  feedNotification: boolean;
  reason: "historical_backfill" | "withheld" | "feed_notifications_disabled" | "feed_ready_case_mail_unwired";
}

export interface StoredOrdersList {
  sourceUrl: string;
  contentHash: string;
  postedOn: string;
  label: OrdersLabel;
  parseStatus: OrdersParseStatus;
  superseded: boolean;
  lastModified: string | null;
}

export interface StoredOrdersEntryRef {
  sourceUrl: string;
  sourceRecordId: string;
  docketNumber: string | null;
  kind: OrdersKind;
}

export interface OrdersEntryWrite {
  sourceRecordId: string;
  position: number;
  docketNumber: string | null;
  section: string;
  kind: OrdersKind;
  merits: boolean;
  caption: string | null;
  exactWording: string | null;
  plainLine: string | null;
  authorText: string | null;
  citation: string | null;
  sourceUrl: string;
  withheld: boolean;
  caseId: string | null;
  matchStatus: OrdersMatch["status"];
  matchCandidates: number;
  amendedFrom: string | null;
  backfilled: boolean;
}

export interface OrdersListWrite {
  sourceUrl: string;
  termYear: number;
  postedOn: string;
  label: OrdersLabel;
  contentHash: string;
  parseStatus: OrdersParseStatus;
  backfilled: boolean;
  lastModified: string | null;
  entryCount: number;
  withheldCount: number;
}

export type OrdersWrite =
  | { action: "insert"; list: OrdersListWrite; entries: OrdersEntryWrite[] }
  | { action: "update_pending"; list: OrdersListWrite; entries: OrdersEntryWrite[] }
  | { action: "supersede"; previousHash: string; list: OrdersListWrite; entries: OrdersEntryWrite[] }
  | { action: "touch"; sourceUrl: string };

export interface OrdersFailure {
  stage: string;
  sourceUrl: string | null;
  message: string;
}

export interface OrdersCoverageDiagnostic {
  runSucceeded: boolean;
  complete: boolean;
  successfulButIncomplete: boolean;
  ordersIndexKnown: boolean;
  relatingIndexKnown: boolean;
  missed: { sourceUrl: string; postedOn: string; label: OrdersLabel; reason: "absent" | "unparsed" }[];
  stale: { sourceUrl: string; storedPostedOn: string; officialPostedOn: string }[];
  failures: OrdersFailure[];
  withheldCount: number;
  newestPostedOn: string | null;
}

export interface OrdersWatchPlan {
  writes: OrdersWrite[];
  diagnostic: OrdersCoverageDiagnostic;
}

export interface OrdersPdfInput {
  sourceUrl: string;
  notModified?: boolean;
  contentHash?: string;
  lastModified?: string | null;
  text?: string;
  error?: string;
}

export interface OrdersWatchInput {
  termYear: number;
  runDay: string;
  explicitBackfill: boolean;
  ordersIndex: { html: string; pageUrl: string } | { error: string };
  relatingIndex: { html: string; pageUrl: string } | { error: string } | null;
  pdfs: OrdersPdfInput[];
  stored: StoredOrdersList[];
  previousEntries: StoredOrdersEntryRef[];
  candidates: CaseCandidate[];
}

const ALERT_RESTRICTED = /\b(seal|seals|sealed|sealing|unseal|unsealed|under seal|ex parte|in camera|grand jury|juvenile|restricted|suppressed|redacted)\b/i;
const SEALED_CAPTION = /\b(sealed|under seal|grand jury|juvenile|minor child|in re search|search warrant)\b/i;

const SECTION_HEADERS: { test: RegExp; kind: OrdersKind; title: string }[] = [
  { test: /^CERTIORARI\s*[-–—]{1,3}\s*SUMMARY DISPOSITIONS$/, kind: "summary_disposition", title: "CERTIORARI -- SUMMARY DISPOSITIONS" },
  { test: /^CERTIORARI GRANTED$/, kind: "cert_granted", title: "CERTIORARI GRANTED" },
  { test: /^CERTIORARI DENIED$/, kind: "cert_denied", title: "CERTIORARI DENIED" },
  { test: /^HABEAS CORPUS DENIED$/, kind: "habeas_denied", title: "HABEAS CORPUS DENIED" },
  { test: /^MANDAMUS DENIED$/, kind: "mandamus_denied", title: "MANDAMUS DENIED" },
  { test: /^PROHIBITION DENIED$/, kind: "prohibition_denied", title: "PROHIBITION DENIED" },
  { test: /^REHEARINGS DENIED$/, kind: "rehearing_denied", title: "REHEARINGS DENIED" },
  { test: /^ATTORNEY DISCIPLINE$/, kind: "attorney_discipline", title: "ATTORNEY DISCIPLINE" },
  { test: /^ORDERS IN PENDING CASES$/, kind: "pending_order", title: "ORDERS IN PENDING CASES" },
];

const ENTRY_LINE = /^(?<docket>\d{2}-\d{1,5}|\d{2}A\d{1,4}|\d{2}M\d{1,4}|D-\d{3,5}|\d{1,3},\s*ORIG\.?)\s+(?<caption>\S.*)$/;
const NO_DOCKET = /^No\.\s*(\d{2}-\d{1,5}|\d{2}A\d{1,4})\b/i;

const PLAIN: Record<Exclude<OrdersKind, "withheld">, string> = {
  cert_denied: "The Supreme Court denied review. The lower court's decision stays in place. This order does not decide the merits of the case.",
  cert_granted: "The Supreme Court agreed to hear this case. It has not decided the case yet.",
  summary_disposition: "The Supreme Court granted review and sent the case back to the lower court for another look. This is a summary order, not a full opinion deciding the case.",
  rehearing_denied: "The Supreme Court denied a petition for rehearing.",
  habeas_denied: "The Supreme Court denied a habeas corpus petition.",
  mandamus_denied: "The Supreme Court denied a mandamus petition.",
  prohibition_denied: "The Supreme Court denied a prohibition petition.",
  attorney_discipline: "The Supreme Court entered an attorney-discipline order.",
  motion_granted: "The Supreme Court granted a procedural motion.",
  motion_denied: "The Supreme Court denied a procedural motion.",
  pending_order: "The Supreme Court entered an order in a pending case. The wording below is the Court's.",
  amendment: "The Court amended an earlier order. The wording below is the amended text from this order list.",
  separate_writing: "A justice wrote separately about this order. The wording below is the Court's. It does not decide the merits of the case.",
  merits_ruling: "The Supreme Court decided this case on the merits.",
  other: "The Court entered an order. The wording below is the Court's.",
};

const INDEXED_SEPARATE_PLAIN = "The Court posted a separate opinion about an order in this case. The official PDF is the source. Jurvio has the index entry and has not copied the opinion text.";

/** October Term page number: /26 from October of that year, /25 before that. */
export function ordersTermYear(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric" }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const term = month >= 10 ? year : year - 1;
  return ((term % 100) + 100) % 100;
}

export function ordersIndexUrl(termYear: number): string {
  return `${ORDERS_ORIGIN}/orders/ordersofthecourt/${String(termYear).padStart(2, "0")}`;
}

export function relatingIndexUrl(termYear: number): string {
  return `${ORDERS_ORIGIN}/opinions/relatingtoorders/${String(termYear).padStart(2, "0")}`;
}

export function isoOrdersDate(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const year = match[3].length === 2
    ? (Number(match[3]) >= 70 ? 1900 + Number(match[3]) : 2000 + Number(match[3]))
    : Number(match[3]);
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeOrdersDocket(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim().toUpperCase().replace(/[–—]/g, "-").replace(/[ ,.]/g, "");
  return text || null;
}

/** Same word filter the emergency lane uses for lines and captions. */
export function ordersTextWithheld(value: string): boolean {
  return isRestrictedDocketText(value) || ALERT_RESTRICTED.test(value) || SEALED_CAPTION.test(value);
}

export function listIsHistorical(postedOn: string, runDay: string, explicitBackfill: boolean): boolean {
  if (explicitBackfill) return true;
  return daysBetween(postedOn, runDay) > LIVE_WINDOW_DAYS;
}

export function ordersAlertDecision(
  input: { historical: boolean; withheld: boolean },
  notificationsEnabled: boolean = ORDERS_FEED_NOTIFICATIONS_ENABLED,
): OrdersAlertDecision {
  if (input.withheld) return { caseFollowEmail: false, feedNotification: false, reason: "withheld" };
  if (input.historical) return { caseFollowEmail: false, feedNotification: false, reason: "historical_backfill" };
  if (!notificationsEnabled) return { caseFollowEmail: false, feedNotification: false, reason: "feed_notifications_disabled" };
  return { caseFollowEmail: false, feedNotification: true, reason: "feed_ready_case_mail_unwired" };
}

export function plainOrdersLine(kind: OrdersKind, indexedSeparate = false): string | null {
  if (kind === "withheld") return null;
  if (kind === "separate_writing" && indexedSeparate) return INDEXED_SEPARATE_PLAIN;
  return PLAIN[kind];
}

export function ordersRecordId(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

export function parseOrdersIndex(html: string, termYear: number, pageUrl: string): {
  pageTerm: number | null;
  termMismatch: boolean;
  items: OfficialOrdersItem[];
} {
  const found = /Term Year:\s*(\d{4})/i.exec(html);
  const pageTerm = found?.[1] ? Number(found[1]) % 100 : null;
  const termMismatch = pageTerm == null || pageTerm !== termYear;
  if (termMismatch) return { pageTerm, termMismatch: true, items: [] };
  const items: OfficialOrdersItem[] = [];
  for (const block of html.matchAll(/<div\b[^>]*style="display:block"[^>]*>([\s\S]*?)<\/div>/gi)) {
    const row = block[1] ?? "";
    const date = isoOrdersDate(/(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(row)?.[1] ?? "");
    const href = /href\s*=\s*['"]([^'"]+)['"]/i.exec(row)?.[1];
    const labelText = />(Order List|Miscellaneous Order)</i.exec(row)?.[1];
    if (!date || !href || !labelText) continue;
    const sourceUrl = officialPdfUrl(href, pageUrl);
    if (!sourceUrl || !sourceUrl.includes("/orders/courtorders/")) continue;
    items.push({
      label: /order list/i.test(labelText) ? "order_list" : "miscellaneous",
      sourceUrl, postedOn: date, docketNumber: null, caption: null, authorText: null, citation: null,
    });
  }
  return { pageTerm, termMismatch: false, items: dedupeItems(items) };
}

export function parseRelatingToOrdersIndex(html: string, pageUrl: string): OfficialOrdersItem[] {
  const items: OfficialOrdersItem[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...(row[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1] ?? "");
    if (cells.length < 5) continue;
    const href = /href\s*=\s*['"]([^'"]+\.pdf(?:#[^'"]*)?)['"]/i.exec(row[1] ?? "")?.[1];
    if (!href) continue;
    const sourceUrl = officialPdfUrl(href, pageUrl);
    const postedOn = isoOrdersDate(textOf(cells[0] ?? ""));
    const docketNumber = textOf(cells[1] ?? "") || null;
    const caption = textOf(cells[2] ?? "") || null;
    if (!sourceUrl || !postedOn || !docketNumber || !caption) continue;
    items.push({
      label: "separate_writing",
      sourceUrl,
      postedOn,
      docketNumber,
      caption,
      authorText: textOf(cells[3] ?? "") || null,
      citation: textOf(cells[4] ?? "") || null,
    });
  }
  return dedupeItems(items);
}

export function classifyOrdersBody(sectionKind: OrdersKind, body: string | null, separate: boolean): { kind: OrdersKind; merits: boolean } {
  if (separate) return { kind: "separate_writing", merits: false };
  const text = body ?? "";
  if (/\border list\b/i.test(text) && /\b(?:amended|corrected)\b/i.test(text)) return { kind: "amendment", merits: false };
  if (/\bdelivered the opinion of the Court\b/i.test(text) || /\bopinion of the Court\b/i.test(text)) return { kind: "merits_ruling", merits: true };
  if (sectionKind === "summary_disposition" || (/\bwrit of certiorari is granted\b/i.test(text) && /\b(?:vacated|remanded)\b/i.test(text))) {
    return { kind: "summary_disposition", merits: false };
  }
  if (sectionKind === "cert_granted" || (/\bwrit of certiorari is granted\b/i.test(text) && !/\b(?:vacated|remanded)\b/i.test(text))) {
    return { kind: "cert_granted", merits: false };
  }
  if (sectionKind === "rehearing_denied" || /\bpetitions? for rehearing (?:is|are) denied\b/i.test(text)) return { kind: "rehearing_denied", merits: false };
  if (sectionKind === "habeas_denied" || sectionKind === "mandamus_denied" || sectionKind === "prohibition_denied" || sectionKind === "attorney_discipline") {
    return { kind: sectionKind, merits: false };
  }
  if (sectionKind === "cert_denied" || /\bwrits? of certiorari (?:is|are) denied\b/i.test(text)) return { kind: "cert_denied", merits: false };
  if (sectionKind === "pending_order") {
    if (/\bis granted\b/i.test(text)) return { kind: "motion_granted", merits: false };
    if (/\bis denied\b/i.test(text)) return { kind: "motion_denied", merits: false };
    return { kind: "pending_order", merits: false };
  }
  return { kind: "other", merits: false };
}

/** Order-list text from pdftotext. Wording is the Court's, with line breaks collapsed. */
export function parseOrderListText(text: string, sourceUrl: string): ParsedOrdersEntry[] {
  void sourceUrl;
  const lines = text.replace(/\f/g, "\n").replace(/-\n\s*(?=[a-z])/g, "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const done: Draft[] = [];
  let sectionKind: OrdersKind = "other";
  let sectionTitle = "PREAMBLE";
  let current: Draft | null = null;
  let open: Draft[] = [];
  let writing: { docket: string | null; author: string | null; lines: string[] } | null = null;
  let writingDocket: string | null = null;
  let buffer: string[] = [];

  const emitOpen = () => {
    if (current) open.push(current);
    current = null;
    done.push(...open);
    open = [];
  };
  const flushBuffer = () => {
    const body = collapse(buffer.join(" "));
    buffer = [];
    if (!body) return;
    if (writing) {
      writing.lines.push(body);
      return;
    }
    const plural = /^The (petitions|motions|applications)\b/i.test(body);
    const targets = plural ? [...open, ...(current ? [current] : [])] : current ? [current] : open.slice(-1);
    for (const target of targets) target.body = target.body ? `${target.body} ${body}` : body;
    if (plural) {
      done.push(...targets);
      open = [];
      current = null;
    } else if (current && targets.includes(current)) {
      done.push(current);
      current = null;
    }
  };
  const finishWriting = () => {
    flushBuffer();
    if (!writing) return;
    done.push({
      docket: writing.docket,
      caption: null,
      sectionKind: "separate_writing",
      sectionTitle: "SEPARATE WRITING",
      body: collapse(writing.lines.join(" ")),
      separate: true,
      author: writing.author,
    });
    writing = null;
  };

  for (const line of lines) {
    if (skipLine(line)) continue;
    const noDocket = NO_DOCKET.exec(line);
    if (noDocket?.[1]) {
      flushBuffer();
      writingDocket = noDocket[1].toUpperCase();
      continue;
    }
    if (writingStart(line)) {
      finishWriting();
      emitOpen();
      writing = { docket: writingDocket, author: authorFromLine(line), lines: [collapse(line)] };
      continue;
    }
    const section = matchSection(line);
    if (section) {
      finishWriting();
      flushBuffer();
      emitOpen();
      sectionKind = section.kind;
      sectionTitle = section.title;
      continue;
    }
    const entry = ENTRY_LINE.exec(line);
    if (entry?.groups?.docket && entry.groups.caption) {
      finishWriting();
      flushBuffer();
      if (current) open.push(current);
      current = {
        docket: collapse(entry.groups.docket),
        caption: collapse(entry.groups.caption),
        sectionKind,
        sectionTitle,
        body: null,
        separate: false,
        author: null,
      };
      continue;
    }
    buffer.push(line);
  }
  finishWriting();
  flushBuffer();
  emitOpen();
  return done.filter((row) => row.sectionTitle !== "PREAMBLE" || row.separate).map((row) => toParsed(row));
}

export function matchOrdersCase(docketNumber: string | null, candidates: readonly CaseCandidate[]): OrdersMatch {
  const key = normalizeOrdersDocket(docketNumber);
  if (!key) return { status: "unmatched", caseId: null, count: 0 };
  const same = candidates.filter((candidate) => normalizeOrdersDocket(candidate.docketNumber) === key);
  const window = ordersTermWindow(key);
  if (window) {
    const inWindow = same.filter((candidate) => candidate.supremeCourtTerm != null && window.includes(candidate.supremeCourtTerm));
    const undated = same.filter((candidate) => candidate.supremeCourtTerm == null);
    if (inWindow.length === 1 && undated.length === 0) return { status: "matched", caseId: inWindow[0]!.id, count: same.length };
    if (inWindow.length > 1 || (inWindow.length === 1 && undated.length > 0)) return { status: "ambiguous", caseId: null, count: same.length };
    if (inWindow.length === 0 && undated.length === 1 && same.length === 1) return { status: "matched", caseId: undated[0]!.id, count: 1 };
    return { status: "unmatched", caseId: null, count: same.length };
  }
  if (same.length === 1) {
    const term = same[0]!.supremeCourtTerm;
    if (term != null && term < 1990) return { status: "unmatched", caseId: null, count: 1 };
    return { status: "matched", caseId: same[0]!.id, count: 1 };
  }
  if (same.length === 0) return { status: "unmatched", caseId: null, count: 0 };
  return { status: "ambiguous", caseId: null, count: same.length };
}

export interface OrderListFetchChoice {
  revalidate: { sourceUrl: string; lastModified: string | null } | null;
  downloads: string[];
}

/** Newest unparsed order list first. The newest already-parsed list is only rechecked, not treated as new work. */
export function chooseOrderListFetches(items: readonly OfficialOrdersItem[], stored: readonly StoredOrdersList[]): OrderListFetchChoice {
  const lists = items.filter((item) => item.label === "order_list")
    .slice()
    .sort((a, b) => b.postedOn.localeCompare(a.postedOn) || b.sourceUrl.localeCompare(a.sourceUrl));
  if (lists.length === 0) return { revalidate: null, downloads: [] };
  const newest = lists[0]!;
  const newestRow = currentStored(stored, newest.sourceUrl);
  if (!newestRow || newestRow.parseStatus !== "parsed") {
    return { revalidate: null, downloads: [newest.sourceUrl, ...lists.slice(1).filter((item) => !isParsed(stored, item.sourceUrl)).map((item) => item.sourceUrl)] };
  }
  return {
    revalidate: { sourceUrl: newest.sourceUrl, lastModified: newestRow.lastModified },
    downloads: lists.slice(1).filter((item) => !isParsed(stored, item.sourceUrl)).map((item) => item.sourceUrl),
  };
}

export function planOrdersWatch(input: OrdersWatchInput): OrdersWatchPlan {
  const failures: OrdersFailure[] = [];
  let ordersItems: OfficialOrdersItem[] = [];
  let ordersIndexKnown = false;
  if ("error" in input.ordersIndex) {
    failures.push({ stage: "orders_index", sourceUrl: null, message: clip(input.ordersIndex.error) });
  } else {
    const parsed = parseOrdersIndex(input.ordersIndex.html, input.termYear, input.ordersIndex.pageUrl);
    if (parsed.termMismatch) {
      failures.push({ stage: "orders_index", sourceUrl: input.ordersIndex.pageUrl, message: "orders index term did not match the requested term" });
    } else {
      ordersIndexKnown = true;
      ordersItems = parsed.items;
    }
  }

  let relatingItems: OfficialOrdersItem[] = [];
  let relatingIndexKnown = false;
  if (ordersIndexKnown && input.relatingIndex && "error" in input.relatingIndex) {
    failures.push({ stage: "relating_index", sourceUrl: null, message: clip(input.relatingIndex.error) });
  } else if (ordersIndexKnown && input.relatingIndex && "html" in input.relatingIndex) {
    relatingIndexKnown = true;
    relatingItems = parseRelatingToOrdersIndex(input.relatingIndex.html, input.relatingIndex.pageUrl);
  } else if (ordersIndexKnown) {
    failures.push({ stage: "relating_index", sourceUrl: null, message: "opinions relating to orders were not checked" });
  }

  const official = ordersIndexKnown ? [...ordersItems, ...relatingItems] : [];
  const pdfByUrl = new Map(input.pdfs.map((pdf) => [pdf.sourceUrl, pdf]));
  const writes: OrdersWrite[] = [];
  let withheldCount = 0;

  if (ordersIndexKnown) {
    for (const item of official) {
      const pdf = item.label === "order_list" ? pdfByUrl.get(item.sourceUrl) : undefined;
      if (pdf?.error) failures.push({ stage: "order_list_pdf", sourceUrl: item.sourceUrl, message: clip(pdf.error) });
      const write = writeForItem(item, input, pdf);
      if (!write) continue;
      if (write.action !== "touch") {
        withheldCount += write.entries.filter((entry) => entry.withheld).length;
        writes.push(write);
      } else writes.push(write);
    }
  }

  const storedAfter = applyWritesLocally(input.stored, writes, input.termYear);
  const diagnostic = diagnoseOrdersCoverage({
    runSucceeded: ordersIndexKnown,
    ordersIndexKnown,
    relatingIndexKnown,
    failures,
    official,
    stored: storedAfter,
    withheldCount,
  });
  return { writes, diagnostic };
}

export function diagnoseOrdersCoverage(input: {
  runSucceeded: boolean;
  ordersIndexKnown: boolean;
  relatingIndexKnown: boolean;
  failures: OrdersFailure[];
  official: readonly OfficialOrdersItem[];
  stored: readonly StoredOrdersList[];
  withheldCount: number;
}): OrdersCoverageDiagnostic {
  const missed: OrdersCoverageDiagnostic["missed"] = [];
  const stale: OrdersCoverageDiagnostic["stale"] = [];
  if (input.ordersIndexKnown) {
    for (const item of input.official) {
      const row = currentStored(input.stored, item.sourceUrl);
      if (!row) missed.push({ sourceUrl: item.sourceUrl, postedOn: item.postedOn, label: item.label, reason: "absent" });
      else if (item.label === "order_list" && row.parseStatus !== "parsed") {
        missed.push({ sourceUrl: item.sourceUrl, postedOn: item.postedOn, label: item.label, reason: "unparsed" });
      } else if (row.postedOn < item.postedOn) {
        stale.push({ sourceUrl: item.sourceUrl, storedPostedOn: row.postedOn, officialPostedOn: item.postedOn });
      }
    }
  }
  const complete = input.runSucceeded && input.ordersIndexKnown && input.relatingIndexKnown
    && missed.length === 0 && stale.length === 0 && input.failures.length === 0;
  const newestPostedOn = input.official.reduce<string | null>((newest, item) => newest == null || item.postedOn > newest ? item.postedOn : newest, null);
  return {
    runSucceeded: input.runSucceeded,
    complete,
    successfulButIncomplete: input.runSucceeded && !complete,
    ordersIndexKnown: input.ordersIndexKnown,
    relatingIndexKnown: input.relatingIndexKnown,
    missed, stale, failures: input.failures, withheldCount: input.withheldCount, newestPostedOn,
  };
}

interface Draft {
  docket: string | null;
  caption: string | null;
  sectionKind: OrdersKind;
  sectionTitle: string;
  body: string | null;
  separate: boolean;
  author: string | null;
}

function toParsed(row: Draft): ParsedOrdersEntry {
  const body = row.body;
  const classified = classifyOrdersBody(row.sectionKind, body, row.separate);
  const visible = [row.docket, row.caption, body, row.author].filter(Boolean).join(" ");
  if (ordersTextWithheld(visible)) {
    return {
      docketNumber: row.docket ? normalizeOrdersDocket(row.docket) : null,
      section: row.sectionTitle,
      kind: "withheld",
      merits: false,
      caption: null,
      exactWording: null,
      authorText: null,
      withheld: true,
      withholdKey: ordersRecordId([visible]),
    };
  }
  const exact = row.separate
    ? body
    : collapse([row.docket, row.caption, body].filter(Boolean).join(" "));
  return {
    docketNumber: row.docket ? normalizeOrdersDocket(row.docket) : null,
    section: row.sectionTitle,
    kind: classified.kind,
    merits: classified.merits,
    caption: row.caption,
    exactWording: exact || null,
    authorText: row.author,
    withheld: false,
    withholdKey: null,
  };
}

function writeForItem(item: OfficialOrdersItem, input: OrdersWatchInput, pdf: OrdersPdfInput | undefined): OrdersWrite | null {
  const current = input.stored.filter((row) => row.sourceUrl === item.sourceUrl && !row.superseded);
  const historical = listIsHistorical(item.postedOn, input.runDay, input.explicitBackfill);
  if (item.label === "order_list") {
    if (pdf?.notModified) return { action: "touch", sourceUrl: item.sourceUrl };
    if (pdf?.text && pdf.contentHash) {
      const parsedRow = current.find((row) => row.parseStatus === "parsed");
      if (parsedRow?.contentHash === pdf.contentHash) return { action: "touch", sourceUrl: item.sourceUrl };
      const entries = entriesFromOrderList(item, pdf.text, pdf.contentHash, input, historical);
      const list = listBody(item, input.termYear, pdf.contentHash, "parsed", historical, pdf.lastModified ?? null, entries);
      if (parsedRow) return { action: "supersede", previousHash: parsedRow.contentHash, list, entries };
      if (current.some((row) => row.parseStatus === "pending")) return { action: "update_pending", list, entries };
      return { action: "insert", list, entries };
    }
    if (current.length > 0) return null;
    return { action: "insert", list: listBody(item, input.termYear, "pending", "pending", historical, null, []), entries: [] };
  }
  const hash = item.label === "miscellaneous"
    ? ordersRecordId(["indexed", item.sourceUrl, item.postedOn, item.label])
    : ordersRecordId(["indexed", item.sourceUrl, item.postedOn, item.docketNumber ?? "", item.authorText ?? "", item.citation ?? ""]);
  if (current.some((row) => row.contentHash === hash)) return null;
  const entries = item.label === "separate_writing" ? [indexedSeparateEntry(item, input, historical)] : [];
  const list = listBody(item, input.termYear, hash, "indexed", historical, null, entries);
  const previous = current.find((row) => row.parseStatus === "indexed" || row.parseStatus === "parsed");
  if (previous) return { action: "supersede", previousHash: previous.contentHash, list, entries };
  return { action: "insert", list, entries };
}

function entriesFromOrderList(
  item: OfficialOrdersItem,
  text: string,
  contentHash: string,
  input: OrdersWatchInput,
  historical: boolean,
): OrdersEntryWrite[] {
  void contentHash;
  const previous = input.previousEntries.filter((entry) => entry.sourceUrl === item.sourceUrl);
  const known = new Set(previous.map((entry) => entry.sourceRecordId));
  const parsed = parseOrderListText(text, item.sourceUrl);
  const writes: OrdersEntryWrite[] = [];
  parsed.forEach((entry, index) => {
    const record = toEntryWrite(entry, item, input, historical, index + 1, false);
    if (known.has(record.sourceRecordId)) return;
    record.amendedFrom = amendedFrom(record, previous);
    writes.push(record);
  });
  return writes;
}

function indexedSeparateEntry(item: OfficialOrdersItem, input: OrdersWatchInput, historical: boolean): OrdersEntryWrite {
  const withheld = ordersTextWithheld([item.caption, item.docketNumber, item.authorText, item.citation].filter(Boolean).join(" "));
  const entry: ParsedOrdersEntry = {
    docketNumber: item.docketNumber ? normalizeOrdersDocket(item.docketNumber) : null,
    section: "OPINIONS RELATING TO ORDERS",
    kind: withheld ? "withheld" : "separate_writing",
    merits: false,
    caption: withheld ? null : item.caption,
    exactWording: null,
    authorText: withheld ? null : item.authorText,
    withheld,
    withholdKey: withheld ? ordersRecordId([[item.caption, item.docketNumber, item.authorText, item.citation].filter(Boolean).join(" ")]) : null,
  };
  return toEntryWrite(entry, item, input, historical, 1, true, item.citation);
}

function toEntryWrite(
  entry: ParsedOrdersEntry,
  item: OfficialOrdersItem,
  input: OrdersWatchInput,
  historical: boolean,
  position: number,
  indexedSeparate: boolean,
  citation: string | null = null,
): OrdersEntryWrite {
  const identitySource = entry.withheld
    ? ["withheld", item.sourceUrl, entry.docketNumber ?? "", entry.section, entry.withholdKey ?? ""]
    : [item.sourceUrl, entry.docketNumber ?? "", entry.section, entry.exactWording ?? "", entry.authorText ?? "", citation ?? ""];
  const match = entry.withheld
    ? { status: "withheld" as const, caseId: null, count: 0 }
    : matchOrdersCase(entry.docketNumber, input.candidates);
  return {
    sourceRecordId: ordersRecordId(identitySource),
    position,
    docketNumber: entry.docketNumber,
    section: entry.section,
    kind: entry.kind,
    merits: entry.kind === "merits_ruling",
    caption: entry.withheld || (entry.caption?.length ?? 0) > 1000 ? null : entry.caption,
    exactWording: entry.withheld || (entry.exactWording?.length ?? 0) > 100_000 ? null : entry.exactWording,
    plainLine: entry.withheld ? null : indexedSeparate
      ? plainOrdersLine(entry.kind, true)
      : entry.exactWording && entry.exactWording.length <= 100_000
        ? plainOrdersLine(entry.kind)
        : "The official PDF is the source for this entry. Jurvio did not copy the text.",
    authorText: entry.withheld ? null : entry.authorText,
    citation: entry.withheld ? null : citation,
    sourceUrl: item.sourceUrl,
    withheld: entry.withheld,
    caseId: match.caseId,
    matchStatus: match.status,
    matchCandidates: match.count,
    amendedFrom: null,
    backfilled: historical,
  };
}

function amendedFrom(entry: OrdersEntryWrite, previous: readonly StoredOrdersEntryRef[]): string | null {
  const sameDocket = previous.filter((row) => row.docketNumber === entry.docketNumber && row.sourceRecordId !== entry.sourceRecordId);
  if (sameDocket.length === 1) return sameDocket[0]!.sourceRecordId;
  const sameKind = sameDocket.filter((row) => row.kind === entry.kind);
  return sameKind.length === 1 ? sameKind[0]!.sourceRecordId : null;
}

function listBody(
  item: OfficialOrdersItem,
  termYear: number,
  contentHash: string,
  parseStatus: OrdersParseStatus,
  historical: boolean,
  lastModified: string | null,
  entries: readonly OrdersEntryWrite[],
): OrdersListWrite {
  return {
    sourceUrl: item.sourceUrl,
    termYear,
    postedOn: item.postedOn,
    label: item.label,
    contentHash,
    parseStatus,
    backfilled: historical,
    lastModified,
    entryCount: entries.length,
    withheldCount: entries.filter((entry) => entry.withheld).length,
  };
}

function applyWritesLocally(stored: readonly StoredOrdersList[], writes: readonly OrdersWrite[], termYear: number): StoredOrdersList[] {
  void termYear;
  const next = stored.map((row) => ({ ...row }));
  for (const write of writes) {
    if (write.action === "touch") continue;
    if (write.action === "supersede") {
      for (const row of next) {
        if (row.sourceUrl === write.list.sourceUrl && !row.superseded) row.superseded = true;
      }
    }
    if (write.action === "update_pending") {
      const pending = next.find((row) => row.sourceUrl === write.list.sourceUrl && row.parseStatus === "pending" && !row.superseded);
      if (pending) {
        pending.contentHash = write.list.contentHash;
        pending.parseStatus = write.list.parseStatus;
        pending.postedOn = write.list.postedOn;
        pending.lastModified = write.list.lastModified;
        continue;
      }
    }
    next.push({
      sourceUrl: write.list.sourceUrl,
      contentHash: write.list.contentHash,
      postedOn: write.list.postedOn,
      label: write.list.label,
      parseStatus: write.list.parseStatus,
      superseded: false,
      lastModified: write.list.lastModified,
    });
  }
  return next;
}

function currentStored(stored: readonly StoredOrdersList[], sourceUrl: string): StoredOrdersList | null {
  return stored.find((row) => row.sourceUrl === sourceUrl && !row.superseded) ?? null;
}

function isParsed(stored: readonly StoredOrdersList[], sourceUrl: string): boolean {
  return currentStored(stored, sourceUrl)?.parseStatus === "parsed";
}

function ordersTermWindow(docket: string): number[] | null {
  const year = /^(\d{2})[AM-]/.exec(docket);
  if (!year?.[1]) return null;
  const yy = Number(year[1]);
  const full = yy >= 70 ? 1900 + yy : 2000 + yy;
  return [full - 1, full, full + 1];
}

function officialPdfUrl(href: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(href.replaceAll("&amp;", "&"), base.startsWith("http") ? base : `${ORDERS_ORIGIN}${base}`);
  } catch {
    return null;
  }
  if (url.origin !== ORDERS_ORIGIN || !url.pathname.toLowerCase().endsWith(".pdf")) return null;
  return url.toString();
}

function textOf(value: string): string {
  return collapse(value.replace(/<[^>]+>/g, " ").replaceAll("&amp;", "&").replaceAll("&nbsp;", " "));
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

function dedupeItems(items: OfficialOrdersItem[]): OfficialOrdersItem[] {
  const seen = new Map<string, OfficialOrdersItem>();
  for (const item of items) seen.set(item.sourceUrl, item);
  return [...seen.values()];
}

function matchSection(line: string): { kind: OrdersKind; title: string } | null {
  const normalized = collapse(line);
  return SECTION_HEADERS.find((section) => section.test.test(normalized)) ?? null;
}

function writingStart(line: string): boolean {
  return /^Statement of\b/i.test(line) || /^Justice\s+[A-Z].+,\s*dissenting\b/i.test(line);
}

function authorFromLine(line: string): string | null {
  const statement = /^Statement of Justice\s+([A-Z][A-Za-z'’.\-]+)/i.exec(line);
  if (statement?.[1]) return statement[1];
  const dissent = /^Justice\s+([A-Z][A-Za-z'’.\-]+),\s*dissenting/i.exec(line);
  return dissent?.[1] ?? null;
}

function skipLine(line: string): boolean {
  return /^\(ORDER LIST:/i.test(line) || /^(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),/i.test(line) || /^\d{1,3}$/.test(line);
}

function daysBetween(earlier: string, later: string): number {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return LIVE_WINDOW_DAYS + 1;
  return Math.round((end - start) / 86_400_000);
}
