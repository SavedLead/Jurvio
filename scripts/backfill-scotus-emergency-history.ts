// Emergency docket history backfill (Supreme Court "A" dockets of earlier
// docket years). Walks 17A1, 17A2, ... for each docket year until a run of
// consecutive numbers has no public docket page, reading each page from
// https://www.supremecourt.gov/docket/docketfiles/html/public/<docket>.html
// (never /rss/, which robots.txt disallows). Runs on the builder, never on a
// web host; the workflow loads the TSVs into scotus_application(_event).
//
//   tsx scripts/backfill-scotus-emergency-history.ts --years 17-25 \
//     --cache-dir ~/.cache/jurvio/scotus-dockets --out-dir work/ \
//     [--delay-ms 1500] [--budget-minutes 180] [--miss-stop 15] [--offline]
//
// Polite: one request at a time, at least --delay-ms apart (>= 1100 ms; the
// site asks for Crawl-delay 1), an identifying User-Agent, a conditional
// request (If-Modified-Since) when a cached copy exists, and a stop on HTTP 429
// or 5xx bursts. Pages are cached gzip (same cache and file names as the other
// Supreme Court docket backfills: <docket>.html.gz, <docket>.missing), so a
// re-dispatch resumes where the last run stopped and costs nothing for pages
// already read. Historical pages are not re-requested once cached; the two
// newest docket years are re-checked conditionally when their copy is over a
// day old. --offline reads only the cache.
//
// Output: applications.tsv and events.tsv (COPY text format), stats.json, and
// load.sql (psql script that loads both in one transaction; see historyLoadSql).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { docketPageUrl } from "@/modules/ingestion/live-feeds/scotus-emergency";
import { historyLoadSql, historyRowsFromPage } from "@/modules/scotus/application/emergency-history";
import { easternDate } from "@/modules/scotus/domain/emergency-application";

function option(name: string, fallback?: string): string {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}

function parseYears(spec: string): number[] {
  const years = new Set<number>();
  for (const part of spec.split(",")) {
    const [from, to = from] = part.split("-").map((value) => Number.parseInt(value, 10));
    if (!Number.isInteger(from) || !Number.isInteger(to) || from! < 10 || to! > 99 || from! > to!) throw new Error(`bad --years ${spec}`);
    for (let year = from!; year <= to!; year += 1) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

const years = parseYears(option("years", "17-25"));
const cacheDir = option("cache-dir");
const outDir = option("out-dir");
const delayMs = Math.max(1100, Number(option("delay-ms", "1500")));
const budgetMs = Math.max(1, Number(option("budget-minutes", "180"))) * 60_000;
const missStop = Math.max(5, Number(option("miss-stop", "15")));
const maxNumber = Math.max(100, Number(option("max-number", "3000")));
const offline = process.argv.includes("--offline");
const userAgent = process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1 (+https://jurvio.com; public court records)";
const MAX_BYTES = 2 * 1024 * 1024;
const now = new Date();
const today = easternDate(now);
const newestYear = Math.max(...years);

mkdirSync(cacheDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
const appsFile = join(outDir, "applications.tsv");
const eventsFile = join(outDir, "events.tsv");
writeFileSync(appsFile, "");
writeFileSync(eventsFile, "");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const started = Date.now();
let lastRequestAt = 0;
let consecutiveFailures = 0;

const stats = {
  years: {} as Record<string, { highest: number; pages: number; fetched: number; notModified: number; missing: number; restricted: number; serious: number; extensions: number; events: number; complete: boolean }>,
  requests: 0, failed: 0, stoppedFor: null as string | null, elapsedMs: 0,
};

class StopError extends Error {}

async function fetchPage(url: string, lastModified: string | null): Promise<{ status: number; body?: string; lastModified?: string | null }> {
  const wait = lastRequestAt + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  stats.requests += 1;
  const headers: Record<string, string> = { "user-agent": userAgent, accept: "text/html" };
  if (lastModified) headers["if-modified-since"] = lastModified;
  const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (response.status === 429) throw new StopError(`HTTP 429 (Retry-After ${response.headers.get("retry-after") ?? "?"})`);
  if (response.status === 304 || response.status === 404) { await response.body?.cancel(); return { status: response.status }; }
  if (!response.ok) { await response.body?.cancel(); return { status: response.status }; }
  const body = await response.text();
  if (body.length > MAX_BYTES) return { status: 413 };
  return { status: 200, body, lastModified: response.headers.get("last-modified") };
}

/** The page body (cache first), "missing", or null when it could not be read now. */
async function page(docketNumber: string, year: number, yearStats: (typeof stats.years)[string]): Promise<string | "missing" | null> {
  const slug = docketNumber.toLowerCase();
  const cached = join(cacheDir, `${slug}.html.gz`);
  const missing = join(cacheDir, `${slug}.missing`);
  const recentYear = year >= newestYear - 1;
  if (existsSync(cached)) {
    const html = gunzipSync(readFileSync(cached)).toString("utf8");
    const stale = recentYear && Date.now() - statSync(cached).mtimeMs > 24 * 3600_000;
    if (!stale || offline || Date.now() - started > budgetMs) return html;
    const lm = existsSync(`${cached}.lm`) ? readFileSync(`${cached}.lm`, "utf8").trim() || null : null;
    const result = await fetchPage(docketPageUrl(docketNumber), lm);
    if (result.status === 200 && result.body) { writeFileSync(cached, gzipSync(result.body)); if (result.lastModified) writeFileSync(`${cached}.lm`, result.lastModified); yearStats.fetched += 1; return result.body; }
    if (result.status === 304) { yearStats.notModified += 1; writeFileSync(`${cached}.lm`, lm ?? ""); }
    return html;
  }
  // A number past the end of an old docket year stays missing; for the newest years it may appear later.
  if (existsSync(missing) && (!recentYear || Date.now() - statSync(missing).mtimeMs < 24 * 3600_000)) return "missing";
  if (offline) return existsSync(missing) ? "missing" : null;
  if (Date.now() - started > budgetMs) throw new StopError("budget");
  const result = await fetchPage(docketPageUrl(docketNumber), null);
  if (result.status === 404) { writeFileSync(missing, "404"); consecutiveFailures = 0; return "missing"; }
  if (result.status !== 200 || !result.body) {
    stats.failed += 1; consecutiveFailures += 1;
    if (consecutiveFailures >= 5) throw new StopError(`5 failures in a row (last HTTP ${result.status})`);
    await sleep(Math.min(60_000, delayMs * 2 ** consecutiveFailures));
    return null;
  }
  consecutiveFailures = 0;
  writeFileSync(cached, gzipSync(result.body));
  if (result.lastModified) writeFileSync(`${cached}.lm`, result.lastModified);
  yearStats.fetched += 1;
  return result.body;
}

try {
  for (const year of years) {
    const yy = String(year).padStart(2, "0");
    const yearStats = { highest: 0, pages: 0, fetched: 0, notModified: 0, missing: 0, restricted: 0, serious: 0, extensions: 0, events: 0, complete: false };
    stats.years[yy] = yearStats;
    let misses = 0;
    let unread = 0;
    for (let number = 1; number <= maxNumber && misses < missStop; number += 1) {
      const docketNumber = `${yy}A${number}`;
      let html: string | "missing" | null;
      try {
        html = await page(docketNumber, year, yearStats);
      } catch (error) {
        if (error instanceof StopError) throw error;
        stats.failed += 1; html = null;
      }
      if (html === "missing") { misses += 1; yearStats.missing += 1; continue; }
      if (html === null) { unread += 1; misses = 0; continue; }
      misses = 0;
      yearStats.highest = number;
      yearStats.pages += 1;
      const rows = historyRowsFromPage(html, docketNumber, today);
      if (!rows) { yearStats.restricted += 1; continue; }
      if (rows.kind === "extension") yearStats.extensions += 1; else yearStats.serious += 1;
      yearStats.events += rows.events.length;
      appendFileSync(appsFile, `${rows.application}\n`);
      if (rows.events.length) appendFileSync(eventsFile, `${rows.events.join("\n")}\n`);
    }
    yearStats.missing -= Math.min(yearStats.missing, misses); // the trailing run past the end is not a gap
    yearStats.complete = misses >= missStop && unread === 0;
    console.error(`${yy}A: ${JSON.stringify(yearStats)}`);
  }
} catch (error) {
  stats.stoppedFor = error instanceof Error ? error.message : String(error);
}
stats.elapsedMs = Date.now() - started;
writeFileSync(join(outDir, "stats.json"), JSON.stringify(stats));
writeFileSync(join(outDir, "load.sql"), historyLoadSql(readFileSync(appsFile, "utf8"), readFileSync(eventsFile, "utf8")));
console.log(JSON.stringify(stats));
