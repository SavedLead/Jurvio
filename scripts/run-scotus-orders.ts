import postgres from "postgres";
import { env } from "@/lib/config/env";
import { finishIngestionRun, finishIngestionRunItem, startIngestionRun, startIngestionRunItem } from "@/modules/ingestion/application/ingestion-run";
import { ordersRuntime, runScotusOrders } from "@/modules/ingestion/live-feeds/scotus-orders";
import { FetchBudget } from "@/modules/ingestion/live-feeds/polite-fetcher";
import { ORDERS_FEED_NOTIFICATIONS_ENABLED } from "@/modules/scotus/domain/orders-list";

// Supreme Court orders-list monitor (core job "scotus-orders"). Reads the
// official orders index and at most a few order-list PDFs. Historical passes
// use --backfill and stay ineligible for mail. Feed notifications are off.
//   node jobs/run-scotus-orders.mjs [--max-pdfs=1] [--term=26] [--backfill]
if (process.env.JURVIO_SCOTUS_ORDERS === "off") {
  console.log(JSON.stringify({ scotusOrders: "skipped", reason: "JURVIO_SCOTUS_ORDERS=off" }));
  process.exit(0);
}

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw] as const;
}));
const parsedPdfs = Number.parseInt(args.get("max-pdfs") ?? "1", 10);
const maxPdfs = Number.isFinite(parsedPdfs) ? Math.min(Math.max(parsedPdfs, 0), 5) : 1;
const termArg = args.get("term");
const termYear = termArg == null ? undefined : Number.parseInt(termArg, 10);
if (termYear != null && (!Number.isInteger(termYear) || termYear < 0 || termYear > 99)) {
  throw new Error("--term must be a two-digit October term, for example 26");
}

const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: { application_name: "jurvio-scotus-orders", statement_timeout: 60_000 },
});

try {
  const [lock] = await sql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext('jurvio-scotus-orders-v1')) AS ok`;
  if (!lock?.ok) {
    console.log(JSON.stringify({ scotusOrders: "skipped", reason: "previous run still active" }));
  } else {
    const budget = new FetchBudget({
      source: "scotus-orders",
      maxRequests: 4 + maxPdfs,
      maxMs: 90_000,
      minIntervalMs: 1_000,
    });
    const started = Date.now();
    const plan = await runScotusOrders(ordersRuntime(sql, budget), {
      maxPdfs,
      termYear,
      explicitBackfill: args.has("backfill"),
    });
    const summary = {
      scotusOrders: plan.diagnostic.runSucceeded ? "ok" : "failed",
      elapsedMs: Date.now() - started,
      notificationsEnabled: ORDERS_FEED_NOTIFICATIONS_ENABLED,
      backfill: args.has("backfill"),
      runSucceeded: plan.diagnostic.runSucceeded,
      complete: plan.diagnostic.complete,
      successfulButIncomplete: plan.diagnostic.successfulButIncomplete,
      missed: plan.diagnostic.missed.length,
      stale: plan.diagnostic.stale.length,
      failures: plan.diagnostic.failures,
      withheld: plan.diagnostic.withheldCount,
      writes: plan.writes.length,
    };
    console.log(JSON.stringify(summary));
    try {
      const runId = await startIngestionRun(sql, {
        providerCode: "scotus_official",
        runType: "official_scotus_orders",
        selection: { notificationsEnabled: false, backfill: args.has("backfill"), complete: plan.diagnostic.complete },
        selectedCount: plan.writes.length,
      });
      await startIngestionRunItem(sql, runId, "orders-index");
      await finishIngestionRunItem(sql, {
        runId,
        sourceRecordId: "orders-index",
        documentCount: plan.diagnostic.missed.length,
        error: plan.diagnostic.runSucceeded ? undefined : plan.diagnostic.failures[0]?.message ?? "orders index failed",
      });
      for (const failure of plan.diagnostic.failures.filter((failure) => failure.stage !== "orders_index")) {
        const sourceRecordId = (failure.sourceUrl ?? failure.stage).slice(0, 180);
        await startIngestionRunItem(sql, runId, sourceRecordId);
        await finishIngestionRunItem(sql, { runId, sourceRecordId, error: failure.message });
      }
      await finishIngestionRun(sql, runId);
    } catch (error) {
      console.log(JSON.stringify({ scotusOrdersBookkeeping: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "bookkeeping failed" }));
    }
    if (!plan.diagnostic.runSucceeded) process.exitCode = 1;
  }
} finally {
  await sql.end();
}
