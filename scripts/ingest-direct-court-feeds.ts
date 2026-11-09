import { closeDb, db } from "@/db/client";
import { ingestDirectCourtFeed } from "@/modules/ingestion/application/ingest-direct-court-feed";
import { selectDirectCourtsDue } from "@/modules/ingestion/application/direct-court-rotation";
import { pruneDirectCourtEvents } from "@/modules/ingestion/application/direct-court-retention";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";
import { recordSourceWatermark, refreshCourtFreshness } from "@/modules/operations/application/court-freshness";

// District CM/ECF public RSS. Each run takes the enabled courts that are due
// (at most --max-courts, inside --budget-ms) and handles each one in its own
// try/catch: one court's ECONNRESET or timeout is recorded for that court and
// the run moves on.
// --min-interval-minutes is the longest gap (default 30). A court is due sooner
// when its registry polling_minutes is shorter (5 for every district). That
// stays inside the 24-hour feed window.
// After the courts, a bounded retention pass prunes old direct_court_event and
// direct_court_alert_event rows (docket entries are kept; see
// direct-court-retention.ts). --retention=0 skips it.
//   node jobs/ingest-direct-court-feeds.mjs --court=all [--max-courts=94] [--budget-ms=420000] [--min-interval-minutes=30]
//     [--retention=1] [--event-retention-days=14] [--alert-retention-days=30]
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw] as const;
}));
const courtCode = (args.get("court") ?? "all").toLowerCase();
const maxCourts = Math.min(120, Math.max(1, Number.parseInt(args.get("max-courts") ?? "94", 10) || 94));
const budgetMs = Math.max(30_000, Number.parseInt(args.get("budget-ms") ?? "420000", 10) || 420_000);
const minIntervalMinutes = Math.max(0, Number.parseInt(args.get("min-interval-minutes") ?? "30", 10) || 0);
const pauseMs = 500;
const retention = (args.get("retention") ?? "1") !== "0";
const eventRetentionDays = Number.parseInt(args.get("event-retention-days") ?? "14", 10) || 14;
const alertRetentionDays = Number.parseInt(args.get("alert-retention-days") ?? "30", 10) || 30;

const sql = db();
const store = createArtifactStore({
  localRoot: process.env.RAW_ARTIFACT_DIR ?? process.env.JURVIO_ARTIFACT_ROOT ?? ".data/raw",
});
const started = Date.now();
try {
  const courts = await selectDirectCourtsDue(sql, {
    maxCourts, minIntervalMinutes, only: courtCode === "all" ? null : courtCode,
  });
  if (courtCode !== "all" && courts.length === 0) throw new Error(`No enabled direct court feed for ${courtCode}`);
  const results: Array<Record<string, unknown>> = [];
  for (const [index, court] of courts.entries()) {
    if (Date.now() - started > budgetMs) {
      results.push({ court: court.officialCourtCode, skipped: "run budget reached" });
      continue;
    }
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    try {
      const result = await ingestDirectCourtFeed(sql, store, court);
      results.push({ ok: true, ...result });
      await recordSourceWatermark(sql, {
        source: "district_rss", courtCode: court.officialCourtCode, ok: true,
        itemsFetched: "retrieved" in result ? Number(result.retrieved) : 0,
        newCases: result.created, newEntries: result.published,
      });
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      results.push({ ok: false, court: court.officialCourtCode, error: message });
      // ingestDirectCourtFeed already marked the court degraded.
      await recordSourceWatermark(sql, { source: "district_rss", courtCode: court.officialCourtCode, ok: false, error: message })
        .catch(() => undefined);
    }
  }
  const touched = courts.map((court) => court.jurvioCourtCode);
  const freshness = await refreshCourtFreshness(sql, { courtCodes: touched }).catch((error: unknown) => ({ error: String(error) }));
  const pruned = retention
    ? await pruneDirectCourtEvents(sql, { eventDays: eventRetentionDays, alertDays: alertRetentionDays })
      .catch((error: unknown) => ({ error: String(error) }))
    : { skipped: true };
  const failed = results.filter((result) => result.ok === false).length;
  console.log(JSON.stringify({
    lane: "direct-court-future-and-updates",
    historicalBulkUnchanged: true,
    elapsedMs: Date.now() - started,
    courts: courts.length,
    failed,
    freshness,
    retention: pruned,
    results,
  }));
  if (courts.length > 0 && failed === courts.length) process.exitCode = 1;
} finally {
  await closeDb();
}
