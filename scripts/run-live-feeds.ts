import postgres from "postgres";
import { env } from "@/lib/config/env";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";
import { runCourtListenerTail } from "@/modules/ingestion/live-feeds/courtlistener-tail";
import {
  refreshTouchedCourts, runCoaLiveFeeds, runScotusLiveDockets, type SourceRunResult,
} from "@/modules/ingestion/live-feeds/run-live-feeds";

// Live feeds: new SCOTUS dockets (supremecourt.gov), new court of appeals
// opinions/orders (each circuit's own feed) and the CourtListener
// date_modified tail. New cases are drafts. Each source and each court has its
// own small budget; one failure never stops the rest.
//   node jobs/run-live-feeds.mjs --source=scotus|coa|courtlistener|all [--courts=ca5,ca9]
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw] as const;
}));
const source = args.get("source") ?? "all";
if (!["scotus", "coa", "courtlistener", "all"].includes(source)) {
  throw new Error("--source must be scotus, coa, courtlistener or all");
}
const courts = args.get("courts")?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
const artifactRoot = process.env.JURVIO_ARTIFACT_ROOT ?? process.env.RAW_ARTIFACT_DIR ?? ".data/artifacts";

const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: { application_name: `jurvio-live-feeds-${source}`, statement_timeout: 60_000 },
});
const lockKey = `jurvio-live-feeds-${source}-v1`;
const results: SourceRunResult[] = [];
try {
  const [lock] = await sql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS ok`;
  if (!lock?.ok) {
    console.log(JSON.stringify({ liveFeeds: "skipped", source, reason: "previous run still active" }));
  } else {
    const store = createArtifactStore({ localRoot: artifactRoot });
    const started = Date.now();
    if (source === "scotus" || source === "all") {
      try { results.push(await runScotusLiveDockets(sql, store)); }
      catch (error) { results.push({ source: "scotus_official", court: "scotus", ok: false, requests: 0, itemsFetched: 0,
        newCases: 0, newEntries: 0, skippedRestricted: 0, skippedAmbiguous: 0, error: String(error) }); }
    }
    if (source === "coa" || source === "all") {
      results.push(...await runCoaLiveFeeds(sql, store, courts?.length ? { coa: { maxRequestsPerCourt: 4, maxMsPerCourt: 90_000, minIntervalMs: 1_500, courts } } : {}));
    }
    if (source === "courtlistener" || source === "all") {
      const universe = await sql<{ court_code: string }[]>`
        SELECT 'scotus' AS court_code
        UNION SELECT court_code FROM appellate_source_registry
        UNION SELECT court_code FROM direct_court_registry WHERE court_type = 'district'`;
      try {
        results.push(...await runCourtListenerTail(sql, store, {
          trackedCourts: new Set(universe.map((row) => row.court_code.toLowerCase())),
          maxPages: Number.parseInt(args.get("max-pages") ?? "5", 10) || 5,
          deadlineMs: Date.now() + 6 * 60_000,
        }));
      } catch (error) {
        results.push({ source: "courtlistener", court: "_all", ok: false, requests: 0, itemsFetched: 0,
          newCases: 0, newEntries: 0, skippedRestricted: 0, skippedAmbiguous: 0, error: String(error) });
      }
    }
    let freshness: unknown = null;
    try { freshness = await refreshTouchedCourts(sql, results); }
    catch (error) { freshness = { error: String(error) }; }
    const totals = results.reduce((sum, row) => ({
      requests: sum.requests + row.requests, itemsFetched: sum.itemsFetched + row.itemsFetched,
      newCases: sum.newCases + row.newCases, newEntries: sum.newEntries + row.newEntries,
      failed: sum.failed + (row.ok ? 0 : 1),
    }), { requests: 0, itemsFetched: 0, newCases: 0, newEntries: 0, failed: 0 });
    console.log(JSON.stringify({ liveFeeds: source, elapsedMs: Date.now() - started, totals, freshness, results }));
    // Partial failure is normal (one court down); only a total failure fails the job.
    if (results.length > 0 && totals.failed === results.length) process.exitCode = 1;
  }
} finally {
  await sql.end();
}
