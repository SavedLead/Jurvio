import postgres from "postgres";
import { env } from "@/lib/config/env";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";
import { runScotusEmergency } from "@/modules/ingestion/live-feeds/scotus-emergency";

// Supreme Court emergency docket lane (scheduler job "scotus-emergency", every
// 10 minutes): conditional re-reads of open emergency application docket pages
// on supremecourt.gov, a short probe for new application numbers, and a small
// seed batch. Polite: at most one request a second, stops on 429.
//   node jobs/run-scotus-emergency.mjs [--max-requests=60] [--seed=15]
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw] as const;
}));
const number = (name: string, fallback: number, max: number) => {
  const value = Number.parseInt(args.get(name) ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, max) : fallback;
};
const artifactRoot = process.env.JURVIO_ARTIFACT_ROOT ?? process.env.RAW_ARTIFACT_DIR ?? ".data/artifacts";

const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: { application_name: "jurvio-scotus-emergency", statement_timeout: 30_000 },
});
try {
  const [lock] = await sql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext('jurvio-scotus-emergency-v1')) AS ok`;
  if (!lock?.ok) {
    console.log(JSON.stringify({ scotusEmergency: "skipped", reason: "previous run still active" }));
  } else {
    const started = Date.now();
    const result = await runScotusEmergency(sql, createArtifactStore({ localRoot: artifactRoot }), {
      maxRequests: number("max-requests", 60, 120),
      seedPerRun: number("seed", 15, 40),
    });
    console.log(JSON.stringify({ scotusEmergency: result.ok ? "ok" : "partial", elapsedMs: Date.now() - started, ...result }));
    if (!result.ok && result.requests === 0 && !result.skippedReason) process.exitCode = 1;
  }
} finally {
  await sql.end();
}
