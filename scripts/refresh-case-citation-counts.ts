import postgres from "postgres";
import { env } from "@/lib/config/env";
import { refreshCaseCitationCounts } from "@/modules/citations/application/refresh-case-citation-counts";

// One connection so the statement timeout covers the corpus refresh.
// This does not hold the citation-graph advisory lock.
const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: {
    application_name: "jurvio-citations",
    statement_timeout: 1_200_000,
  },
});
try {
  await sql`SELECT pg_advisory_lock(hashtext('jurvio-case-citation-counts-v1'))`;
  const updated = await refreshCaseCitationCounts(sql);
  console.log(JSON.stringify({ caseCitationCounts: updated }));
} finally {
  await sql.end();
}
