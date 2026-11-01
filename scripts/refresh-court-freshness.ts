import postgres from "postgres";
import { env } from "@/lib/config/env";
import { refreshCourtFreshness } from "@/modules/operations/application/court-freshness";
import { pruneCourtFetchLog } from "@/modules/operations/application/court-fetch-log";
import { getCourtSourceMatrix, syncCourtSources } from "@/modules/operations/application/court-source-matrix";

// Recomputes the ~108 court_freshness rows that /internal/freshness reads.
// One grouped pass over legal_case; one connection so the timeout applies.
const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: { application_name: "jurvio-court-freshness", statement_timeout: 300_000 },
});
try {
  const [lock] = await sql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext('jurvio-court-freshness-v1')) AS ok`;
  if (!lock?.ok) {
    console.log(JSON.stringify({ courtFreshness: "skipped", reason: "previous refresh still running" }));
  } else {
    const started = Date.now();
    const result = await refreshCourtFreshness(sql);
    // Court x source matrix: sync the catalog, prune the fetch log, and print
    // every cell that needs attention so the scheduler log is the health check.
    const sources = await syncCourtSources(sql).catch((error: unknown) => ({ error: String(error) }));
    const pruned = await pruneCourtFetchLog(sql).catch((error: unknown) => ({ error: String(error) }));
    const matrix = await getCourtSourceMatrix(sql).catch(() => []);
    const attention = matrix.filter((cell) => ["failing", "zero_vs_baseline", "stale", "never"].includes(cell.health))
      .map((cell) => `${cell.courtCode}/${cell.source}:${cell.health}${cell.lastHttpStatus ? `(${cell.lastHttpStatus})` : ""}`);
    console.log(JSON.stringify({
      courtFreshness: result, courtSources: sources, fetchLogPruned: pruned,
      sourceHealth: { cells: matrix.length, enabled: matrix.filter((cell) => cell.enabled).length,
        ok: matrix.filter((cell) => cell.health === "ok").length, attention },
      elapsedMs: Date.now() - started,
    }));
  }
} finally {
  await sql.end();
}
