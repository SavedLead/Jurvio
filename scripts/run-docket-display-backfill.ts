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

interface Marker {
  version?: number;
  phase?: string;
  cursorOn?: string | null;
  cursorId?: string | null;
}

function readMarker(): { phase: DocketBackfillPhase | "done"; cursorOn: string | null; cursorId: string | null } {
  try {
    const parsed = JSON.parse(readFileSync(marker, "utf8")) as Marker;
    // Version 1 could mark the pass finished after a scan that found nothing
    // because the candidate query timed out or matched no rows. Start over.
    if (parsed.version === 2 && (parsed.phase === "recent" || parsed.phase === "rest" || parsed.phase === "done")) {
      return { phase: parsed.phase, cursorOn: parsed.cursorOn ?? null, cursorId: parsed.cursorId ?? null };
    }
  } catch {
    // First run, or a marker that is not there yet.
  }
  return { phase: "recent", cursorOn: null, cursorId: null };
}

function writeMarker(phase: DocketBackfillPhase | "done", cursorOn: string | null, cursorId: string | null): void {
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, JSON.stringify({ version: 2, phase, cursorOn, cursorId, at: new Date().toISOString() }));
}

if (!docketDisplayBackfillEnabled()) {
  console.log(JSON.stringify({ skipped: "paused", shown: 0, alertsQueued: 0 }));
  process.exit(0);
}

const markerState = readMarker();
if (markerState.phase === "done") {
  console.log(JSON.stringify({ skipped: "complete", shown: 0, scanned: 0, alertsQueued: 0 }));
  process.exit(0);
}

const { closeDb, db } = await import("@/db/client");
const { runDocketDisplayBackfill } = await import("@/modules/publication/application/backfill-docket-display");
try {
  const result = await runDocketDisplayBackfill(db(), {
    limit,
    phase: markerState.phase,
    cursorOn: markerState.cursorOn,
    cursorId: markerState.cursorId,
  });
  if (result.skipped === null && result.scanned === 0) {
    const next = markerState.phase === "recent" ? "rest" : "done";
    writeMarker(next, null, null);
  } else if (result.skipped === null && result.cursorOn) {
    writeMarker(markerState.phase, result.cursorOn, result.cursorId ?? null);
  }
  console.log(JSON.stringify(result));
} finally {
  await closeDb();
}
