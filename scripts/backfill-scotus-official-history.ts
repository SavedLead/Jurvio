/**
 * Walk supremecourt.gov docket JSON from docket year 2017 through the current
 * docket year. Draft cases only. Does not download filing PDFs, publish, or
 * notify subscribers. Resumes from scotus_official_checkpoint.
 *
 *   node jobs/backfill-scotus-official-history.mjs --max-requests=120 --min-interval-ms=1500
 */
import { closeDb, db } from "@/db/client";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";
import { runScotusOfficialHistory } from "@/modules/ingestion/live-feeds/scotus-official-history";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw] as const;
}));
const maxRequests = Number(args.get("max-requests") ?? "120");
const minIntervalMs = Number(args.get("min-interval-ms") ?? "1500");
if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 400) throw new Error("--max-requests must be 1-400");
if (!Number.isInteger(minIntervalMs) || minIntervalMs < 1000) throw new Error("--min-interval-ms must be at least 1000");

const artifactRoot = process.env.JURVIO_ARTIFACT_ROOT ?? process.env.RAW_ARTIFACT_DIR ?? ".data/artifacts";
const result = await runScotusOfficialHistory(db(), createArtifactStore({ localRoot: artifactRoot }), {
  maxRequests, minIntervalMs, maxMs: 10 * 60_000,
});
console.log(JSON.stringify({
  year: result.year, series: result.series, next: result.next, complete: result.complete,
  done: result.done, orders: result.orders, slips: result.slips, counts: result.counts,
  alertsQueued: result.alertsQueued, pdfsDownloaded: result.pdfsDownloaded,
  estimateHours: result.estimateHours, skipped: result.skipped, ranges: result.ranges,
}));
await closeDb();
