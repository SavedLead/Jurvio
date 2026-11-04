// Read-only Google Search Console report. Uses only GET endpoints and the
// read-only query endpoints (searchAnalytics/query, urlInspection/index:inspect).
// Never PUTs or submits anything. Exported buildReport() can feed the Growth page.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const API = "https://www.googleapis.com/webmasters/v3";
const INSPECT = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

function day(offset) {
  const d = new Date(Date.now() - offset * 86400000);
  return d.toISOString().slice(0, 10);
}

export async function buildReport({ token, siteUrl = "sc-domain:jurvio.com", sampleCaseCount = 3, fetchImpl = fetch } = {}) {
  async function google(url, init = {}) {
    const method = init.method ?? "GET";
    const allowed = method === "GET" || url.endsWith("/searchAnalytics/query") || url === INSPECT;
    if (!allowed) throw new Error(`Refusing non-read request ${method} ${url}`);
    const res = await fetchImpl(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    });
    if (!res.ok) throw new Error(`Google API failed: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const site = encodeURIComponent(siteUrl);
  // End date is today; GSC data lags 2-3 days so recent days are empty/partial.
  const endDate = day(0);
  const query = (days, dimensions = [], rowLimit = 1000) =>
    google(`${API}/sites/${site}/searchAnalytics/query`, {
      method: "POST",
      body: JSON.stringify({ startDate: day(days - 1), endDate, dimensions, rowLimit, dataState: "all" }),
    }).then((r) => (r?.rows ?? []).map((row) => ({
      keys: row.keys ?? [], clicks: row.clicks, impressions: row.impressions,
      ctr: row.ctr, position: row.position,
    })));
  const sortImp = (rows, n) => [...rows].sort((a, b) => b.impressions - a.impressions).slice(0, n);
  const totals = (rows) => rows[0] ?? { keys: [], clicks: 0, impressions: 0, ctr: 0, position: null };

  const report = { siteUrl, generatedAt: new Date().toISOString(), endDate, note: "Search Console data lags 2-3 days; the Pages (indexing) report is not available via the API." };
  report.totals = {};
  for (const d of [7, 28, 90]) report.totals[`last${d}d`] = totals(await query(d));
  report.daily28d = (await query(28, ["date"])).sort((a, b) => a.keys[0].localeCompare(b.keys[0]));
  report.topQueries28d = sortImp(await query(28, ["query"]), 25);
  report.topPages28d = sortImp(await query(28, ["page"]), 25);
  report.byCountry28d = sortImp(await query(28, ["country"]), 1000);
  report.byDevice28d = sortImp(await query(28, ["device"]), 1000);

  const sm = await google(`${API}/sites/${site}/sitemaps`);
  report.sitemaps = (sm?.sitemap ?? []).map((s) => ({
    path: s.path, lastSubmitted: s.lastSubmitted ?? null, lastDownloaded: s.lastDownloaded ?? null,
    isPending: s.isPending ?? null, warnings: s.warnings ?? null, errors: s.errors ?? null,
    contents: (s.contents ?? []).map((c) => ({ type: c.type, submitted: c.submitted ?? null, indexed: c.indexed ?? null })),
  }));

  // Sample URLs: home, emergency docket, and a few case pages from the public sitemap (GET).
  const samples = ["https://jurvio.com/", "https://jurvio.com/supreme-court/emergency"];
  try {
    const xml = await (await fetchImpl("https://jurvio.com/sitemap.xml")).text();
    let locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    const child = /<sitemapindex/.test(xml) ? locs : [];
    if (child.length) {
      const pick = child.find((l) => /\/cases\//.test(l)) ?? child[0];
      const sub = await (await fetchImpl(pick)).text();
      locs = [...sub.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    }
    const cases = locs.filter((l) => /\/case\/[^/]+$/.test(l)).slice(0, sampleCaseCount);
    samples.push(...cases);
  } catch (e) {
    report.sitemapFetchError = String(e);
  }
  report.inspections = [];
  for (const inspectionUrl of samples) {
    try {
      const r = await google(INSPECT, { method: "POST", body: JSON.stringify({ inspectionUrl, siteUrl }) });
      const s = r?.inspectionResult?.indexStatusResult ?? {};
      report.inspections.push({ url: inspectionUrl, verdict: s.verdict ?? null, coverageState: s.coverageState ?? null, lastCrawlTime: s.lastCrawlTime ?? null });
    } catch (e) {
      report.inspections.push({ url: inspectionUrl, error: String(e).slice(0, 300) });
    }
  }
  return report;
}

function fmt(r) {
  const pct = (x) => `${((x ?? 0) * 100).toFixed(2)}%`;
  const pos = (x) => (x == null ? "-" : x.toFixed(1));
  const line = (label, r) => `${label.padEnd(60)} clicks=${r.clicks} impr=${r.impressions} ctr=${pct(r.ctr)} pos=${pos(r.position)}`;
  const out = [`Search Console report for ${r.siteUrl} (through ${r.endDate}). ${r.note}`, "", "== Totals"];
  for (const [k, v] of Object.entries(r.totals)) out.push(line(k, v));
  const section = (title, rows) => { out.push("", `== ${title} (${rows.length} rows)`); for (const x of rows) out.push(line(x.keys.join(" "), x)); };
  section("Daily, last 28 days", r.daily28d);
  section("Top 25 queries by impressions, 28d", r.topQueries28d);
  section("Top 25 pages by impressions, 28d", r.topPages28d);
  section("By country, 28d", r.byCountry28d);
  section("By device, 28d", r.byDevice28d);
  out.push("", "== Sitemaps");
  for (const s of r.sitemaps) {
    out.push(`${s.path} lastSubmitted=${s.lastSubmitted} lastDownloaded=${s.lastDownloaded} pending=${s.isPending} warnings=${s.warnings} errors=${s.errors}`);
    for (const c of s.contents) out.push(`   ${c.type}: submitted=${c.submitted} indexed=${c.indexed}`);
  }
  out.push("", "== URL inspections");
  for (const i of r.inspections) out.push(`${i.url}  ${i.error ?? `verdict=${i.verdict} coverage="${i.coverageState}" lastCrawl=${i.lastCrawlTime}`}`);
  return out.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("Missing GOOGLE_OAUTH_ACCESS_TOKEN (Workload Identity).");
  const report = await buildReport({ token, siteUrl: process.env.GSC_SITE_URL?.trim() || "sc-domain:jurvio.com" });
  console.log(fmt(report));
  writeFileSync(process.env.GSC_REPORT_OUT || "gsc-report.json", JSON.stringify(report, null, 2));
}
