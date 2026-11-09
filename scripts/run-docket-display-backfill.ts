/**
 * Paced backfill of display decisions for stored docket lines.
 * Exits before opening the database when paused or already finished.
 *
 *   node jobs/run-docket-display-backfill.mjs --limit=2000
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { docketDisplayBackfillEnabled } from "@/modules/publication/domain/continuous-publish";
import type { DocketBackfillPhase } from "@/modules/publication/application/backfill-docket-display";

const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length) ?? "2000");
const root = process.env.JURVIO_ARTIFACT_ROOT ?? process.env.RAW_ARTIFACT_DIR ?? "/var/lib/jurvio/artifacts";
const marker = join(root, "scheduler", "docket-display-backfill.json");

function readPhase(): DocketBackfillPhase | "done" {
  try {
    const parsed = JSON.parse(readFileSync(marker, "utf8")) as { phase?: string };
    if (parsed.phase === "recent" || parsed.phase === "rest" || parsed.phase === "done") return parsed.phase;
  } catch {
    // First run, or a marker that is not there yet.
  }
  return "recent";
}

function writePhase(phase: DocketBackfillPhase | "done"): void {
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, JSON.stringify({ phase, at: new Date().toISOString() }));
}

if (!docketDisplayBackfillEnabled()) {
  console.log(JSON.stringify({ skipped: "paused", shown: 0, alertsQueued: 0 }));
  process.exit(0);
}

const phase = readPhase();
if (phase === "done") {
  console.log(JSON.stringify({ skipped: "complete", shown: 0, alertsQueued: 0 }));
  process.exit(0);
}

const { closeDb, db } = await import("@/db/client");
const { runDocketDisplayBackfill } = await import("@/modules/publication/application/backfill-docket-display");
try {
  const result = await runDocketDisplayBackfill(db(), { limit, phase });
  if (result.skipped === null && result.shown === 0) {
    writePhase(phase === "recent" ? "rest" : "done");
  }
  console.log(JSON.stringify(result));
} finally {
  await closeDb();
}
