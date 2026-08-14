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

// search_opinioncluster -- declare every column we can consume; .passthrough()
// keeps anything else so the full row can still be saved to provider_metadata.
export const courtListenerBulkOpinionClusterSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
    docket_id: z.string().regex(/^\d+$/),
    case_name: z.string().optional().default(""),
    case_name_short: z.string().optional().default(""),
    case_name_full: z.string().optional().default(""),
    date_filed: nullableBulkString.optional(),
    date_filed_is_approximate: bulkBoolean.optional(),
    precedential_status: z.string().optional().default(""),
    citation_count: z.string().optional().default("0"),
    scdb_id: z.string().optional().default(""),
    scdb_decision_direction: z.string().optional().default(""),
    source: z.string().optional().default(""),
    judges: z.string().optional().default(""),
    attorneys: z.string().optional().default(""),
    posture: z.string().optional().default(""),
    syllabus: z.string().optional().default(""),
    headnotes: z.string().optional().default(""),
    summary: z.string().optional().default(""),
    disposition: z.string().optional().default(""),
    history: z.string().optional().default(""),
    other_dates: z.string().optional().default(""),
    cross_reference: z.string().optional().default(""),
    correction: z.string().optional().default(""),
    procedural_history: z.string().optional().default(""),
    nature_of_suit: z.string().optional().default(""),
    slug: z.string().optional().default(""),
    blocked: bulkBoolean.optional(),
    date_blocked: nullableBulkString.optional(),
    arguments: z.string().optional().default(""),
    headmatter: z.string().optional().default(""),
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
    author_id: nullableBulkString.optional(),
    author_str: z.string().optional().default(""),
    joined_by_str: z.string().optional().default(""),
    per_curiam: bulkBoolean.optional(),
    ordering_key: nullableBulkString.optional(),
    download_url: z.string().optional().default(""),
    local_path: z.string().optional().default(""),
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

// search_citation -- the official reporter citations, one row per (cluster, cite).
export const courtListenerBulkCitationSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
    cluster_id: z.string().regex(/^\d+$/),
    volume: z.string().optional().default(""),
    reporter: z.string().optional().default(""),
    page: z.string().optional().default(""),
    type: z.string().optional().default(""),
  })
  .passthrough();

export type CourtListenerBulkCitation = z.infer<typeof courtListenerBulkCitationSchema>;

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

const BULK_URL_REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

// Stream a multi-GB `.bz2` bulk file straight from S3 over HTTPS, decompressing
// through `bzip2 -dc` without ever landing the file on disk: the http response
// is piped into bzip2's stdin and the decompressed CSV comes out of stdout.
export function openBulkCsvFromUrl(url: string): BulkCsvSource {
  const decompressor: ChildProcessWithoutNullStreams = spawn("bzip2", ["-dc"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let standardError = "";
  let transportError: string | null = null;
  let closedByConsumer = false;
  let activeRequest: ClientRequest | undefined;
  decompressor.stderr.setEncoding("utf8");
  decompressor.stderr.on("data", (chunk: string) => {
    standardError += chunk;
  });

  const fail = (message: string) => {
    if (transportError === null) transportError = message;
    decompressor.stdin.destroy();
  };

  const request = (target: string, redirectsLeft: number): void => {
    activeRequest = https.get(target, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (BULK_URL_REDIRECT_CODES.has(status) && location && redirectsLeft > 0) {
        response.resume();
        request(new URL(location, target).toString(), redirectsLeft - 1);
        return;
      }
      if (status !== 200) {
        response.resume();
        fail(`HTTP ${status} ${response.statusMessage ?? ""} for ${target}`.trim());
        return;
      }
      response.on("error", (error) => fail(`HTTP stream error for ${target}: ${error.message}`));
      response.pipe(decompressor.stdin);
    });
    activeRequest.on("error", (error) => fail(`HTTP request error for ${target}: ${error.message}`));
  };

  request(url, 5);

  return {
    stream: decompressor.stdout,
    close: () => {
      closedByConsumer = true;
      activeRequest?.destroy();
      decompressor.kill("SIGTERM");
    },
    completion: new Promise<void>((resolve, reject) => {
      decompressor.once("error", (error) =>
        reject(new Error(`bzip2 failed to start for ${url}: ${error.message}`)),
      );
      decompressor.once("close", (code) => {
        if (transportError !== null) {
          reject(new Error(transportError));
        } else if (bulkCsvProcessCompleted(code, closedByConsumer)) {
          resolve();
        } else {
          reject(new Error(`bzip2 exited with code ${code}: ${standardError.trim()}`));
        }
      });
    }),
  };
}

export async function* readBulkOpinionClusters(
  source: BulkCsvSource,
): AsyncGenerator<CourtListenerBulkOpinionCluster> {
  try {
    yield* parseBulkCsv(source.stream, courtListenerBulkOpinionClusterSchema);
    await source.completion;
  } finally {
    source.close();
  }
}

export async function* readBulkOpinions(
  source: BulkCsvSource,
): AsyncGenerator<CourtListenerBulkOpinion> {
  try {
    yield* parseBulkCsv(source.stream, courtListenerBulkOpinionSchema);
    await source.completion;
  } finally {
    source.close();
  }
}

export async function* readBulkCitations(
  source: BulkCsvSource,
): AsyncGenerator<CourtListenerBulkCitation> {
  try {
    yield* parseBulkCsv(source.stream, courtListenerBulkCitationSchema);
    await source.completion;
  } finally {
    source.close();
  }
}
