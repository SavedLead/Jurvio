import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import https from "node:https";
import type { ClientRequest } from "node:http";
import { z } from "zod";
import { bulkCsvProcessCompleted, parseBulkCsv, type BulkCsvSource } from "./bulk";

// CourtListener bulk-data schemas for the FREE public opinion export
// (com-courtlistener-storage S3 bucket; no account, no API key, no rate limit).
// We declare only the columns we consume and .passthrough() the rest, so a change
// to CourtListener's column set never breaks the parser.

const nullableBulkString = z.string().transform((value) => (value === "" ? null : value));
const bulkBoolean = z
  .string()
  .transform((value) => value === "t" || value === "true" || value === "1");

// search_opinioncluster
export const courtListenerBulkOpinionClusterSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
    docket_id: z.string().regex(/^\d+$/),
    case_name: z.string().optional().default(""),
    case_name_short: z.string().optional().default(""),
    case_name_full: z.string().optional().default(""),
    date_filed: nullableBulkString.optional(),
    precedential_status: z.string().optional().default(""),
    citation_count: z.string().optional().default("0"),
    judges: z.string().optional().default(""),
    syllabus: z.string().optional().default(""),
    procedural_history: z.string().optional().default(""),
    nature_of_suit: z.string().optional().default(""),
    date_modified: z.string().optional().default(""),
  })
  .passthrough();

export type CourtListenerBulkOpinionCluster = z.infer<
  typeof courtListenerBulkOpinionClusterSchema
>;

// search_opinion
export const courtListenerBulkOpinionSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
    cluster_id: z.string().regex(/^\d+$/),
    type: z.string().optional().default(""),
    author_str: z.string().optional().default(""),
    per_curiam: bulkBoolean.optional(),
    download_url: z.string().optional().default(""),
    sha1: z.string().optional().default(""),
    page_count: nullableBulkString.optional(),
    extracted_by_ocr: bulkBoolean.optional(),
    // Text columns, richest first; the ingester picks the first non-empty one.
    html_with_citations: z.string().optional().default(""),
    html_columbia: z.string().optional().default(""),
    html_lawbox: z.string().optional().default(""),
    html: z.string().optional().default(""),
    xml_harvard: z.string().optional().default(""),
    plain_text: z.string().optional().default(""),
    date_modified: z.string().optional().default(""),
  })
  .passthrough();

export type CourtListenerBulkOpinion = z.infer<typeof courtListenerBulkOpinionSchema>;

// CourtListener's opinion "type" values → our opinion_type enum.
export function normalizeBulkOpinionType(type: string): string {
  switch (type) {
    case "010combined":
    case "020lead":
      return "majority";
    case "015unamimous": // CourtListener's historical spelling
    case "025plurality":
      return "plurality";
    case "030concurrence":
    case "035concurrenceinpart":
      return "concurrence";
    case "040dissent":
      return "dissent";
    case "050addendum":
      return "addendum";
    case "060remittitur":
      return "remittitur";
    case "070rehearing":
      return "rehearing";
    case "080onthemerits":
    case "090onmotiontostrike":
      return "majority";
    default:
      return "majority";
  }
}

// Strip HTML to plain text when only an HTML column is populated.
export function bulkOpinionPlainText(opinion: CourtListenerBulkOpinion): {
  text: string;
  html: string | null;
  method: string;
} {
  if (opinion.plain_text.trim()) {
    return { text: opinion.plain_text, html: null, method: opinion.extracted_by_ocr ? "courtlistener_bulk_ocr" : "courtlistener_bulk_text" };
  }
  const html =
    opinion.html_with_citations ||
    opinion.html_columbia ||
    opinion.html_lawbox ||
    opinion.html ||
    opinion.xml_harvard ||
    "";
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { text, html: html || null, method: "courtlistener_bulk_html" };
}

export function bulkOpinionWordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function bulkClusterSourceUri(snapshotDate: string, clusterId: string): string {
  return `https://www.courtlistener.com/help/api/bulk-data/#opinion-cluster-${snapshotDate}-${clusterId}`;
}

export function bulkOpinionSourceUri(snapshotDate: string, opinionId: string): string {
  return `https://www.courtlistener.com/help/api/bulk-data/#opinion-${snapshotDate}-${opinionId}`;
}

export function bulkContentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
