import postgres from "postgres";
import { env } from "@/lib/config/env";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";
import { discoverLiveOpinionText, processLiveOpinionText } from "@/modules/ingestion/live-feeds/live-opinion-text";

// Live-feed opinion text (ADR 0090, plan D11). Resident lane: discover new
// opinions from the live feeds, then fetch + extract a bounded number
// (native text only; scanned PDFs are parked as ocr_required). The builder
// workflow live-opinion-text-builder.yml runs the backfill with OCR.
//   --discover=1 --backfill-days=3   queue new items (first run looks back N days)
//   --rescan-days=N                  re-scan the last N days regardless of the watermark
//   --limit=40 --budget-seconds=600  documents per run / time budget
//   --ocr=0                          1 = OCR scanned PDFs (builder only)
//   --states=pending                 or ocr_required, or pending,ocr_required
//   --min-host-interval-ms=4000      politeness per host
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key!, raw];
}));
const int = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`--${name} must be an integer ${min}-${max}`);
  return value;
};
const flag = (name: string, fallback: boolean) => ["1", "true"].includes(args.get(name) ?? (fallback ? "1" : "0"));
const states = (args.get("states") ?? "pending").split(",").map((s) => s.trim());
for (const state of states) if (state !== "pending" && state !== "ocr_required") throw new Error("--states must be pending and/or ocr_required");
const budgetSeconds = int("budget-seconds", 600, 10, 6 * 3600);
const started = Date.now();
const sql = postgres(env().DATABASE_URL, { max: 1, connection: { application_name: "jurvio-live-opinion-text", statement_timeout: 60_000 } });
try {
  const lockKey = states.includes("ocr_required") ? "jurvio-live-opinion-text-ocr-v1" : "jurvio-live-opinion-text-v1";
  const [lock] = await sql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS ok`;
  if (!lock?.ok) console.log(JSON.stringify({ liveOpinionText: "skipped", reason: "previous run still active" }));
  else {
    const discovered = flag("discover", true)
      ? await discoverLiveOpinionText(sql, { backfillDays: int("backfill-days", 3, 0, 400), limit: int("discover-limit", 5000, 1, 200_000),
        rescanDays: int("rescan-days", 0, 0, 400) || undefined })
      : null;
    const store = createArtifactStore({ localRoot: process.env.JURVIO_ARTIFACT_ROOT ?? process.env.RAW_ARTIFACT_DIR ?? ".data/artifacts" });
    const processed = await processLiveOpinionText(sql, {
      store,
      limit: int("limit", 40, 0, 100_000),
      deadline: started + budgetSeconds * 1000,
      userAgent: env().INGESTION_USER_AGENT,
      govinfoApiKey: process.env.GOVINFO_API_KEY?.trim() || undefined,
      allowOcr: flag("ocr", false),
      ocrMaxPages: int("ocr-max-pages", 40, 1, 200),
      minHostIntervalMs: int("min-host-interval-ms", 4000, 500, 120_000),
      states: states as ("pending" | "ocr_required")[],
    });
    const queue = await sql<{ state: string; n: number }[]>`SELECT state, count(*)::int AS n FROM live_opinion_text GROUP BY state`;
    console.log(JSON.stringify({ liveOpinionText: "done", elapsedS: Math.round((Date.now() - started) / 1000), discovered, ...processed,
      queue: Object.fromEntries(queue.map((row) => [row.state, row.n])) }));
  }
} finally {
  await sql.end();
}
