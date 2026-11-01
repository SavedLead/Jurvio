/**
 * Live-feed opinion text (ADR 0090, plan D11; migration 0174).
 *
 * discoverLiveOpinionText queues opinions the live feeds recorded without text:
 *   court_site  free_source_item(source='court_site'): item_key is the PDF URL
 *   coa_feed    docket_entry 'coa-feed:*' rows: the description ends with the URL
 *   govinfo     govinfo_crosscheck district packages: granule PDF from GovInfo
 * processLiveOpinionText fetches each PDF politely (one request per host every
 * few seconds, identifying User-Agent, size cap), extracts text with pdftotext,
 * falls back to tesseract OCR for scanned PDFs when allowed, stores the PDF in
 * the artifact store and the text as a DRAFT judicial_opinion document +
 * document_content (the existing citation triggers queue it for parsing).
 * Nothing here publishes. Sealed/restricted captions are never queued or stored.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { captionAllowsFollow } from "@/modules/accounts/application/follows";
import { officialOpinionTextToHtml } from "@/modules/publication/application/extract-official-scotus-opinion-text";
import { ocrPdf } from "@/modules/publication/application/ocr-pdf";
import { CIRCUIT_CODES } from "@/modules/operations/domain/court-sources";
import type { ArtifactStore } from "../application/artifact-store";
import { isRestrictedDocketText } from "../domain/federal-stream";
import { GOVINFO_API } from "../providers/govinfo/uscourts";

type Sql = ReturnType<typeof postgres>;
const execFileAsync = promisify(execFile);

export const LIVE_TEXT_SOURCES = ["court_site", "coa_feed", "govinfo"] as const;
export type LiveTextSource = (typeof LIVE_TEXT_SOURCES)[number];
const MAX_PDF_BYTES = 40 * 1024 * 1024;
const MIN_WORDS = 120;
const MAX_ATTEMPTS = 5;

/** URL at the end of a "…: https://…" docket entry description (coa feeds). */
export function trailingUrl(description: string): string | null {
  const match = /(https?:\/\/[^\s<>"]+)\s*$/.exec(description);
  return match ? match[1]! : null;
}

export function countWords(text: string): number {
  return (text.match(/[A-Za-z]{2,}/g) ?? []).length;
}

/** Normalize pdftotext/OCR output: drop form feeds and trailing spaces, collapse blank runs. */
export function normalizeExtractedText(text: string): string {
  return text.replace(/\r/g, "").replace(/\f/g, "\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Text is usable when it has enough words per page (scanned PDFs yield almost none). */
export function textLooksNative(text: string, pages: number): boolean {
  const words = countWords(text);
  return words >= MIN_WORDS && words / Math.max(1, pages) >= 40;
}

export interface DiscoverResult { court_site: number; coa_feed: number; govinfo: number }

/**
 * Queue opinions seen since each source's watermark (first run: `backfillDays`).
 * Candidates on sealed/restricted captions or dockets are skipped.
 */
export async function discoverLiveOpinionText(sql: Sql, options: { backfillDays?: number; limit?: number; now?: Date; rescanDays?: number } = {}): Promise<DiscoverResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 5000;
  const initial = new Date(now.getTime() - (options.backfillDays ?? 3) * 86_400_000);
  const result: DiscoverResult = { court_site: 0, coa_feed: 0, govinfo: 0 };
  // rescanDays (builder backfill) re-reads a window regardless of the watermark; the
  // watermark only ever moves forward, and ON CONFLICT keeps rescans idempotent.
  const rescan = options.rescanDays ? new Date(now.getTime() - options.rescanDays * 86_400_000) : null;
  const since = async (source: LiveTextSource) => {
    if (rescan) return rescan;
    const [row] = await sql<{ at: Date }[]>`SELECT discovered_through AS at FROM live_opinion_text_watermark WHERE source = ${source}`;
    return row?.at ?? initial;
  };
  const advance = async (source: LiveTextSource, through: Date | null) => {
    if (!through) return;
    await sql`INSERT INTO live_opinion_text_watermark (source, discovered_through) VALUES (${source}, ${through})
      ON CONFLICT (source) DO UPDATE SET discovered_through = GREATEST(live_opinion_text_watermark.discovered_through, EXCLUDED.discovered_through), updated_at = now()`;
  };
  const circuits = [...CIRCUIT_CODES] as string[];

  type Candidate = { source_key: string; case_id: string; docket_entry_id: string | null; court_code: string;
    document_url: string; filed_on: string | null; seen_at: Date; caption: string; docket_number: string };
  const enqueue = async (source: LiveTextSource, rows: Candidate[]) => {
    const keep = rows.filter((row) => captionAllowsFollow(row.caption, row.docket_number) && !isRestrictedDocketText(row.caption));
    if (keep.length) {
      const inserted = await sql`INSERT INTO live_opinion_text (source, source_key, case_id, docket_entry_id, court_code, document_url, filed_on)
        SELECT ${source}, * FROM unnest(${keep.map((r) => r.source_key)}::text[], ${keep.map((r) => r.case_id)}::uuid[],
          ${keep.map((r) => r.docket_entry_id) as string[]}::uuid[], ${keep.map((r) => r.court_code)}::text[],
          ${keep.map((r) => r.document_url)}::text[], ${keep.map((r) => r.filed_on) as string[]}::date[])
        ON CONFLICT (source, source_key) DO NOTHING RETURNING 1`;
      result[source] += inserted.length;
    }
    // Only advance past what we read; a full page means more remain at the same watermark.
    const newest = rows.reduce<Date | null>((max, row) => (!max || row.seen_at > max ? row.seen_at : max), null);
    await advance(source, rows.length >= limit && newest ? new Date(newest.getTime() - 1) : newest);
  };

  const siteSince = await since("court_site");
  await enqueue("court_site", await sql<Candidate[]>`
    SELECT f.item_key AS source_key, f.case_id, NULL::uuid AS docket_entry_id, f.court_code, f.item_key AS document_url,
      f.issued_on::text AS filed_on, f.seen_at, c.caption, c.docket_number
    FROM free_source_item f JOIN legal_case c ON c.id = f.case_id
    WHERE f.source = 'court_site' AND f.outcome IN ('matched', 'entry', 'new_case') AND f.seen_at > ${siteSince}
      AND f.item_key ~* '^https?://'
    ORDER BY f.seen_at LIMIT ${limit}`);

  const coaSince = await since("coa_feed");
  await enqueue("coa_feed", (await sql<(Candidate & { description: string })[]>`
    SELECT e.provider_entry_id AS source_key, e.case_id, e.id AS docket_entry_id,
      split_part(e.provider_entry_id, ':', 2) AS court_code, '' AS document_url, e.filed_on::text AS filed_on,
      e.created_at AS seen_at, e.description, c.caption, c.docket_number
    FROM docket_entry e JOIN legal_case c ON c.id = e.case_id
    WHERE e.provider_entry_id LIKE 'coa-feed:%' AND e.created_at > ${coaSince}
    ORDER BY e.created_at LIMIT ${limit}`)
    .map((row) => ({ ...row, document_url: trailingUrl(row.description) ?? "" }))
    .filter((row) => row.document_url));

  const govSince = await since("govinfo");
  await enqueue("govinfo", await sql<Candidate[]>`
    SELECT g.package_id || ':' || g.date_issued AS source_key, g.case_id, e.id AS docket_entry_id, g.court_code,
      'govinfo:' || g.package_id AS document_url, g.date_issued::text AS filed_on, g.seen_at, c.caption, c.docket_number
    FROM govinfo_crosscheck g JOIN legal_case c ON c.id = g.case_id
    LEFT JOIN docket_entry e ON e.case_id = g.case_id AND e.provider_entry_id = 'govinfo:' || g.package_id || ':' || g.date_issued
    WHERE g.outcome IN ('matched', 'entry', 'new_case') AND g.seen_at > ${govSince}
      AND NOT (lower(g.court_code) = ANY(${circuits}::text[]))
    ORDER BY g.seen_at LIMIT ${limit}`);
  return result;
}

/** Spaces requests to each host by at least `minIntervalMs`. */
export class HostPacer {
  private readonly last = new Map<string, number>();
  constructor(private readonly minIntervalMs: number, private readonly sleep: (ms: number) => Promise<void>, private readonly now: () => number = Date.now) {}
  async wait(url: string) {
    const host = new URL(url).host;
    const previous = this.last.get(host);
    if (previous !== undefined) {
      const remaining = previous + this.minIntervalMs - this.now();
      if (remaining > 0) await this.sleep(remaining);
    }
    this.last.set(host, this.now());
  }
}

export interface LiveTextOptions {
  store: ArtifactStore;
  limit: number;
  deadline: number;
  userAgent: string;
  govinfoApiKey?: string;
  allowOcr: boolean;
  ocrMaxPages?: number;
  minHostIntervalMs?: number;
  states?: readonly ("pending" | "ocr_required")[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Test seam: PDF -> { text, pages, method }. Defaults to pdftotext then OCR. */
  extract?: (pdf: Uint8Array, allowOcr: boolean) => Promise<{ text: string; pages: number; method: string } | null>;
}

export interface LiveTextResult {
  claimed: number;
  extracted: number;
  ocrRequired: number;
  duplicate: number;
  skipped: number;
  failed: number;
  retried: number;
  words: number;
  bySource: Record<string, number>;
}

async function pdfPages(file: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("pdfinfo", [file], { encoding: "utf8", timeout: 30_000 });
    return Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 1) || 1;
  } catch {
    return 1;
  }
}

export async function extractPdfText(pdf: Uint8Array, allowOcr: boolean, ocrMaxPages = 40) {
  const directory = await mkdtemp(path.join(tmpdir(), "jurvio-live-text-"));
  try {
    const file = path.join(directory, "opinion.pdf");
    await writeFile(file, pdf);
    const pages = await pdfPages(file);
    const { stdout } = await execFileAsync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
    const native = normalizeExtractedText(stdout);
    if (textLooksNative(native, pages)) return { text: native, pages, method: "native_pdf_text" };
    if (!allowOcr) return null;
    const ocr = normalizeExtractedText(await ocrPdf(file, { maxPages: ocrMaxPages }));
    return countWords(ocr) >= MIN_WORDS ? { text: ocr, pages, method: "ocr_tesseract" } : null;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

type Claimed = { id: string; source: LiveTextSource; source_key: string; case_id: string; docket_entry_id: string | null;
  court_code: string; document_url: string; filed_on: string | null; attempts: number; caption: string; docket_number: string };

/** Fetch, extract and store queued opinions until `limit` or the deadline. */
export async function processLiveOpinionText(sql: Sql, options: LiveTextOptions): Promise<LiveTextResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const fetchImpl = options.fetchImpl ?? fetch;
  const pacer = new HostPacer(options.minHostIntervalMs ?? 3_000, sleep, now);
  const extract = options.extract ?? ((pdf: Uint8Array, allowOcr: boolean) => extractPdfText(pdf, allowOcr, options.ocrMaxPages));
  const states = options.states ?? ["pending"];
  const result: LiveTextResult = { claimed: 0, extracted: 0, ocrRequired: 0, duplicate: 0, skipped: 0, failed: 0, retried: 0, words: 0, bySource: {} };
  const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'official_cmecf'`;
  if (!provider) throw new Error("Provider seed official_cmecf is missing");

  const get = async (url: string, accept: string, headers: Record<string, string> = {}) => {
    await pacer.wait(url);
    const response = await fetchImpl(url, { headers: { "User-Agent": options.userAgent, Accept: accept, ...headers },
      redirect: "follow", signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for ${new URL(url).host}`), { status: response.status });
    return response;
  };
  const govinfoPdfUrl = async (row: Claimed): Promise<string | null> => {
    if (!options.govinfoApiKey) throw new Error("GOVINFO_API_KEY is not configured");
    const packageId = row.document_url.slice("govinfo:".length);
    const headers = { "X-Api-Key": options.govinfoApiKey };
    const list = await (await get(`${GOVINFO_API}/packages/${encodeURIComponent(packageId)}/granules?offsetMark=*&pageSize=100`, "application/json", headers))
      .json() as { granules?: { granuleId?: string }[] };
    const granules = (list.granules ?? []).map((g) => g.granuleId).filter((id): id is string => Boolean(id));
    // Newest granules last; check from the end for the one issued on this date.
    for (const granuleId of granules.reverse().slice(0, 6)) {
      const summary = await (await get(`${GOVINFO_API}/packages/${encodeURIComponent(packageId)}/granules/${encodeURIComponent(granuleId)}/summary`,
        "application/json", headers)).json() as { dateIssued?: string };
      if (!row.filed_on || summary.dateIssued === row.filed_on) {
        return `https://www.govinfo.gov/content/pkg/${encodeURIComponent(packageId)}/pdf/${encodeURIComponent(granuleId)}.pdf`;
      }
    }
    return null;
  };
  const finish = async (row: Claimed, state: string, extra: { error?: string; documentId?: string; method?: string; words?: number } = {}) => {
    await sql`UPDATE live_opinion_text SET state = ${state}, last_error = ${extra.error ?? null},
      document_id = COALESCE(${extra.documentId ?? null}::uuid, document_id), extraction_method = COALESCE(${extra.method ?? null}, extraction_method),
      word_count = COALESCE(${extra.words ?? null}::int, word_count), extracted_at = CASE WHEN ${state} = 'extracted' THEN now() ELSE extracted_at END
      WHERE id = ${row.id}`;
  };

  while (result.claimed < options.limit && now() < options.deadline) {
    // Claim one row at a time (lease: push next_attempt_at out) so a crash never strands work.
    const [row] = await sql<Claimed[]>`
      WITH next AS (
        SELECT q.id FROM live_opinion_text q
        WHERE q.state = ANY(${states as string[]}::text[]) AND q.next_attempt_at <= now()
        ORDER BY q.filed_on DESC NULLS LAST, q.id DESC LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      UPDATE live_opinion_text q SET next_attempt_at = now() + interval '30 minutes', attempts = q.attempts + 1
      FROM next, legal_case c WHERE q.id = next.id AND c.id = q.case_id
      RETURNING q.id::text, q.source, q.source_key, q.case_id, q.docket_entry_id, q.court_code, q.document_url,
        q.filed_on::text, q.attempts, c.caption, c.docket_number`;
    if (!row) break;
    result.claimed += 1;
    result.bySource[row.source] = (result.bySource[row.source] ?? 0) + 1;
    try {
      if (!captionAllowsFollow(row.caption, row.docket_number) || isRestrictedDocketText(row.caption)) {
        result.skipped += 1; await finish(row, "skipped", { error: "restricted caption" }); continue;
      }
      // Another source already gave this case an opinion with text around this date.
      const [existing] = await sql<{ id: string }[]>`
        SELECT d.id FROM document d JOIN document_content dc ON dc.document_id = d.id
        WHERE d.case_id = ${row.case_id} AND dc.word_count >= ${MIN_WORDS}
          AND (${row.filed_on}::date IS NULL OR d.filed_on BETWEEN ${row.filed_on}::date - 1 AND ${row.filed_on}::date + 1)
        LIMIT 1`;
      if (existing) { result.duplicate += 1; await finish(row, "duplicate", { documentId: existing.id }); continue; }
      const url = row.source === "govinfo" ? await govinfoPdfUrl(row) : row.document_url;
      if (!url || !/^https?:\/\//i.test(url)) { result.skipped += 1; await finish(row, "skipped", { error: "no PDF link" }); continue; }
      const response = await get(url, "application/pdf,*/*;q=0.5");
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_PDF_BYTES) { result.skipped += 1; await finish(row, "skipped", { error: `PDF too large (${declared} bytes)` }); continue; }
      const pdf = new Uint8Array(await response.arrayBuffer());
      if (pdf.byteLength > MAX_PDF_BYTES) { result.skipped += 1; await finish(row, "skipped", { error: "PDF too large" }); continue; }
      if (Buffer.from(pdf.subarray(0, 5)).toString("latin1") !== "%PDF-") {
        result.skipped += 1; await finish(row, "skipped", { error: "not a PDF" }); continue;
      }
      const extracted = await extract(pdf, options.allowOcr);
      if (!extracted) { result.ocrRequired += 1; await finish(row, "ocr_required"); continue; }
      const pdfHash = createHash("sha256").update(pdf).digest("hex");
      const stored = await options.store.putIfAbsent({ key: `live-opinion/${row.court_code.toLowerCase()}/${pdfHash}.pdf`,
        mediaType: "application/pdf", body: pdf, contentHash: pdfHash });
      const contentHash = createHash("sha256").update(extracted.text).digest("hex");
      const words = countWords(extracted.text);
      const documentId = await sql.begin(async (tx) => {
        const [artifact] = await tx<{ id: string }[]>`
          INSERT INTO raw_artifact (provider_id, source_uri, source_record_id, content_hash, object_key, media_type, retrieved_at, response_metadata)
          VALUES (${provider.id}, ${url}, ${`live-text:${row.source}:${row.source_key}`.slice(0, 500)}, ${pdfHash}, ${stored.objectKey},
            'application/pdf', now(), ${tx.json({ source: `live_feed_${row.source}`, courtCode: row.court_code, pages: extracted.pages })})
          ON CONFLICT (provider_id, source_uri, content_hash) DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
          RETURNING id`;
        const [document] = await tx<{ id: string }[]>`
          INSERT INTO document (public_id, case_id, docket_entry_id, document_type, title, filed_on, content_hash,
            source_artifact_id, publication, extraction_confidence)
          VALUES (${createPublicId("document")}, ${row.case_id}, ${row.docket_entry_id}, 'judicial_opinion',
            ${row.source === "govinfo" ? "Opinion (GovInfo)" : "Opinion (court website)"}, ${row.filed_on}, ${contentHash},
            ${artifact!.id}, 'draft', ${extracted.method === "native_pdf_text" ? 0.95 : 0.75})
          RETURNING id`;
        await tx`INSERT INTO document_content (document_id, content_html, content_text, content_hash, extraction_method, word_count, source_artifact_id)
          VALUES (${document!.id}, ${officialOpinionTextToHtml(extracted.text)}, ${extracted.text}, ${contentHash},
            ${extracted.method}, ${words}, ${artifact!.id})`;
        return document!.id;
      });
      result.extracted += 1;
      result.words += words;
      await finish(row, "extracted", { documentId, method: extracted.method, words });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const status = (error as { status?: number }).status;
      if (row.attempts >= MAX_ATTEMPTS || status === 404 || status === 410) {
        result.failed += 1; await finish(row, "failed", { error: message });
      } else {
        result.retried += 1;
        await sql`UPDATE live_opinion_text SET last_error = ${message},
          next_attempt_at = now() + make_interval(mins => ${15 * 2 ** row.attempts}) WHERE id = ${row.id}`;
      }
    }
  }
  return result;
}
