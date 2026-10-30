import postgres from "postgres";
import { env } from "@/lib/config/env";
import { refreshCourtFreshness } from "@/modules/operations/application/court-freshness";

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
    console.log(JSON.stringify({ courtFreshness: result, elapsedMs: Date.now() - started }));
  }
} finally {
  await sql.end();
}
