import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import https from "node:https";
import http, { type ClientRequest } from "node:http";
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

// How many consecutive reconnection attempts that make NO forward progress are
// tolerated before giving up. The budget is reset to this value whenever a
// connection delivers at least one new byte, so a long run that drops and resumes
// many times (each time making progress) can continue indefinitely; only a stream
// that is genuinely wedged -- this many reconnects in a row with zero bytes -- fails.
const BULK_STREAM_MAX_STALLED_RECONNECTS = 20;

// Stream a multi-GB `.bz2` bulk file straight from S3, decompressing through
// `bzip2 -dc` without ever landing the file on disk: the HTTP response bytes are
// fed into bzip2's stdin and the decompressed CSV comes out of stdout.
//
// RESILIENCE: a single HTTP connection held open for a multi-hour federal pass is
// routinely aborted by S3 / the network ("aborted" / ECONNRESET) long before the
// multi-GB body finishes. Rather than lose the whole pass, we track how many
// compressed bytes have been handed to bzip2 and, on any mid-stream drop, reconnect
// with a `Range: bytes=<received>-` request and keep feeding the SAME decompressor.
// bzip2 consumes one continuous compressed byte stream and is indifferent to HTTP
// connection boundaries, so its decode state is preserved across reconnects and the
// output is identical to an uninterrupted download. (http:// is honored too, for
// tests; production uses https://.)
export function openBulkCsvFromUrl(url: string): BulkCsvSource {
  const decompressor: ChildProcessWithoutNullStreams = spawn("bzip2", ["-dc"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let standardError = "";
  let transportError: string | null = null;
  let closedByConsumer = false;
  let stdinSettled = false;
  let activeRequest: ClientRequest | undefined;
  let received = 0; // compressed bytes already written to bzip2 stdin
  let total: number | null = null; // full compressed length, once a response reveals it
  let reconnectsLeft = BULK_STREAM_MAX_STALLED_RECONNECTS;

  decompressor.stderr.setEncoding("utf8");
  decompressor.stderr.on("data", (chunk: string) => {
    standardError += chunk;
  });

  // Error terminal: record the first error and tear down the decompressor so
  // `completion` rejects with it.
  const fail = (message: string) => {
    if (transportError === null) transportError = message;
    if (!stdinSettled) {
      stdinSettled = true;
      decompressor.stdin.destroy();
    }
  };
  // Success terminal: the full body has been delivered; flush and close stdin so
  // bzip2 finishes cleanly.
  const finish = () => {
    if (!stdinSettled) {
      stdinSettled = true;
      decompressor.stdin.end();
    }
  };

  // bzip2's stdin is a Socket, and a write that races the decoder going away -- the
  // teardown after close()/limit, a decode error, or the OS killing bzip2 under
  // memory pressure -- completes asynchronously with EPIPE. Node treats an
  // unhandled stream 'error' as fatal and crashes the whole process (this is what
  // sank the first throughput run), so we MUST listen. During teardown the write
  // races are expected and harmless (ignore); otherwise the decoder is gone and
  // this feed cannot continue, so record it as a transport failure rather than
  // crash. We never resume on a stdin error: a dead bzip2 can't be revived by
  // reconnecting the HTTP source.
  decompressor.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (closedByConsumer || stdinSettled) return;
    fail(`bzip2 stdin ${error.code ?? "stream"} error for ${url}: ${error.message}`);
  });

  const scheduleResume = (reason: string): void => {
    if (closedByConsumer || stdinSettled) return;
    if (total === null || reconnectsLeft <= 0) {
      fail(
        `${reason}; cannot resume (received=${received}, total=${total ?? "unknown"}, ` +
          `reconnectsLeft=${reconnectsLeft})`,
      );
      return;
    }
    reconnectsLeft -= 1;
    const backoffMs = Math.min(8000, 500 * (BULK_STREAM_MAX_STALLED_RECONNECTS - reconnectsLeft));
    setTimeout(() => {
      if (!closedByConsumer && !stdinSettled) connect(url, 5);
    }, backoffMs);
  };

  const connect = (target: string, redirectsLeft: number): void => {
    if (closedByConsumer || stdinSettled) return;
    let connectionSettled = false; // at most one terminal action per connection
    const client = target.startsWith("http:") ? http : https;
    const headers: Record<string, string> = {};
    if (received > 0) headers.Range = `bytes=${received}-`;

    activeRequest = client.get(target, { headers }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (BULK_URL_REDIRECT_CODES.has(status) && location && redirectsLeft > 0) {
        connectionSettled = true; // handed off to the redirect target
        response.resume();
        connect(new URL(location, target).toString(), redirectsLeft - 1);
        return;
      }
      // We asked to resume from an offset but the server ignored Range and is
      // replaying from byte 0: we cannot splice that into the in-flight decoder.
      if (received > 0 && status === 200) {
        connectionSettled = true;
        response.resume();
        fail(`server ignored Range (HTTP 200) resuming ${target} at byte ${received}`);
        return;
      }
      if (status !== 200 && status !== 206) {
        connectionSettled = true;
        response.resume();
        fail(`HTTP ${status} ${response.statusMessage ?? ""} for ${target}`.trim());
        return;
      }
      if (total === null) {
        if (status === 200) {
          const length = Number(response.headers["content-length"]);
          if (Number.isFinite(length) && length > 0) total = length;
        } else {
          // 206: Content-Range is "bytes <start>-<end>/<total>".
          const contentRange = response.headers["content-range"];
          const match = contentRange ? /\/(\d+)\s*$/.exec(contentRange) : null;
          if (match) total = Number(match[1]);
        }
      }

      let progressed = false;
      response.on("data", (chunk: Buffer) => {
        if (closedByConsumer || stdinSettled) return;
        received += chunk.length;
        if (!progressed) {
          progressed = true;
          reconnectsLeft = BULK_STREAM_MAX_STALLED_RECONNECTS; // forward progress resets the budget
        }
        if (!decompressor.stdin.write(chunk)) {
          response.pause();
          decompressor.stdin.once("drain", () => {
            if (!closedByConsumer && !stdinSettled) response.resume();
          });
        }
      });
      response.on("end", () => {
        if (connectionSettled) return;
        connectionSettled = true;
        if (closedByConsumer || stdinSettled) return;
        if (total !== null && received < total) {
          scheduleResume(`stream ended early at ${received}/${total} for ${target}`);
        } else {
          finish();
        }
      });
      const onBroken = (reason: string) => {
        if (connectionSettled) return;
        connectionSettled = true;
        scheduleResume(reason);
      };
      response.on("aborted", () =>
        onBroken(`HTTP stream aborted for ${target} at ${received}/${total ?? "unknown"}`),
      );
      response.on("error", (error) =>
        onBroken(`HTTP stream error for ${target}: ${error.message}`),
      );
    });
    activeRequest.on("error", (error) => {
      if (connectionSettled) return;
      connectionSettled = true;
      scheduleResume(`HTTP request error for ${target}: ${error.message}`);
    });
  };

  connect(url, 5);

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
