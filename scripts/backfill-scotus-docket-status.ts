// Read the Supreme Court's official docket page for each Supreme Court case we
// hold and write one status row per case (cert granted/denied/dismissed, the
// judgment line, party titles) as a COPY-ready TSV. Runs on the builder (not
// on a web host); the workflow loads the TSV into scotus_docket_status.
//
//   tsx scripts/backfill-scotus-docket-status.ts --input cases.tsv \
//     --cache-dir ~/.cache/jurvio/scotus-dockets --out status.tsv \
//     [--delay-ms 1500] [--budget-minutes 300] [--qp-out questions.tsv]
//
// With --qp-out, a granted docket whose page links the Court's "questions
// presented" PDF also gets that PDF fetched (same delay and cache rules),
// converted with pdftotext, and parsed into one scotus_question_presented row.
//
// cases.tsv: case_id <TAB> docket_number, one per line.
// Polite and resumable: one request at a time with a delay (supremecourt.gov
// robots.txt asks for Crawl-delay 1), an identifying User-Agent, every page
// cached on disk gzipped (a re-run fetches only what is missing), a stop after the
// time budget. Missing dockets are cached as such and not retried.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  DOCKET_STATUS_PARSER_VERSION,
  officialDocketPageUrl,
  parseDocketStatus,
} from "@/modules/ingestion/providers/scotus/docket-status";
import {
  parseQuestionsPresented,
  QUESTION_PRESENTED_PARSER_VERSION,
  questionsPresentedUrlFor,
  readQuestionsPresentedUrl,
} from "@/modules/ingestion/providers/scotus/question-presented";

function option(name: string, fallback?: string): string {
  const prefixed = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefixed));
  if (inline) return inline.slice(prefixed.length);
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}

const input = option("input");
const cacheDir = option("cache-dir");
const out = option("out");
const qpOut = process.argv.some((value) => value === "--qp-out" || value.startsWith("--qp-out=")) ? option("qp-out") : null;
const execFileAsync = promisify(execFile);
const delayMs = Math.max(1100, Number(option("delay-ms", "1500")));
const budgetMs = Math.max(1, Number(option("budget-minutes", "300"))) * 60_000;
const userAgent = process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1 (+https://jurvio.com; public court records)";
const MAX_BYTES = 4 * 1024 * 1024;

mkdirSync(cacheDir, { recursive: true });
writeFileSync(out, "");
if (qpOut) {
  writeFileSync(qpOut, "");
  mkdirSync(join(cacheDir, "qp"), { recursive: true });
}

function copyValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "\\N";
  return String(value).replaceAll("\\", "\\\\").replaceAll("\t", " ").replaceAll("\n", " ").replaceAll("\r", " ");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(url: string): Promise<{ status: number; body: string | null }> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": userAgent, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (response.status === 404) return { status: 404, body: null };
      if (response.status === 429 || response.status >= 500) {
        await sleep(delayMs * 10 * attempt);
        continue;
      }
      const finalUrl = new URL(response.url);
      if (finalUrl.origin !== "https://www.supremecourt.gov") return { status: 0, body: null };
      const body = await response.text();
      if (body.length > MAX_BYTES) return { status: response.status, body: null };
      return { status: response.status, body };
    } catch {
      await sleep(delayMs * 5 * attempt);
    }
  }
  return { status: 0, body: null };
}

/** pdftotext output of a questions-presented PDF, cached gzipped; null when missing or unreadable. */
async function questionsPresentedText(url: string, slug: string): Promise<{ text: string; fetchedAt: string; hash: string } | null> {
  const cached = join(cacheDir, "qp", `${slug}.txt.gz`);
  const missing = join(cacheDir, "qp", `${slug}.missing`);
  if (existsSync(missing)) return null;
  if (existsSync(cached)) {
    return { text: gunzipSync(readFileSync(cached)).toString("utf8"), fetchedAt: readFileSync(`${cached}.fetched`, "utf8").trim(), hash: readFileSync(`${cached}.sha256`, "utf8").trim() };
  }
  if (Date.now() - started > budgetMs) { stats.stoppedForBudget = true; return null; }
  await sleep(delayMs);
  let bytes: Buffer | null = null;
  try {
    const response = await fetch(url, { headers: { "user-agent": userAgent, accept: "application/pdf" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) { writeFileSync(missing, "404"); return null; }
    if (!response.ok || new URL(response.url).origin !== "https://www.supremecourt.gov") return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") { writeFileSync(missing, "not-pdf"); return null; }
    bytes = buffer;
  } catch {
    return null;
  }
  const pdfPath = join(cacheDir, "qp", `${slug}.tmp.pdf`);
  writeFileSync(pdfPath, bytes);
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", "-l", "4", pdfPath, "-"], { maxBuffer: 4 * 1024 * 1024, timeout: 60_000 });
    const fetchedAt = new Date().toISOString();
    const hash = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(cached, gzipSync(stdout));
    writeFileSync(`${cached}.fetched`, fetchedAt);
    writeFileSync(`${cached}.sha256`, hash);
    stats.qpFetched += 1;
    return { text: stdout, fetchedAt, hash };
  } catch {
    writeFileSync(missing, "pdftotext-failed");
    return null;
  } finally {
    try { unlinkSync(pdfPath); } catch { /* already gone */ }
  }
}

const started = Date.now();
const stats = { cases: 0, cached: 0, fetched: 0, missing: 0, failed: 0, written: 0, noUrl: 0, granted: 0, denied: 0, dismissed: 0, pending: 0, judgment: 0, qpLinked: 0, qpFetched: 0, qpWritten: 0, qpUnparsed: 0, stoppedForBudget: false };
const lines = readFileSync(input, "utf8").split("\n").filter(Boolean);
for (const line of lines) {
  const [caseId, docketNumber] = line.split("\t");
  if (!caseId || !docketNumber) continue;
  stats.cases += 1;
  const url = officialDocketPageUrl(docketNumber);
  if (!url) { stats.noUrl += 1; continue; }
  const slug = docketNumber.trim().replaceAll(/[^0-9A-Za-z-]/g, "_");
  const cached = join(cacheDir, `${slug}.html.gz`);
  const missing = join(cacheDir, `${slug}.missing`);
  let html: string | null = null;
  let fetchedAt = new Date().toISOString();
  if (existsSync(missing)) { stats.missing += 1; continue; }
  if (existsSync(cached)) {
    html = gunzipSync(readFileSync(cached)).toString("utf8");
    fetchedAt = readFileSync(`${cached}.fetched`, "utf8").trim() || fetchedAt;
    stats.cached += 1;
  } else {
    if (Date.now() - started > budgetMs) { stats.stoppedForBudget = true; continue; }
    await sleep(delayMs);
    const page = await fetchPage(url);
    if (!page.body) {
      if (page.status === 404) { writeFileSync(missing, String(page.status)); stats.missing += 1; } else stats.failed += 1;
      continue;
    }
    html = page.body;
    writeFileSync(cached, gzipSync(html));
    writeFileSync(`${cached}.fetched`, fetchedAt);
    stats.fetched += 1;
  }
  const status = parseDocketStatus(html, docketNumber.trim(), url);
  if (!status || status.entryCount === 0) {
    // The archive answers an unknown docket with a 200 "not found" page.
    if (!existsSync(missing)) writeFileSync(missing, "no-docket");
    stats.missing += 1;
    continue;
  }
  stats[status.certStatus] += 1;
  if (status.judgmentEntry) stats.judgment += 1;
  appendFileSync(out, [
    caseId, status.docketNumber, url, fetchedAt,
    createHash("sha256").update(html).digest("hex"), DOCKET_STATUS_PARSER_VERSION,
    status.petitionerTitle, status.respondentTitle, status.lowerCourt, status.lowerCourtDecidedOn, status.docketedOn,
    status.certStatus, status.certStatusOn, status.certEntry, status.judgmentOn, status.judgmentEntry,
    status.lastEntryOn, status.entryCount,
  ].map(copyValue).join("\t") + "\n");
  stats.written += 1;
  if (qpOut && status.certStatus === "granted") {
    const qpUrl = readQuestionsPresentedUrl(html) ?? questionsPresentedUrlFor(status.docketNumber);
    if (!qpUrl) continue;
    stats.qpLinked += 1;
    const qp = await questionsPresentedText(qpUrl, slug);
    if (!qp) continue;
    const parsed = parseQuestionsPresented(qp.text);
    if (!parsed) { stats.qpUnparsed += 1; continue; }
    appendFileSync(qpOut, [
      caseId, status.docketNumber, qpUrl, qp.fetchedAt, qp.hash, QUESTION_PRESENTED_PARSER_VERSION,
      JSON.stringify(parsed.questions),
      parsed.grantedLimitedTo ? `{${parsed.grantedLimitedTo.join(",")}}` : null,
      parsed.grantedQuestion,
    ].map(copyValue).join("\t") + "\n");
    stats.qpWritten += 1;
  }
}
console.log(JSON.stringify(stats));
