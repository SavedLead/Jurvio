/**
 * Court Source Scout
 *
 * Reads PACER's official CM/ECF directory, inspects each official court page
 * and CM/ECF landing page, discovers public source links, and verifies
 * RSS/XML/Atom candidates. It never signs in, runs PACER searches, downloads
 * case documents, or follows untrusted off-site links.
 *
 * Usage:
 *   pnpm tsx scripts/scout-district-court-sources.ts > district-court-scout.json
 *   pnpm tsx scripts/scout-district-court-sources.ts --limit=10
 *   pnpm tsx scripts/scout-district-court-sources.ts --court=nysd
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const PACER_DIRECTORY = "https://pacer.uscourts.gov/file-case/court-cmecf-lookup/data.json";
const MAX_HTML_BYTES = 1_000_000;
const MAX_CANDIDATES_PER_COURT = 12;
const MAX_CONCURRENT_COURTS = 2;
const TIMEOUT_MS = 15_000;
const SOURCE_PATTERN = /rss|atom|feed|opinion|decision|written.?opinion|new.?case|civil.?case|case.?report|calendar|notice/i;

type PacerCourt = {
  title?: string;
  court_name?: string;
  court_id?: string;
  type?: string;
  login_url?: string;
  web_url?: string;
  circuit?: string;
};
type Directory = { meta?: { last_updated?: string }; data?: PacerCourt[] };
type Probe = { url: string; reachable: boolean; status: number | null; contentType: string | null; kind: "rss_or_xml" | "html" | "other" | "unreachable"; error?: string };
type Link = { url: string; label: string; category: "feed" | "opinions" | "new_cases" | "calendar" | "notices" | "other" };

function argument(name: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}
function clean(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function courtCode(court: PacerCourt) {
  return court.court_id!.slice(0, -1).toLowerCase();
}
function category(value: string): Link["category"] {
  if (/rss|atom|feed/i.test(value)) return "feed";
  if (/opinion|decision/i.test(value)) return "opinions";
  if (/new.?case|civil.?case|case.?report/i.test(value)) return "new_cases";
  if (/calendar|hearing/i.test(value)) return "calendar";
  if (/notice|announcement/i.test(value)) return "notices";
  return "other";
}
async function fetchCapped(url: string, accept: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept, "user-agent": "Jurvio/0.1 court-source-scout" },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader && size < MAX_HTML_BYTES) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      chunks.push(next.value);
    }
    await reader?.cancel();
    const bytes = new Uint8Array(Math.min(size, MAX_HTML_BYTES));
    let offset = 0;
    for (const chunk of chunks) {
      const length = Math.min(chunk.byteLength, bytes.length - offset);
      bytes.set(chunk.subarray(0, length), offset);
      offset += length;
      if (offset === bytes.length) break;
    }
    return { response, contentType, body: new TextDecoder().decode(bytes) };
  } finally {
    clearTimeout(timeout);
  }
}
async function probe(url: string): Promise<Probe> {
  try {
    const { response, contentType, body } = await fetchCapped(url, "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8");
    const xml = /<(?:\?xml|rss|feed)\b/i.test(body);
    return { url, reachable: response.ok, status: response.status, contentType,
      kind: response.ok && (xml || /(?:rss|atom|xml)/i.test(contentType)) ? "rss_or_xml" :
        /html/i.test(contentType) ? "html" : "other" };
  } catch (error) {
    return { url, reachable: false, status: null, contentType: null, kind: "unreachable",
      error: error instanceof Error ? error.message : String(error) };
  }
}
async function pageLinks(url: string): Promise<{ probe: Probe; links: Link[] }> {
  const page = await probe(url);
  if (page.kind !== "html") return { probe: page, links: [] };
  try {
    const { body } = await fetchCapped(url, "text/html");
    const links: Link[] = [];
    for (const match of body.matchAll(/<a\\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\\s\\S]*?)<\\/a>/gi)) {
      const href = match[1] ?? "";
      const label = clean(match[2] ?? "");
      const signal = `${href} ${label}`;
      if (!SOURCE_PATTERN.test(signal)) continue;
      try {
        const resolved = new URL(href, url);
        if (!/^https?:$/.test(resolved.protocol)) continue;
        links.push({ url: resolved.toString(), label, category: category(signal) });
      } catch { /* malformed link */ }
    }
    const deduped = [...new Map(links.map((link) => [link.url, link])).values()];
    return { probe: page, links: deduped.slice(0, MAX_CANDIDATES_PER_COURT) };
  } catch {
    return { probe: page, links: [] };
  }
}
async function scout(court: PacerCourt) {
  const code = courtCode(court);
  const cmecfUrl = court.login_url!;
  const standardRss = new URL("/cgi-bin/rss_outside.pl", cmecfUrl).toString();
  const [official, cmecf, standard] = await Promise.all([
    pageLinks(court.web_url ?? cmecfUrl),
    pageLinks(cmecfUrl),
    probe(standardRss),
  ]);
  const links = [...official.links, ...cmecf.links];
  const feedCandidates = [...new Set([standardRss, ...links.filter((link) => link.category === "feed").map((link) => link.url)])]
    .slice(0, MAX_CANDIDATES_PER_COURT);
  const verifiedFeeds = (await Promise.all(feedCandidates.map(probe)))
    .filter((candidate) => candidate.kind === "rss_or_xml");
  const sources = links.filter((link) => link.category !== "feed");
  return {
    courtCode: code,
    pacerCourtId: court.court_id,
    name: court.court_name ?? court.title,
    circuit: court.circuit ?? null,
    officialCourtPage: court.web_url ?? null,
    cmecfUrl,
    website: official.probe,
    cmecf: cmecf.probe,
    verifiedFeeds,
    discoveredSources: sources,
    nextCaseMethod: verifiedFeeds.length > 0 ? "official_public_feed" : "authenticated_cmecf_new_case_report",
    reconciliationMethod: "pacer_case_locator_daily",
    writtenOpinionsMethod: "authenticated_cmecf_written_opinions_report",
  };
}
async function main() {
  const response = await fetch(PACER_DIRECTORY, { headers: { accept: "application/json", "user-agent": "Jurvio/0.1 court-source-scout" } });
  if (!response.ok) throw new Error(`PACER directory returned HTTP ${response.status}`);
  const directory = await response.json() as Directory;
  let courts = (directory.data ?? []).filter((court) =>
    court.type === "District" && court.court_id?.endsWith("DC") && Boolean(court.login_url));
  if (courts.length !== 94) throw new Error(`Expected 94 district courts, got ${courts.length}`);
  const requested = argument("court")?.toLowerCase();
  if (requested) courts = courts.filter((court) => courtCode(court) === requested);
  const limit = Number(argument("limit") ?? courts.length);
  courts = courts.slice(0, Number.isFinite(limit) ? Math.max(1, limit) : courts.length);

  const results: Awaited<ReturnType<typeof scout>>[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_COURTS, courts.length) }, async () => {
    while (cursor < courts.length) {
      const index = cursor++;
      results[index] = await scout(courts[index]!);
    }
  }));
  const report = {
    source: PACER_DIRECTORY,
    directoryUpdatedAt: directory.meta?.last_updated ?? null,
    generatedAt: new Date().toISOString(),
    requestedCourtCount: courts.length,
    verifiedFeedCourtCount: results.filter((court) => court.verifiedFeeds.length > 0).length,
    courts: results,
  };
  const serialized = JSON.stringify(report, null, 2) + "\n";
  const output = argument("output");
  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized, "utf8");
  }
  process.stdout.write(serialized);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
