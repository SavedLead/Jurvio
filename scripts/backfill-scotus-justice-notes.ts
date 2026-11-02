// Read the Supreme Court's official docket page for each Supreme Court case we
// hold a docket status for, and write one row per justice note the docket
// states ("Justice Alito would grant the petition", "Justice Thomas, dissenting
// from the denial of certiorari", statements, concurrences, recusals) as a
// COPY-ready TSV. Runs on the builder (never on a web host); the workflow loads
// the TSV into scotus_docket_justice_note (migration 0191).
//
//   tsx scripts/backfill-scotus-justice-notes.ts --input cases.tsv \
//     --cache-dir ~/.cache/jurvio/scotus-dockets --out notes.tsv \
//     [--delay-ms 1500] [--budget-minutes 120]
//
// cases.tsv: case_id <TAB> docket_number, one per line.
// Docket pages come from the same gzip cache backfill-scotus-docket-status.ts
// fills (a cached page is never refetched). A written dissent/statement links
// its official opinion PDF; the PDF is fetched once (same delay, identifying
// User-Agent), converted with pdftotext and cached as text, and the opening
// lines are quoted. Without pdftotext the notes are still written, unquoted.
//
// The builder has no pdftotext (and no passwordless sudo), so the workflow runs
// pdftotext inside the released app image (which ships poppler-utils) with the
// opinion cache mounted read-only at /opinions, and passes the container name in
// PDFTOTEXT_CONTAINER. When that is set and pdftotext can't run in it, the script
// exits 2 instead of silently writing unquoted notes.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { officialDocketPageUrl } from "@/modules/ingestion/providers/scotus/docket-status";
import { parseOfficialDocket } from "@/modules/ingestion/providers/scotus/official-docket";
import {
  DOCKET_JUSTICE_NOTES_PARSER_VERSION,
  openingOfOpinion,
  parseDocketJusticeNotes,
  reasonSentence,
  WRITTEN_KINDS,
} from "@/modules/scotus/domain/docket-justice-notes";

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
const delayMs = Math.max(1100, Number(option("delay-ms", "1500")));
const budgetMs = Math.max(1, Number(option("budget-minutes", "120"))) * 60_000;
const userAgent = process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1 (+https://jurvio.com; public court records)";
const MAX_BYTES = 8 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const opinionDir = join(cacheDir, "justice-opinions");

mkdirSync(cacheDir, { recursive: true });
mkdirSync(opinionDir, { recursive: true });
writeFileSync(out, "");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const started = Date.now();
const overBudget = () => Date.now() - started > budgetMs;

const pdftotextContainer = process.env.PDFTOTEXT_CONTAINER?.trim() || null;
const CONTAINER_OPINION_DIR = "/opinions";

/** pdftotext on the host, or inside the app-image container (PDF path mapped to /opinions). */
function runPdftotext(args: string[], pdfPath: string | null, timeout: number) {
  const options = { maxBuffer: 16 * 1024 * 1024, timeout };
  const tail = pdfPath ? [pdfPath, "-"] : [];
  if (!pdftotextContainer) return execFileAsync("pdftotext", [...args, ...tail], options);
  const inside = pdfPath ? [`${CONTAINER_OPINION_DIR}/${basename(pdfPath)}`, "-"] : [];
  return execFileAsync("docker", ["exec", pdftotextContainer, "pdftotext", ...args, ...inside], options);
}

let havePdftotext = true;
try { await runPdftotext(["-v"], null, 10_000); } catch { havePdftotext = false; }
if (!havePdftotext && pdftotextContainer) {
  console.error(`pdftotext does not run in container ${pdftotextContainer}; refusing to write unquoted notes`);
  process.exit(2);
}

function copyValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "\\N";
  return String(value).replaceAll("\\", "\\\\").replaceAll("\t", " ").replaceAll("\n", " ").replaceAll("\r", " ");
}

async function fetchOfficial(url: string, accept: string): Promise<{ status: number; body: Buffer | null }> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": userAgent, accept }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (response.status === 404) return { status: 404, body: null };
      if (response.status === 429 || response.status >= 500) { await sleep(delayMs * 10 * attempt); continue; }
      if (new URL(response.url).origin !== "https://www.supremecourt.gov") return { status: 0, body: null };
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_BYTES) return { status: response.status, body: null };
      return { status: response.status, body };
    } catch {
      await sleep(delayMs * 5 * attempt);
    }
  }
  return { status: 0, body: null };
}

const stats = {
  cases: 0, cachedPages: 0, fetchedPages: 0, missingPages: 0, failedPages: 0, uncachedSkipped: 0,
  casesWithNotes: 0, notes: 0, byKind: {} as Record<string, number>, byContext: {} as Record<string, number>,
  deniedCasesWithNotes: 0, deniedCasesWithDissentOrGrant: 0,
  opinionLinks: 0, opinionsCached: 0, opinionsFetched: 0, opinionsFailed: 0, openingsQuoted: 0, reasonsQuoted: 0,
  pdftotext: havePdftotext, stoppedForBudget: false,
};

async function opinionText(url: string): Promise<string | null> {
  const key = createHash("sha1").update(url).digest("hex");
  const cached = join(opinionDir, `${key}.txt.gz`);
  const missing = join(opinionDir, `${key}.missing`);
  if (existsSync(cached)) { stats.opinionsCached += 1; return gunzipSync(readFileSync(cached)).toString("utf8"); }
  if (existsSync(missing) || !havePdftotext) return null;
  if (overBudget()) { stats.stoppedForBudget = true; return null; }
  await sleep(delayMs);
  const page = await fetchOfficial(url.replace(/#.*$/, ""), "application/pdf");
  if (!page.body) { if (page.status === 404) writeFileSync(missing, "404"); stats.opinionsFailed += 1; return null; }
  if (page.body.subarray(0, 5).toString("latin1") !== "%PDF-") { writeFileSync(missing, "not-pdf"); stats.opinionsFailed += 1; return null; }
  const pdfPath = join(opinionDir, `${key}.tmp.pdf`);
  writeFileSync(pdfPath, page.body);
  // A preliminary-print order list holds many orders; "#page=85" says where this one starts.
  const startPage = Number(/#page=(\d+)/.exec(url)?.[1] ?? "1");
  const args = ["-f", String(startPage), "-l", String(startPage + 40)];
  try {
    const { stdout } = await runPdftotext(args, pdfPath, 120_000);
    writeFileSync(cached, gzipSync(stdout));
    stats.opinionsFetched += 1;
    return stdout;
  } catch {
    stats.opinionsFailed += 1; // not cached as missing: a later run with a working pdftotext retries
    return null;
  } finally {
    try { unlinkSync(pdfPath); } catch { /* already gone */ }
  }
}

/** The official opinion PDF a docket entry links: slip opinions first, then an order-list page. */
function opinionUrlOf(documents: Array<{ url: string; title: string }>): string | null {
  const pdfs = documents.map((document) => document.url).filter((url) => /^https:\/\/www\.supremecourt\.gov\/opinions\//i.test(url) && /\.pdf(?:#page=\d+)?$/i.test(url));
  return pdfs.find((url) => !/preliminaryprint/i.test(url)) ?? pdfs[0] ?? null;
}

for (const line of readFileSync(input, "utf8").split("\n").filter(Boolean)) {
  const [caseId, docketNumber] = line.split("\t");
  if (!caseId || !docketNumber) continue;
  stats.cases += 1;
  const docket = docketNumber.trim();
  const url = officialDocketPageUrl(docket);
  if (!url) continue;
  const slug = docket.replaceAll(/[^0-9A-Za-z-]/g, "_");
  const cached = join(cacheDir, `${slug}.html.gz`);
  if (existsSync(join(cacheDir, `${slug}.missing`))) { stats.missingPages += 1; continue; }
  let html: string;
  let fetchedAt = new Date().toISOString();
  if (existsSync(cached)) {
    html = gunzipSync(readFileSync(cached)).toString("utf8");
    fetchedAt = existsSync(`${cached}.fetched`) ? readFileSync(`${cached}.fetched`, "utf8").trim() || fetchedAt : fetchedAt;
    stats.cachedPages += 1;
  } else {
    if (overBudget()) { stats.stoppedForBudget = true; stats.uncachedSkipped += 1; continue; }
    await sleep(delayMs);
    const page = await fetchOfficial(url, "text/html");
    if (!page.body) { if (page.status === 404) { writeFileSync(join(cacheDir, `${slug}.missing`), "404"); stats.missingPages += 1; } else stats.failedPages += 1; continue; }
    html = page.body.toString("utf8");
    writeFileSync(cached, gzipSync(html));
    writeFileSync(`${cached}.fetched`, fetchedAt);
    stats.fetchedPages += 1;
  }
  let parsed;
  try { parsed = parseOfficialDocket(html, docket, url); } catch { stats.failedPages += 1; continue; }
  let caseNotes = 0;
  let deniedNote = false;
  let deniedVote = false;
  const seen = new Set<string>();
  for (const event of parsed.events) {
    if (!event.filedOn) continue;
    const notes = parseDocketJusticeNotes(event.description);
    if (notes.length === 0) continue;
    const opinionUrl = opinionUrlOf(event.documents);
    for (const note of notes) {
      const key = `${event.filedOn}|${note.context}|${note.justiceRef}|${note.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const written = WRITTEN_KINDS.has(note.kind) || note.kind.startsWith("joined_");
      const link = written ? opinionUrl : null;
      let opening: string | null = null;
      let reason: string | null = null;
      if (link) stats.opinionLinks += 1;
      if (link && WRITTEN_KINDS.has(note.kind)) {
        const text = await opinionText(link);
        if (text) {
          opening = openingOfOpinion(text, note.justiceRef, note.kind);
          reason = opening ? reasonSentence(text, note.justiceRef, note.kind, opening) : null;
          if (opening) stats.openingsQuoted += 1;
          if (reason) stats.reasonsQuoted += 1;
        }
      }
      appendFileSync(out, [
        caseId, docket, url, event.filedOn, event.description.slice(0, 2000), note.context, note.justiceRef, note.kind,
        note.sentence.slice(0, 1000), link, opening, reason, fetchedAt, DOCKET_JUSTICE_NOTES_PARSER_VERSION,
      ].map(copyValue).join("\t") + "\n");
      caseNotes += 1;
      stats.notes += 1;
      stats.byKind[note.kind] = (stats.byKind[note.kind] ?? 0) + 1;
      stats.byContext[note.context] = (stats.byContext[note.context] ?? 0) + 1;
      if (note.context === "cert_denied") {
        deniedNote = true;
        if (note.kind !== "recused") deniedVote = true;
      }
    }
  }
  if (caseNotes) stats.casesWithNotes += 1;
  if (deniedNote) stats.deniedCasesWithNotes += 1;
  if (deniedVote) stats.deniedCasesWithDissentOrGrant += 1;
}
console.log(JSON.stringify(stats));
