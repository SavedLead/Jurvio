import postgres from "postgres";
import { env } from "@/lib/config/env";
import { runCitationEdgeJob } from "@/modules/citations/application/citation-edge-sweep";

// citation-edges lane job (ADR 0090): drain citation_dirty_case, then advance
// the resumable weekly full sweep of case_citation_edge / case_citation_count.
// Own advisory lock; one connection.
//   --budget-seconds  stop starting batches after this long (default 3000)
//   --batch           cases per sweep batch (default 200)
//   --pause-ms        pause between sweep batches (default 250)
//   --force-sweep     start a new full sweep now
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key!, raw];
}));
const int = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`--${name} must be an integer ${min}-${max}`);
  return value;
};
const budgetSeconds = int("budget-seconds", 3000, 1, 6 * 3600);
const batch = int("batch", 200, 1, 2000);
const pauseMs = int("pause-ms", 250, 0, 60_000);
const sql = postgres(env().DATABASE_URL, { max: 1, connection: { application_name: "jurvio-citation-edges" } });
try {
  await sql`SET client_connection_check_interval='5s'`;
  await sql`SELECT set_config('statement_timeout', '120s', false)`;
  const [lock] = await sql<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(hashtext('jurvio-citation-edges-v1')) AS locked`;
  if (!lock?.locked) console.log(JSON.stringify({ citationEdges: "skipped", reason: "advisory lock held" }));
  else {
    const result = await runCitationEdgeJob(sql, { budgetMs: budgetSeconds * 1000, batch, pauseMs, forceSweep: args.has("force-sweep") });
    const [backlog] = await sql`SELECT
      GREATEST((SELECT reltuples FROM pg_class WHERE oid = 'citation_dirty_case'::regclass), 0)::bigint AS dirty_estimate,
      GREATEST((SELECT reltuples FROM pg_class WHERE oid = 'case_citation_edge'::regclass), 0)::bigint AS edges_estimate,
      (SELECT row_to_json(b) FROM citation_edge_build b) AS build`;
    console.log(JSON.stringify({ citationEdges: "done", ...result, backlog }));
  }
} finally {
  await sql.end();
}
