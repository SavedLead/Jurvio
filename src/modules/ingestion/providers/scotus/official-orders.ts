/**
 * Official Supreme Court orders index (supremecourt.gov/orders/ordersofthecourt/YY).
 * Parses the public HTML only. PDF bytes are fetched separately and hashed from
 * those bytes; this module never invents a checksum or a retrieval time.
 */
import { createHash } from "node:crypto";

const OFFICIAL_ORIGIN = "https://www.supremecourt.gov";
const MAX_INDEX_BYTES = 2 * 1024 * 1024;

export type OfficialOrderKind = "order_list" | "miscellaneous" | "other";

export interface OfficialOrderIndexEntry {
  sourceRecordId: string;
  termYear: string;
  listDate: string;
  label: string;
  kind: OfficialOrderKind;
  /** True when the Court's own label says the list was amended. A second PDF the same day is a separate row either way. */
  amended: boolean;
  sourceUrl: string;
  /** SHA-256 of the index HTML entry text we actually parsed, not of the PDF. */
  indexEntryHash: string;
}

export interface RetrievedOfficialOrderIndex {
  sourceUri: string;
  contentHash: string;
  retrievedAt: string;
  entries: OfficialOrderIndexEntry[];
}

export interface RelatingToOrdersOpinion {
  termYear: string;
  listDate: string;
  docketNumber: string;
  caseName: string;
  sourceUrl: string;
  /** A later revised PDF, kept beside the original rather than replacing it. */
  revision: { listDate: string; sourceUrl: string } | null;
}

function decodeHtml(value: string) {
  return value.replaceAll(/<br\s*\/?>/gi, " ").replaceAll(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&").replaceAll("&nbsp;", " ").replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"').replaceAll(/\s+/g, " ").trim();
}

function officialPdfUrl(href: string): string {
  const url = new URL(href.replaceAll("&amp;", "&"), OFFICIAL_ORIGIN);
  if (url.origin !== OFFICIAL_ORIGIN || !url.pathname.toLowerCase().endsWith(".pdf")) {
    throw new Error("Orders link is not an official Supreme Court PDF");
  }
  return url.toString();
}

/** M/D/YY as used on the orders index. Two-digit years 00–69 map to 2000–2069. */
export function parseOfficialOrderDate(value: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value.trim());
  if (!match) throw new Error(`Unsupported Supreme Court order date: ${value}`);
  const year = match[3]!.length === 2 ? `${Number(match[3]) >= 70 ? "19" : "20"}${match[3]}` : match[3]!;
  return `${year}-${match[1]!.padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
}

export function officialOrderKind(label: string): OfficialOrderKind {
  const normalized = label.trim().toLowerCase();
  if (normalized.startsWith("order list")) return "order_list";
  if (normalized.startsWith("miscellaneous order")) return "miscellaneous";
  return "other";
}

export function parseOfficialOrdersIndex(html: string, termYear: string, sourceUri: string): OfficialOrderIndexEntry[] {
  if (!/^\d{2}$/.test(termYear)) throw new Error("Supreme Court term must be a two-digit year");
  const entries: OfficialOrderIndexEntry[] = [];
  const pattern = /<span style="display:inline-block;">(\d{2}\/\d{2}\/\d{2})\s*&nbsp;<\/span>\s*<span style="display:inline-block;"><a href='([^']+\.pdf)'[^>]*>([^<]+)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const listDate = parseOfficialOrderDate(match[1] ?? "");
    const sourceUrl = officialPdfUrl(match[2] ?? "");
    const label = decodeHtml(match[3] ?? "");
    const filename = new URL(sourceUrl).pathname.split("/").pop() ?? sourceUrl;
    const sourceRecordId = `${termYear}:${filename}`;
    const indexEntryHash = createHash("sha256").update(`${sourceUri}\n${listDate}\n${label}\n${sourceUrl}`).digest("hex");
    entries.push({
      sourceRecordId,
      termYear,
      listDate,
      label,
      kind: officialOrderKind(label),
      amended: /\bamended\b/i.test(label),
      sourceUrl,
      indexEntryHash,
    });
  }
  return entries;
}

/**
 * Opinions relating to orders. A revision link is a second official PDF.
 * The original URL stays on the row.
 */
export function parseRelatingToOrdersIndex(html: string, termYear: string): RelatingToOrdersOpinion[] {
  if (!/^\d{2}$/.test(termYear)) throw new Error("Supreme Court term must be a two-digit year");
  const opinions: RelatingToOrdersOpinion[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = row[1] ?? "";
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1] ?? "");
    if (cells.length < 3) continue;
    const listDate = decodeHtml(cells[0] ?? "");
    if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(listDate)) continue;
    const docketNumber = decodeHtml(cells[1] ?? "").replaceAll("–", "-").replaceAll("—", "-");
    const nameCell = cells[2] ?? "";
    const main = /href\s*=\s*['"]([^'"]+\.pdf)['"][^>]*>([^<]*)</i.exec(nameCell);
    if (!main?.[1] || !docketNumber) continue;
    const revisionHref = /Revisions[\s\S]*?href\s*=\s*['"]([^'"]+\.pdf)['"][^>]*>\s*([^<]+)/i.exec(nameCell);
    opinions.push({
      termYear,
      listDate: parseOfficialOrderDate(listDate),
      docketNumber,
      caseName: decodeHtml(main[2] ?? ""),
      sourceUrl: officialPdfUrl(main[1]),
      revision: revisionHref?.[1]
        ? { listDate: parseOfficialOrderDate(decodeHtml(revisionHref[2] ?? "")), sourceUrl: officialPdfUrl(revisionHref[1]) }
        : null,
    });
  }
  return opinions;
}

export async function fetchOfficialOrdersIndex(termYear: string, fetchImpl: typeof fetch = fetch): Promise<RetrievedOfficialOrderIndex> {
  if (!/^\d{2}$/.test(termYear)) throw new Error("Supreme Court term must be a two-digit year");
  const sourceUri = `${OFFICIAL_ORIGIN}/orders/ordersofthecourt/${termYear}`;
  const response = await fetchImpl(sourceUri, { headers: { "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1" }, redirect: "error" });
  if (!response.ok) throw new Error(`Supreme Court orders index returned HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_INDEX_BYTES) throw new Error(`Official orders index exceeds ${MAX_INDEX_BYTES} byte cap`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_INDEX_BYTES) throw new Error(`Official orders index exceeds ${MAX_INDEX_BYTES} byte cap`);
  const html = new TextDecoder().decode(bytes);
  return {
    sourceUri,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    retrievedAt: new Date().toISOString(),
    entries: parseOfficialOrdersIndex(html, termYear, sourceUri),
  };
}
