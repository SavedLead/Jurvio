/**
 * Official Supreme Court orders lists (supremecourt.gov "Order List" PDFs).
 *
 * The docket JSON feed and the emergency-application checker stay as they are.
 * This module only reads the orders index and the order-list PDFs it links.
 * Miscellaneous orders on the same page are not orders lists and are ignored.
 *
 * A successful run is not the same thing as complete coverage. Coverage means
 * every orders-list link currently on the official index for the monitored
 * term has stored text. It is not a claim that every Court order is in Jurvio.
 */
import { createHash } from "node:crypto";
import { isRestrictedDocketText } from "../../domain/federal-stream";

export const ORDERS_LIST_PARSER_VERSION = "scotus-orders-list-v1";

/**
 * Subscriber mail for this feed stays off until a later reviewed change.
 * Historical backfill is a second, independent gate and stays off even if
 * this flag is turned on.
 */
export const ORDERS_LIST_NOTIFICATIONS_ENABLED = false;

export const ORDERS_LIST_COVERAGE_NOTE =
  "This check covers orders-list links on the official Supreme Court orders index for one term. A successful run means that index was read and the lists this run could store were stored. It does not mean every order, opinion, or docket is covered, and it is not instant.";

export const ORDERS_INDEX_ORIGIN = "https://www.supremecourt.gov/orders/ordersofthecourt";

/** Same extra words the emergency docket withholds. Do not loosen this list. */
const ORDERS_LIST_RESTRICTED =
  /\b(seal|seals|sealed|sealing|unseal|unsealed|under seal|ex parte|in camera|grand jury|juvenile|restricted|suppressed|redacted)\b/i;

const SECTION_HEADING =
  /^(CERTIORARI\s*(?:--|—|–)\s*SUMMARY\s+DISPOSITIONS?|ORDERS\s+IN\s+PENDING\s+CASES|CERTIORARI\s+GRANTED|CERTIORARI\s+DENIED|HABEAS\s+CORPUS\s+DENIED|MANDAMUS\s+DENIED|PROHIBITION\s+DENIED|REHEARINGS?\s+DENIED|ATTORNEY\s+DISCIPLINE)$/i;

const DOCKET_LINE = /^(\d{2}(?:-\d{1,5}|A\d{1,4}|M\d{1,4}|O\d{1,4}))\s+(\S.*)$/;

const WEEKDAY_DATE =
  /^(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),?\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/i;

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export type OrdersAction =
  | "cert_denied"
  | "cert_granted"
  | "cert_dismissed"
  | "summary_disposition"
  | "merits_decision"
  | "procedural_order"
  | "habeas_denied"
  | "mandamus_denied"
  | "rehearing_denied"
  | "separate_writing"
  | "unclassified";

export type WritingKind = "dissent" | "statement" | "concurrence" | "would_grant" | "recusal" | "other";

export interface SeparateWriting {
  kind: WritingKind;
  exactText: string;
}

export interface OrdersIndexLink {
  listDate: string;
  sourceUrl: string;
  label: string;
  /** The Court labeled the link revised, or the file name is a numbered replacement. */
  amendedHint: boolean;
  position: number;
}

export interface OrdersListEntryDraft {
  ordinal: number;
  sectionHeading: string;
  docketNumber: string | null;
  caption: string | null;
  action: OrdersAction;
  exactText: string;
  separateWritings: SeparateWriting[];
  plainHeadline: string;
  plainDetail: string;
  uncertainty: string | null;
  withheld: boolean;
  textHash: string;
}

export interface OrdersListParse {
  printedDate: string | null;
  dateMismatch: boolean;
  entries: OrdersListEntryDraft[];
  withheldEntries: number;
}

export interface PlainOrdersLine {
  headline: string;
  detail: string;
  uncertainty: string | null;
}

/** October Term year: the calendar year of the October in which the term begins. */
export function octoberTermYear(now: Date): number {
  return now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

export function ordersIndexUrl(termYear: number): string {
  const yy = String(termYear % 100).padStart(2, "0");
  return `${ORDERS_INDEX_ORIGIN}/${yy}`;
}

/** Strict sealed/restricted check. A matching entry is counted and not stored. */
export function ordersListTextWithheld(text: string): boolean {
  return isRestrictedDocketText(text) || ORDERS_LIST_RESTRICTED.test(text);
}

export function canonicalDocketNumber(value: string): string | null {
  const cleaned = value.trim().replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, "").toUpperCase();
  if (!/^\d{2}(?:-\d{1,5}|A\d{1,4}|M\d{1,4}|O\d{1,4})$/.test(cleaned)) return null;
  return cleaned;
}

export function ordersEntryTextHash(parts: { docketNumber: string | null; action: string; exactText: string; writings: string[] }): string {
  return createHash("sha256")
    .update(`${parts.docketNumber ?? ""}\n${parts.action}\n${parts.exactText}\n${parts.writings.join("\n")}`)
    .digest("hex");
}

export function ordersEntryKey(entry: { docketNumber: string | null; action: string; textHash: string }): string {
  return `${entry.docketNumber ?? ""}|${entry.action}|${entry.textHash}`;
}

function collapse(lines: string[]): string {
  return lines.map((line) => line.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function indexListDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const yy = Number(match[3]);
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  return isoDate(year, Number(match[1]), Number(match[2]));
}

function absoluteOrdersUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href.replace(/&amp;/g, "&"), "https://www.supremecourt.gov");
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "www.supremecourt.gov") return null;
  if (!url.pathname.startsWith("/orders/courtorders/") || !url.pathname.toLowerCase().endsWith(".pdf")) return null;
  url.hash = "";
  url.search = "";
  return url.toString();
}

/** Order List links only. Miscellaneous orders on the same index are left out. */
export function parseOrdersIndex(html: string): OrdersIndexLink[] {
  const links: OrdersIndexLink[] = [];
  const seen = new Set<string>();
  const blocks = html.matchAll(/<div style="display:block">([\s\S]*?)<\/div>/gi);
  for (const block of blocks) {
    const body = block[1] ?? "";
    const date = body.match(/>(\d{2}\/\d{2}\/\d{2})\s*(?:&nbsp;)?</);
    const anchor = body.match(/<a\b[^>]*href=['"]([^'"]+)['"][^>]*>([^<]*)<\/a>/i);
    if (!date?.[1] || !anchor?.[1] || !anchor[2]) continue;
    const label = anchor[2].replace(/\s+/g, " ").trim();
    if (!/^order list\b/i.test(label)) continue;
    const listDate = indexListDate(date[1]);
    const sourceUrl = absoluteOrdersUrl(anchor[1]);
    if (!listDate || !sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const file = sourceUrl.split("/").pop() ?? "";
    links.push({
      listDate,
      sourceUrl,
      label,
      amendedHint: /revised|amended|corrected/i.test(label) || /zor\d/i.test(file),
      position: links.length,
    });
  }
  return links;
}

function sectionAction(heading: string): OrdersAction {
  const normalized = heading.toUpperCase().replace(/\s+/g, " ").replace(/\s*(?:--|—|–)\s*/g, " ");
  if (normalized.includes("SUMMARY")) return "summary_disposition";
  if (normalized === "CERTIORARI GRANTED") return "cert_granted";
  if (normalized === "CERTIORARI DENIED") return "cert_denied";
  if (normalized.startsWith("HABEAS")) return "habeas_denied";
  if (normalized.startsWith("MANDAMUS") || normalized.startsWith("PROHIBITION")) return "mandamus_denied";
  if (normalized.startsWith("REHEARING")) return "rehearing_denied";
  if (normalized.startsWith("ORDERS IN PENDING")) return "procedural_order";
  return "unclassified";
}

function writingKind(text: string): WritingKind {
  if (/\bwould grant the petition\b/i.test(text)) return "would_grant";
  if (/\btook no part\b/i.test(text)) return "recusal";
  if (/\bdissent/i.test(text)) return "dissent";
  if (/\bconcurr/i.test(text)) return "concurrence";
  if (/\bstatement of\b/i.test(text)) return "statement";
  return "other";
}

function writingsIn(text: string): SeparateWriting[] {
  if (!text) return [];
  const pattern = /Justice\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}\s+would\s+grant\s+the\s+petition\s+for\s+a\s+writ\s+of\s+certiorari\.?|Justice\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}\s+took\s+no\s+part\b(?:[^.]|\.(?!\s))*\.|Justice\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4},\s+dissenting\b(?:[^.]|\.(?!\s))*\.|Justice\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4},\s+concurring\b(?:[^.]|\.(?!\s))*\.|Statement\s+of\s+(?:Justice\s+)?[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4}\s+respecting\b(?:[^.]|\.(?!\s))*\./gi;
  return [...text.matchAll(pattern)].map((match) => ({ kind: writingKind(match[0]), exactText: match[0].replace(/\s+/g, " ").trim() }));
}

const PETITION_DENIED = /\bpetitions?\s+for\s+(?:a\s+writ|writs)\s+of\s+certiorari\s+(?:is|are)\s+denied\b/i;
const PETITION_DISMISSED = /\bpetitions?\s+for\s+(?:a\s+writ|writs)\s+of\s+certiorari\s+(?:is|are)\s+dismissed\b/i;
const PETITION_GRANTED = /\bpetitions?\s+for\s+(?:a\s+writ|writs)\s+of\s+certiorari\s+(?:is|are)\s+granted\b/i;
const JUDGMENT_DISPOSITION = /\bjudgments?\s+(?:is|are)\s+(?:vacated|reversed|affirmed)\b/i;
const EQUALLY_DIVIDED = /\bequally\s+divided\s+Court\b/i;
const DIG = /\bimprovidently\s+granted\b/i;
const REHEARING_DENIED = /\bpetitions?\s+for\s+rehearing\s+(?:is|are)\s+denied\b/i;

function actionFromBody(section: OrdersAction, body: string): OrdersAction | null {
  if (!body) return null;
  if (DIG.test(body)) return "merits_decision";
  if (EQUALLY_DIVIDED.test(body)) return "merits_decision";
  if (PETITION_GRANTED.test(body) && (JUDGMENT_DISPOSITION.test(body) || section === "summary_disposition")) return "summary_disposition";
  if (PETITION_GRANTED.test(body)) return "cert_granted";
  if (PETITION_DISMISSED.test(body)) return "cert_dismissed";
  if (PETITION_DENIED.test(body)) return "cert_denied";
  if (REHEARING_DENIED.test(body)) return "rehearing_denied";
  if (JUDGMENT_DISPOSITION.test(body)) return section === "summary_disposition" ? "summary_disposition" : "merits_decision";
  return null;
}

export function ordersListPlainEnglish(input: {
  action: OrdersAction;
  sectionHeading: string;
  body: string;
  writings: SeparateWriting[];
  conflict: boolean;
}): PlainOrdersLine {
  const writingNote = input.writings.length
    ? " A justice wrote separately about this order. That writing is not the Court's ruling."
    : "";
  const conflict = input.conflict
    ? `The heading is "${input.sectionHeading}". Jurvio followed the entry's own text and kept the heading unchanged.`
    : null;
  switch (input.action) {
    case "cert_denied":
      return {
        headline: "The Supreme Court denied review.",
        detail: `The Court turned down the request to hear this case. That is not a decision on who was right.${writingNote}`,
        uncertainty: conflict,
      };
    case "cert_granted":
      return {
        headline: "The Supreme Court agreed to hear this case.",
        detail: `The Court granted review. It has not decided who wins.${writingNote}`,
        uncertainty: conflict,
      };
    case "cert_dismissed":
      return {
        headline: "The Supreme Court dismissed the petition.",
        detail: `The Court dismissed the request to hear the case. That is not a ruling on who was right in the lower court.${writingNote}`,
        uncertainty: conflict,
      };
    case "summary_disposition": {
      const known = PETITION_GRANTED.test(input.body) && JUDGMENT_DISPOSITION.test(input.body);
      return {
        headline: "The Supreme Court acted without full briefing and argument.",
        detail: known
          ? `The order grants review and disposes of the lower court's judgment in the same step. This is a summary action, not a full opinion deciding the case.${writingNote}`
          : `This entry is in the Court's summary-disposition section. This is not a full opinion deciding the case.${writingNote}`,
        uncertainty: conflict ?? (known ? null : "The official text is not a standard grant, vacate, and remand. It is shown unchanged, and the effect should be read from that text."),
      };
    }
    case "merits_decision": {
      const equally = EQUALLY_DIVIDED.test(input.body);
      const dig = DIG.test(input.body);
      const detail = equally
        ? "The Court affirmed the judgment because the justices divided evenly. There is no opinion explaining a majority's reasons."
        : dig
          ? "The Court dismissed the case without deciding the question it had agreed to review."
          : "The order list states a judgment in the case.";
      return {
        headline: "The Supreme Court decided the case.",
        detail: `${detail}${writingNote}`,
        uncertainty: conflict ?? "This is the result stated on the order list. The list may not include the Court's full reasons.",
      };
    }
    case "procedural_order": {
      const stay = /\bapplication\b/i.test(input.body) && /\bstay\b/i.test(input.body) && /\bdenied\b/i.test(input.body);
      return {
        headline: stay ? "The Supreme Court denied a request for a stay." : "The Supreme Court entered an order in a pending case.",
        detail: stay
          ? "The Court denied a stay. This is not a decision on a petition for review, and it is not a decision on who wins the case."
          : "This order does not, by itself, show that the Court denied review or decided who wins.",
        uncertainty: conflict ?? (input.body ? null : "The order list names the case and does not include a sentence explaining the order."),
      };
    }
    case "habeas_denied":
      return {
        headline: "The Supreme Court denied a habeas corpus petition.",
        detail: `The Court denied habeas corpus. That is not a decision on the merits of a granted case.${writingNote}`,
        uncertainty: conflict,
      };
    case "mandamus_denied":
      return {
        headline: "The Supreme Court denied a request for an extraordinary writ.",
        detail: `The Court denied mandamus or prohibition. That is not a decision on who wins an underlying case.${writingNote}`,
        uncertainty: conflict,
      };
    case "rehearing_denied":
      return {
        headline: "The Supreme Court denied rehearing.",
        detail: `The Court refused to rehear an earlier order. This entry does not itself decide a new merits question.${writingNote}`,
        uncertainty: conflict,
      };
    case "separate_writing":
      return {
        headline: "A justice wrote separately about an order.",
        detail: "The writing accompanies an order. It is not itself the Court's ruling.",
        uncertainty: conflict ?? "Jurvio kept the writing with the docket number printed on it and did not match it by the case name.",
      };
    default:
      return {
        headline: "An orders-list entry names this case.",
        detail: "Jurvio cannot tell from the official text whether the Court denied review, agreed to hear the case, or decided it.",
        uncertainty: "The official text is unchanged. The entry is not labeled as a denial, a grant, or a merits decision.",
      };
  }
}

function isOpinionBoundary(line: string): boolean {
  const text = line.trim();
  return /^Cite as:/i.test(text)
    || text === "SUPREME COURT OF THE UNITED STATES"
    || /^Statement of [A-Z][A-Z.'-]+, J\.?$/.test(text);
}

function printedDate(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const match = WEEKDAY_DATE.exec(raw.trim());
    if (!match?.[1] || !match[2] || !match[3]) continue;
    const month = MONTHS[match[1].toLowerCase()];
    if (!month) continue;
    return isoDate(Number(match[3]), month, Number(match[2]));
  }
  return null;
}

function skipListLine(line: string): boolean {
  const text = line.trim();
  if (!text) return true;
  if (/^\d{1,3}$/.test(text)) return true;
  if (/^\(ORDER LIST:/i.test(text)) return true;
  if (WEEKDAY_DATE.test(text)) return true;
  return false;
}

interface OpenDocket {
  docketNumber: string;
  caption: string;
}

function finishEntry(input: {
  ordinal: number;
  sectionHeading: string;
  section: OrdersAction;
  docketNumber: string | null;
  caption: string | null;
  body: string;
  extraWritings?: SeparateWriting[];
}): OrdersListEntryDraft {
  const writings = [...writingsIn(input.body), ...(input.extraWritings ?? [])];
  const bodyAction = input.body ? actionFromBody(input.section, input.body) : null;
  const action = bodyAction ?? input.section;
  const conflict = Boolean(bodyAction && bodyAction !== input.section);
  const withheld = [input.caption ?? "", input.body, ...writings.map((writing) => writing.exactText)]
    .some((text) => text && ordersListTextWithheld(text));
  const plain = ordersListPlainEnglish({
    action: withheld ? "unclassified" : action,
    sectionHeading: input.sectionHeading,
    body: withheld ? "" : input.body,
    writings: withheld ? [] : writings,
    conflict: withheld ? false : conflict,
  });
  const exactText = withheld ? "" : (input.body || [input.docketNumber, input.caption].filter(Boolean).join(" "));
  const storedWritings = withheld ? [] : writings;
  return {
    ordinal: input.ordinal,
    sectionHeading: withheld ? "" : input.sectionHeading,
    docketNumber: input.docketNumber,
    caption: withheld ? null : input.caption,
    action: withheld ? "unclassified" : action,
    exactText,
    separateWritings: storedWritings,
    plainHeadline: withheld ? "Withheld" : plain.headline,
    plainDetail: withheld
      ? "This orders-list entry matched the sealed or restricted filter and was not stored."
      : plain.detail,
    uncertainty: withheld ? null : plain.uncertainty,
    withheld,
    textHash: withheld
      ? ordersEntryTextHash({ docketNumber: input.docketNumber, action: "withheld", exactText: `withheld:${input.ordinal}`, writings: [] })
      : ordersEntryTextHash({ docketNumber: input.docketNumber, action, exactText, writings: storedWritings.map((writing) => writing.exactText) }),
  };
}

function opinionDockets(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\bNos?\.?\s+((?:\d{2}[\u2010-\u2015-]\d{1,5}[A-Z]?)(?:\s*(?:,|and)\s*\d{2}[\u2010-\u2015-]\d{1,5}[A-Z]?)*)/gi)) {
    const chunk = match[1] ?? "";
    for (const part of chunk.split(/,|and/i)) {
      const docket = canonicalDocketNumber(part);
      if (docket) found.add(docket);
    }
  }
  return [...found];
}

function parseListEntries(listText: string): OrdersListEntryDraft[] {
  const entries: OrdersListEntryDraft[] = [];
  let sectionHeading = "";
  let section: OrdersAction = "unclassified";
  let group: OpenDocket[] = [];
  let body: string[] = [];

  const flush = () => {
    if (!group.length) return;
    const text = collapse(body);
    // A singular order belongs to the docket directly above it. A plural order
    // ("petitions ... are granted") belongs to every docket in the open group.
    // Attaching one justice's note to every earlier bare denial would be a guess.
    const shared = group.length === 1 || /\b(petitions|judgments|motions|applications|cases|writs)\b/i.test(text) && /\b(are|were)\b/i.test(text);
    group.forEach((item, index) => {
      const ownBody = shared || index === group.length - 1 ? text : "";
      const withheldBody = Boolean(ownBody && ordersListTextWithheld(ownBody)) || ordersListTextWithheld(item.caption);
      entries.push(finishEntry({
        ordinal: entries.length + 1,
        sectionHeading,
        section,
        docketNumber: item.docketNumber,
        caption: item.caption,
        body: withheldBody ? `${item.caption} ${ownBody}` : ownBody,
      }));
    });
    group = [];
    body = [];
  };

  for (const raw of listText.split(/\r?\n/)) {
    const line = raw.replace(/\f/g, "");
    if (isOpinionBoundary(line)) {
      flush();
      break;
    }
    if (skipListLine(line)) continue;
    const trimmed = line.trim();
    if (SECTION_HEADING.test(trimmed)) {
      flush();
      sectionHeading = trimmed.replace(/\s+/g, " ").toUpperCase();
      section = sectionAction(sectionHeading);
      continue;
    }
    const docket = DOCKET_LINE.exec(trimmed);
    const caption = docket?.[2]?.trim() ?? "";
    const captionIsName = Boolean(docket) && !/^the\b/i.test(caption) && (caption.match(/[a-z]/g)?.length ?? 0) < 3;
    if (docket?.[1] && captionIsName) {
      const number = canonicalDocketNumber(docket[1]);
      if (!number) continue;
      if (body.length) flush();
      group.push({ docketNumber: number, caption });
      continue;
    }
    if (group.length) body.push(trimmed);
  }
  flush();
  return entries;
}

function attachOpinions(entries: OrdersListEntryDraft[], opinionText: string): OrdersListEntryDraft[] {
  const marker = opinionText.indexOf("SUPREME COURT OF THE UNITED STATES");
  if (marker < 0) return entries;
  const opinions = opinionText.slice(marker).split(/(?=SUPREME COURT OF THE UNITED STATES)/).filter((part) => part.includes("SUPREME COURT OF THE UNITED STATES"));
  const next = [...entries];
  for (const opinion of opinions) {
    const text = collapse(opinion.split(/\r?\n/));
    const dockets = opinionDockets(text);
    const writing: SeparateWriting = { kind: writingKind(text), exactText: text };
    if (!dockets.length) {
      next.push(finishEntry({
        ordinal: next.length + 1,
        sectionHeading: "SEPARATE WRITING",
        section: "separate_writing",
        docketNumber: null,
        caption: null,
        body: "",
        extraWritings: ordersListTextWithheld(text) ? [{ kind: "other", exactText: text }] : [writing],
      }));
      const added = next[next.length - 1]!;
      if (ordersListTextWithheld(text)) {
        added.withheld = true;
        added.exactText = "";
        added.separateWritings = [];
        added.caption = null;
        added.plainHeadline = "Withheld";
        added.plainDetail = "This orders-list entry matched the sealed or restricted filter and was not stored.";
        added.uncertainty = null;
        added.action = "unclassified";
      }
      continue;
    }
    for (const docket of dockets) {
      const host = next.find((entry) => entry.docketNumber === docket && !entry.withheld);
      if (ordersListTextWithheld(text)) {
        if (host) {
          host.withheld = true;
          host.exactText = "";
          host.caption = null;
          host.separateWritings = [];
          host.sectionHeading = "";
          host.plainHeadline = "Withheld";
          host.plainDetail = "This orders-list entry matched the sealed or restricted filter and was not stored.";
          host.uncertainty = null;
          host.action = "unclassified";
          host.textHash = ordersEntryTextHash({ docketNumber: docket, action: "withheld", exactText: `withheld:${host.ordinal}`, writings: [] });
        } else {
          next.push(finishEntry({
            ordinal: next.length + 1,
            sectionHeading: "",
            section: "unclassified",
            docketNumber: docket,
            caption: "sealed",
            body: text,
          }));
        }
        continue;
      }
      if (host) {
        host.separateWritings = [...host.separateWritings, writing];
        const plain = ordersListPlainEnglish({
          action: host.action,
          sectionHeading: host.sectionHeading,
          body: host.exactText,
          writings: host.separateWritings,
          conflict: Boolean(host.uncertainty && host.uncertainty.includes("heading")),
        });
        host.plainHeadline = plain.headline;
        host.plainDetail = plain.detail;
        host.uncertainty = plain.uncertainty ?? host.uncertainty;
        host.textHash = ordersEntryTextHash({
          docketNumber: host.docketNumber,
          action: host.action,
          exactText: host.exactText,
          writings: host.separateWritings.map((item) => item.exactText),
        });
        continue;
      }
      const action = actionFromBody("separate_writing", text) ?? "separate_writing";
      next.push(finishEntry({
        ordinal: next.length + 1,
        sectionHeading: "SEPARATE WRITING",
        section: action,
        docketNumber: docket,
        caption: null,
        body: action === "separate_writing" ? "" : text,
        extraWritings: [writing],
      }));
    }
  }
  return next.map((entry, index) => ({ ...entry, ordinal: index + 1 }));
}

export function parseOrdersListText(text: string, indexDate: string): OrdersListParse {
  const printedDateValue = printedDate(text);
  const entries = attachOpinions(parseListEntries(text), text);
  return {
    printedDate: printedDateValue,
    dateMismatch: Boolean(printedDateValue && printedDateValue !== indexDate),
    entries,
    withheldEntries: entries.filter((entry) => entry.withheld).length,
  };
}

export type LinkStatus = "linked" | "unlinked" | "ambiguous" | "withheld";

/** Link only when one existing SCOTUS case has this docket. Never guess from a caption. */
export function linkOrdersListEntry(caseIds: readonly string[]): { status: LinkStatus; caseId: string | null } {
  const unique = [...new Set(caseIds.filter(Boolean))];
  if (unique.length === 1) return { status: "linked", caseId: unique[0]! };
  if (unique.length === 0) return { status: "unlinked", caseId: null };
  return { status: "ambiguous", caseId: null };
}

export function shouldNotifyOrdersListEntry(input: {
  backfilled: boolean;
  withheld: boolean;
  superseded: boolean;
  duplicateOfExisting: boolean;
  linkStatus: LinkStatus;
  notificationsEnabled: boolean;
}): boolean {
  if (!input.notificationsEnabled) return false;
  if (input.backfilled || input.withheld || input.superseded || input.duplicateOfExisting) return false;
  if (input.linkStatus !== "linked") return false;
  return true;
}

export interface StoredOrdersList {
  sourceUrl: string;
  contentHash: string;
  listDate: string;
  extractionStatus: "ok" | "failed";
  backfilled: boolean;
  superseded: boolean;
  entryKeys: string[];
  withheldEntries: number;
  unlinkedEntries: number;
  ambiguousEntries: number;
}

export function revisionForIncoming(input: {
  sourceUrl: string;
  contentHash: string;
  listDate: string;
  stored: readonly StoredOrdersList[];
}): { action: "duplicate" | "store"; supersedeUrls: string[] } {
  const sameFile = input.stored.find((row) => row.sourceUrl === input.sourceUrl && row.contentHash === input.contentHash);
  if (sameFile) return { action: "duplicate", supersedeUrls: [] };
  const priorSameUrl = input.stored.filter((row) => row.sourceUrl === input.sourceUrl && !row.superseded).map((row) => row.sourceUrl);
  const priorSameDate = input.stored
    .filter((row) => row.listDate === input.listDate && row.sourceUrl !== input.sourceUrl && !row.superseded)
    .map((row) => row.sourceUrl);
  return { action: "store", supersedeUrls: [...new Set([...priorSameUrl, ...priorSameDate])] };
}

export interface FetchPlanItem {
  link: OrdersIndexLink;
  reason: "recheck" | "new" | "retry";
}

export function planOrdersListFetches(input: {
  links: readonly OrdersIndexLink[];
  stored: readonly StoredOrdersList[];
  maxPdfs: number;
}): FetchPlanItem[] {
  const ok = new Set(input.stored.filter((row) => row.extractionStatus === "ok").map((row) => row.sourceUrl));
  const failed = new Set(input.stored.filter((row) => row.extractionStatus === "failed").map((row) => row.sourceUrl));
  const pending = input.links
    .filter((link) => !ok.has(link.sourceUrl))
    .sort((left, right) => right.listDate.localeCompare(left.listDate) || left.position - right.position);
  const planned: FetchPlanItem[] = pending.map((link) => ({ link, reason: failed.has(link.sourceUrl) ? "retry" : "new" }));
  const newestStored = input.stored
    .filter((row) => row.extractionStatus === "ok" && !row.superseded)
    .sort((left, right) => right.listDate.localeCompare(left.listDate))[0];
  if (newestStored && !planned.some((item) => item.link.sourceUrl === newestStored.sourceUrl)) {
    const link = input.links.find((item) => item.sourceUrl === newestStored.sourceUrl);
    if (link) planned.unshift({ link, reason: "recheck" });
  }
  return planned.slice(0, Math.max(0, input.maxPdfs));
}

export type OrdersRunStatus = "succeeded" | "partial" | "failed" | "rate_limited" | "paused";
export type OrdersCompleteness = "complete_for_indexed_lists" | "incomplete";

export interface OrdersListCoverage {
  runStatus: OrdersRunStatus;
  completeness: OrdersCompleteness;
  indexedLists: number;
  storedLists: number;
  storedWithText: number;
  pendingLists: number;
  failedLists: number;
  withheldEntries: number;
  unlinkedEntries: number;
  ambiguousEntries: number;
  newestIndexedOn: string | null;
  newestStoredOn: string | null;
  backfillRemaining: number;
  rateLimitUntil: string | null;
  note: string;
}

export function assessOrdersListCoverage(input: {
  runStatus: OrdersRunStatus;
  links: readonly { sourceUrl: string; listDate: string }[];
  stored: readonly StoredOrdersList[];
  rateLimitUntil?: string | null;
  dateMismatch?: boolean;
}): OrdersListCoverage {
  const indexed = new Map(input.links.map((link) => [link.sourceUrl, link.listDate]));
  const current = input.stored.filter((row) => indexed.has(row.sourceUrl));
  const okUrls = new Set(current.filter((row) => row.extractionStatus === "ok").map((row) => row.sourceUrl));
  const failed = current.filter((row) => row.extractionStatus === "failed" && !okUrls.has(row.sourceUrl));
  const pending = [...indexed.keys()].filter((url) => !okUrls.has(url));
  const active = current.filter((row) => !row.superseded && row.extractionStatus === "ok");
  const newestIndexedOn = input.links.map((link) => link.listDate).sort().at(-1) ?? null;
  const newestStoredOn = [...okUrls].map((url) => indexed.get(url)!).sort().at(-1) ?? null;
  const complete = input.runStatus === "succeeded" && pending.length === 0 && failed.length === 0;
  const mismatch = input.dateMismatch
    ? " At least one list's printed date differs from the index date; both are kept."
    : "";
  return {
    runStatus: input.runStatus,
    completeness: complete ? "complete_for_indexed_lists" : "incomplete",
    indexedLists: input.links.length,
    storedLists: current.length,
    storedWithText: okUrls.size,
    pendingLists: pending.length,
    failedLists: failed.length,
    withheldEntries: active.reduce((sum, row) => sum + row.withheldEntries, 0),
    unlinkedEntries: active.reduce((sum, row) => sum + row.unlinkedEntries, 0),
    ambiguousEntries: active.reduce((sum, row) => sum + row.ambiguousEntries, 0),
    newestIndexedOn,
    newestStoredOn,
    backfillRemaining: pending.length,
    rateLimitUntil: input.rateLimitUntil ?? null,
    note: `${ORDERS_LIST_COVERAGE_NOTE}${mismatch}`,
  };
}
