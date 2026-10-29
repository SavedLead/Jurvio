import postgres from "postgres";
import { env } from "@/lib/config/env";
import { refreshCaseCitationCounts } from "@/modules/citations/application/refresh-case-citation-counts";

// One connection. The lock is only this job's lock (jurvio-case-citation-counts-v1).
// It is not the citation-graph lock (jurvio-case-citations-v1) and not the sitemap lock.
// try_lock returns immediately when a previous pass is still connected, instead of
// sitting on pg_advisory_lock with an empty table and no log line.
const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: {
    application_name: "jurvio-citations",
  },
});
try {
  await sql`SELECT set_config('statement_timeout', '120s', false)`;
  const [lock] = await sql<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(hashtext('jurvio-case-citation-counts-v1')) AS locked
  `;
  if (!lock?.locked) {
    console.log(JSON.stringify({ citationCounts: "skipped", reason: "advisory lock held" }));
  } else {
    const updated = await refreshCaseCitationCounts(sql);
    console.log(JSON.stringify({ caseCitationCounts: updated }));
  }
} finally {
  await sql.end();
}
