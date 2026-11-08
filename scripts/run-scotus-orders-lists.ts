import postgres from "postgres";
import { env } from "@/lib/config/env";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";
import { assertPdftotextAvailable, runScotusOrdersLists } from "@/modules/ingestion/live-feeds/scotus-orders-list";

// Official Supreme Court orders lists (scheduler job "scotus-orders-lists").
// One index page and a few PDFs, at most one request a second. Subscriber mail
// stays off. Set JURVIO_PAUSE_SCOTUS_ORDERS_LISTS=1 to stop the job without a
// code change. Historical lists are stored as backfill and cannot email.
//   node jobs/run-scotus-orders-lists.mjs [--max-requests=8] [--max-pdfs=3] [--term=2026]
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw] as const;
}));
const number = (name: string, fallback: number, max: number) => {
  const value = Number.parseInt(args.get(name) ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, max) : fallback;
};

if (process.env.JURVIO_PAUSE_SCOTUS_ORDERS_LISTS === "1") {
  console.log(JSON.stringify({ scotusOrdersLists: "paused" }));
  process.exit(0);
}

const artifactRoot = process.env.JURVIO_ARTIFACT_ROOT ?? process.env.RAW_ARTIFACT_DIR ?? ".data/artifacts";
const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: { application_name: "jurvio-scotus-orders-lists", statement_timeout: 30_000 },
});
try {
  const [lock] = await sql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext('jurvio-scotus-orders-lists-v1')) AS ok`;
  if (!lock?.ok) {
    console.log(JSON.stringify({ scotusOrdersLists: "skipped", reason: "previous run still active" }));
  } else {
    const started = Date.now();
    const pdftotext = await assertPdftotextAvailable();
    const term = number("term", 0, 2100);
    const result = await runScotusOrdersLists(sql, createArtifactStore({ localRoot: artifactRoot }), {
      maxRequests: number("max-requests", 8, 20),
      maxPdfs: number("max-pdfs", 3, 6),
      termYear: term >= 1990 ? term : undefined,
    });
    console.log(JSON.stringify({
      scotusOrdersLists: result.coverage.runStatus,
      elapsedMs: Date.now() - started,
      pdftotext,
      termYear: result.termYear,
      requests: result.requests,
      stored: result.stored,
      duplicates: result.duplicates,
      withheld: result.withheld,
      unlinked: result.unlinked,
      ambiguous: result.ambiguous,
      notifications: result.notifications,
      emailsSent: result.emailsSent,
      completeness: result.coverage.completeness,
      indexedLists: result.coverage.indexedLists,
      pendingLists: result.coverage.pendingLists,
      failedLists: result.coverage.failedLists,
      newestIndexedOn: result.coverage.newestIndexedOn,
      newestStoredOn: result.coverage.newestStoredOn,
      note: result.coverage.note,
    }));
    if (result.coverage.runStatus === "failed") process.exitCode = 1;
  }
} finally {
  await sql.end();
}
