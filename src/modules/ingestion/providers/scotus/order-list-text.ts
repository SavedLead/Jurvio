/**
 * Parse pdftotext output of an official order list. Cert denials stay cert
 * denials; a grant that vacates or remands is a merits disposition. Inline
 * justice writings are separate items. Sealed or restricted lines are counted
 * and dropped, not stored.
 */
import { createHash } from "node:crypto";
import { isRestrictedDocketText } from "../../domain/federal-stream";

export const ORDER_LIST_PARSER_VERSION = "scotus-order-list-v1";

export type OrderDisposition =
  | "cert_denied"
  | "cert_granted"
  | "merits_disposition"
  | "application_order"
  | "other";

export type OrderWritingKind = "would_grant" | "dissent" | "statement" | "recusal" | "separate_opinion";

export interface OrderListWriting {
  kind: OrderWritingKind;
  text: string;
}

export interface ParsedOrderListItem {
  sourceItemId: string;
  docketNumber: string;
  caption: string | null;
  section: string;
  itemKind: "disposition" | "separate_writing";
  disposition: OrderDisposition | null;
  writingKind: OrderWritingKind | null;
  /** Court's words for this item. Null when the section heading is the only signal. */
  body: string | null;
  withheld: boolean;
}

export interface ParsedOrderList {
  items: ParsedOrderListItem[];
  withheld: number;
}

const DOCKET_LINE = /^(\d{2}(?:-\d+|[AOM]\d+))$/i;
const SECTION_LINE = /^(CERTIORARI -- SUMMARY DISPOSITIONS?|CERTIORARI DENIED|CERTIORARI GRANTED|ORDERS IN PENDING CASES)$/i;

function normalize(text: string): string[] {
  return text
    .replaceAll("\\(", "(")
    .replaceAll("\\)", ")")
    .replaceAll(/\u0000/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && !/^\\\d+$/.test(line) && !/^\d+$/.test(line));
}

function classifyBody(body: string): OrderDisposition {
  const granted = /petition for a writ of certiorari is granted/i.test(body);
  const denied = /petitions? for (?:a )?writs? of certiorari(?: before judgment)? (?:is|are) denied/i.test(body);
  const merits = /judgment is (?:vacated|reversed|affirmed|remanded)/i.test(body)
    || /case is remanded/i.test(body);
  if (granted && merits) return "merits_disposition";
  if (merits && /judgment is affirmed/i.test(body)) return "merits_disposition";
  if (denied && !merits) return "cert_denied";
  if (granted) return "cert_granted";
  if (/^The application\b/i.test(body)) return "application_order";
  if (merits) return "merits_disposition";
  return "other";
}

function sectionDisposition(section: string): OrderDisposition | null {
  if (/CERTIORARI DENIED/i.test(section)) return "cert_denied";
  if (/CERTIORARI GRANTED/i.test(section)) return "cert_granted";
  if (/SUMMARY DISPOSITION/i.test(section)) return "merits_disposition";
  return null;
}

function splitWritings(body: string): { order: string; writings: OrderListWriting[] } {
  const writings: OrderListWriting[] = [];
  const patterns: Array<{ kind: OrderWritingKind; re: RegExp }> = [
    { kind: "would_grant", re: /Justice [A-Z][A-Za-z.'’ -]+ would grant the petition for a writ of certiorari\./g },
    { kind: "dissent", re: /Justice [A-Z][A-Za-z.'’ ,-]+dissenting from the denial of certiorari\./g },
    { kind: "statement", re: /Statement of Justice [A-Z][A-Za-z.'’ ,-]+(?:respecting|concurring)[^.]+\./g },
    { kind: "recusal", re: /Justice [A-Z][A-Za-z.'’ ,-]+ took no part in the consideration or decision of this (?:petition|case|motion)\./g },
  ];
  let order = body;
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern.re)) {
      if (match[0]) writings.push({ kind: pattern.kind, text: match[0].trim() });
    }
    order = order.replace(pattern.re, " ");
  }
  return { order: order.replace(/\s+/g, " ").trim(), writings };
}

interface RawBlock {
  section: string;
  docketNumber: string;
  caption: string;
  body: string;
}

function blocksFromLines(lines: string[]): RawBlock[] {
  const blocks: RawBlock[] = [];
  let section = "PREAMBLE";
  let current: RawBlock | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  for (const line of lines) {
    if (SECTION_LINE.test(line)) {
      flush();
      section = line;
      continue;
    }
    const docket = DOCKET_LINE.exec(line);
    if (docket?.[1]) {
      flush();
      current = { section, docketNumber: docket[1].toUpperCase(), caption: "", body: "" };
      continue;
    }
    if (!current) continue;
    if (/^(The |Because )/i.test(line) || current.body) current.body = `${current.body} ${line}`.trim();
    else current.caption = current.caption ? `${current.caption} ${line}` : line;
  }
  flush();
  return blocks;
}

function itemId(docketNumber: string, kind: string, ordinal: number): string {
  return `${docketNumber}:${kind}:${ordinal}`;
}

export function parseOrderListText(text: string): ParsedOrderList {
  const blocks = blocksFromLines(normalize(text));
  const items: ParsedOrderListItem[] = [];
  let withheld = 0;
  const pending: RawBlock[] = [];

  const emit = (block: RawBlock, body: string | null, fromSection: boolean) => {
    const combined = `${block.caption} ${body ?? ""}`;
    if (isRestrictedDocketText(combined)) {
      withheld += 1;
      return;
    }
    const split = body ? splitWritings(body) : { order: "", writings: [] as OrderListWriting[] };
    const disposition = split.order ? classifyBody(split.order) : (fromSection ? sectionDisposition(block.section) : "other");
    const orderBody = split.order || null;
    items.push({
      sourceItemId: itemId(block.docketNumber, "disposition", 0),
      docketNumber: block.docketNumber,
      caption: block.caption || null,
      section: block.section,
      itemKind: "disposition",
      disposition,
      writingKind: null,
      body: orderBody,
      withheld: false,
    });
    split.writings.forEach((writing, index) => {
      if (isRestrictedDocketText(writing.text)) {
        withheld += 1;
        return;
      }
      items.push({
        sourceItemId: itemId(block.docketNumber, "separate_writing", index),
        docketNumber: block.docketNumber,
        caption: block.caption || null,
        section: block.section,
        itemKind: "separate_writing",
        disposition: null,
        writingKind: writing.kind,
        body: writing.text,
        withheld: false,
      });
    });
  };

  for (const block of blocks) {
    if (!block.body) {
      pending.push(block);
      continue;
    }
    if (/petitions for writs of certiorari are denied/i.test(block.body)) {
      const group = [...pending, block];
      pending.length = 0;
      for (const member of group) emit(member, block.body, false);
      continue;
    }
    emit(block, block.body, false);
  }
  for (const block of pending) emit(block, null, true);
  return { items: items.filter((item) => !item.withheld), withheld };
}

export function orderListContentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
