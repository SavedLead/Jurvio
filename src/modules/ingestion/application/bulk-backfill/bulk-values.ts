import { providerScopedDocketNumber } from "../../domain/federal-stream";

const NUL = /\u0000/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * PostgreSQL text cannot hold NUL, and jsonb rejects unpaired UTF-16 surrogates.
 * Both occur in OCR'd and very old opinion text; one bad character would otherwise
 * fail a whole batch. NUL is dropped and lone surrogates become U+FFFD.
 */
export function cleanText(value: string): string {
  let cleaned = value;
  if (cleaned.includes("\u0000")) cleaned = cleaned.replace(NUL, "");
  LONE_SURROGATE.lastIndex = 0;
  if (LONE_SURROGATE.test(cleaned)) {
    LONE_SURROGATE.lastIndex = 0;
    cleaned = cleaned.replace(LONE_SURROGATE, "�");
  }
  return cleaned;
}

export function cleanOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = cleanText(value).trim();
  return cleaned ? cleaned : null;
}

/** Deep-clean every string in a parsed bulk row before it is sent as jsonb. */
export function cleanRecord(record: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    cleaned[key] = typeof value === "string" ? cleanText(value) : value;
  }
  return cleaned;
}

/**
 * A calendar date PostgreSQL will accept, or null. CourtListener carries some
 * impossible dates (e.g. day 0, Feb 30) on very old records; one of those would
 * otherwise abort the batch's `date` cast.
 */
export function bulkDate(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

const BULK_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/;

/** A timestamptz literal PostgreSQL will accept, or null. */
export function bulkTimestamp(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return BULK_TIMESTAMP.test(trimmed) && bulkDate(trimmed) ? trimmed : null;
}

/**
 * The docket number to key a CourtListener docket by. Real court docket numbers
 * are kept as-is. A docket with none (common before the 1900s) gets a
 * provider-scoped key instead of '', because every unnumbered docket in a court
 * would otherwise collapse into one case under the (court, docket_number) key.
 */
export function bulkDocketNumber(docketId: string, docketNumber: string | null | undefined): {
  docketNumber: string;
  providerScoped: boolean;
} {
  const trimmed = cleanText(docketNumber ?? "").trim();
  return trimmed
    ? { docketNumber: trimmed, providerScoped: false }
    : { docketNumber: providerScopedDocketNumber(docketId), providerScoped: true };
}

/**
 * Every rendering CourtListener exports for an opinion's text. The loader keeps
 * one chosen rendering in document_content; the full row stays byte-for-byte in
 * the mirrored snapshot, so provider_metadata records only which renderings
 * existed and their sizes instead of storing the text a second through ninth time.
 */
export const BULK_OPINION_TEXT_COLUMNS = [
  "plain_text",
  "html",
  "html_lawbox",
  "html_columbia",
  "html_anon_2020",
  "xml_harvard",
  "xml_scan",
  "html_with_citations",
] as const;

export function bulkOpinionMetadata(row: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const textColumns: Record<string, number> = {};
  const textColumnSet = new Set<string>(BULK_OPINION_TEXT_COLUMNS);
  for (const [key, value] of Object.entries(row)) {
    if (textColumnSet.has(key)) {
      if (typeof value === "string" && value.length > 0) textColumns[key] = value.length;
      continue;
    }
    metadata[key] = typeof value === "string" ? cleanText(value) : value;
  }
  metadata.text_columns = textColumns;
  return metadata;
}
