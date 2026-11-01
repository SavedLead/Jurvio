import postgres from "postgres";
import { env } from "@/lib/config/env";
import { parseBulkCsvRecords } from "@/modules/ingestion/providers/courtlistener/bulk";
import { openBulkCsvFromUrl } from "@/modules/ingestion/providers/courtlistener/bulk-opinions";
import {
  CITATION_MAP_PHASES, type CitationMapPhase, finalizeCitationMap, importCitationMap, importOpinionClusterMap,
  importParentheticals, loadHeldOpinionIds, loadUnmappedOpinionIds, scanOpinionClusterIds,
} from "@/modules/citations/application/courtlistener-citation-map";

// CourtListener bulk citation-map import (ADR 0090, plan C8). Builder-only:
// .github/workflows/citation-map-import-builder.yml runs it in the worker image
// via scripts/ops/builder-job.sh. Streams the public bulk files (never the REST
// API) and writes throttled batches.
//   --phase=edges,parentheticals,clusters,finalize|all   (default all, in order)
//   --snapshot=2026-09-30      bulk snapshot date
//   --dry-run                  read + count only, write nothing
//   --budget-seconds=19000     stop starting batches after this long; phases resume
//   --batch=20000 --pause-ms=200 --max-active=12
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key!, raw];
}));
const int = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`--${name} must be an integer ${min}-${max}`);
  return value;
};
const snapshot = args.get("snapshot") ?? "2026-09-30";
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot)) throw new Error("--snapshot must be YYYY-MM-DD");
const requested = (args.get("phase") ?? "all") === "all" ? [...CITATION_MAP_PHASES]
  : (args.get("phase") ?? "").split(",").map((phase) => phase.trim());
for (const phase of requested) if (!CITATION_MAP_PHASES.includes(phase as CitationMapPhase)) throw new Error(`unknown phase ${phase}`);
const phases = CITATION_MAP_PHASES.filter((phase) => requested.includes(phase));
const dryRun = ["true", "1"].includes(args.get("dry-run") ?? "false");
const budgetSeconds = int("budget-seconds", 19_000, 60, 6 * 3600);
const base = (args.get("url-base") ?? "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/").replace(/\/?$/, "/");
if (!/^https:\/\/[a-z0-9.-]+\.amazonaws\.com\//.test(base) && !/^https:\/\/storage\.courtlistener\.com\//.test(base)) {
  throw new Error("--url-base must be the CourtListener bulk-data bucket");
}
const started = Date.now();
const throttle = {
  batch: int("batch", 20_000, 100, 100_000),
  pauseMs: int("pause-ms", 200, 0, 60_000),
  maxActive: int("max-active", 12, 1, 200),
  deadline: started + budgetSeconds * 1000,
};
const log = (value: object) => console.log(JSON.stringify({ citationMap: snapshot, dryRun, elapsedS: Math.round((Date.now() - started) / 1000), ...value }));
const csv = (name: string) => {
  const source = openBulkCsvFromUrl(`${base}${name}-${snapshot}.csv.bz2`);
  return {
    records: (async function* () {
      try { yield* parseBulkCsvRecords(source.stream); await source.completion; } finally { source.close(); }
    })(),
    source,
  };
};

const sql = postgres(env().DATABASE_URL, { max: 1, connection: { application_name: "jurvio-citation-map-import" } });
try {
  await sql`SET client_connection_check_interval='5s'`;
  await sql`SELECT set_config('statement_timeout', '300s', false)`;
  const [lock] = await sql<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(hashtext('jurvio-citation-map-import-v1')) AS locked`;
  if (!lock?.locked) { log({ state: "skipped", reason: "advisory lock held" }); process.exit(0); }
  const [before] = await sql<{ db: string }[]>`SELECT pg_database_size(current_database())::text AS db`;
  log({ state: "start", phases, dbBytes: Number(before?.db ?? 0) });
  let held: Awaited<ReturnType<typeof loadHeldOpinionIds>> | null = null;
  const heldIds = async () => (held ??= await loadHeldOpinionIds(sql));
  for (const phase of phases) {
    if (Date.now() >= throttle.deadline) { log({ phase, state: "deferred", reason: "budget" }); break; }
    if (phase === "edges") {
      const ids = await heldIds();
      log({ phase, state: "held-opinions", heldOpinionIds: ids.size });
      log({ phase, state: "done", ...(await importCitationMap(sql, csv("citation-map").records, { snapshot, held: ids, dryRun, throttle })) });
    } else if (phase === "parentheticals") {
      log({ phase, state: "done", ...(await importParentheticals(sql, csv("parentheticals").records, { snapshot, held: await heldIds(), dryRun, throttle })) });
    } else if (phase === "clusters") {
      const needed = await loadUnmappedOpinionIds(sql);
      log({ phase, state: "needed", needed: needed.size });
      if (!needed.size) { log({ phase, state: "done", skipped: "nothing to map" }); continue; }
      const source = openBulkCsvFromUrl(`${base}opinions-${snapshot}.csv.bz2`);
      try {
        const stats = await importOpinionClusterMap(sql, scanOpinionClusterIds(source.stream), { snapshot, needed, dryRun, throttle });
        if (!stats.stoppedEarly) await source.completion;
        log({ phase, state: stats.stoppedEarly ? "stopped" : "done", ...stats });
      } finally {
        source.close();
      }
    } else {
      log({ phase, state: "done", ...(await finalizeCitationMap(sql, { snapshot, throttle, dryRun })) });
    }
  }
  const [after] = await sql<{ db: string }[]>`SELECT pg_database_size(current_database())::text AS db`;
  const sizes = await sql<{ name: string; bytes: string }[]>`SELECT relname AS name, pg_total_relation_size(oid)::text AS bytes
    FROM pg_class WHERE relkind = 'r' AND relname IN ('courtlistener_citation_edge','courtlistener_citation_unresolved',
      'courtlistener_opinion_cluster_map','courtlistener_parenthetical')`;
  log({ state: "end", dbBytes: Number(after?.db ?? 0), growthBytes: Number(after?.db ?? 0) - Number(before?.db ?? 0),
    tables: Object.fromEntries(sizes.map((row) => [row.name, Number(row.bytes)])) });
} finally {
  await sql.end();
}
