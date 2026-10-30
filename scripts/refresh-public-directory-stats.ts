import postgres from "postgres";
import { env } from "@/lib/config/env";
import { refreshPublicDirectoryStats } from "@/modules/directory/application/public-directory-stats";

// One connection, so the refresher never holds more than one Postgres backend.
// Own advisory lock (jurvio-public-directory-stats-v1), separate from the
// citation graph, citation counts and sitemap locks. try_lock returns at once
// when a previous pass is still connected.
const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: {
    application_name: "jurvio-precompute",
  },
});
try {
  await sql`SELECT set_config('statement_timeout', '120s', false)`;
  const [lock] = await sql<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(hashtext('jurvio-public-directory-stats-v1')) AS locked
  `;
  if (!lock?.locked) {
    console.log(JSON.stringify({ directoryStats: "skipped", reason: "advisory lock held" }));
  } else {
    await refreshPublicDirectoryStats(sql);
  }
} finally {
  await sql.end();
}
