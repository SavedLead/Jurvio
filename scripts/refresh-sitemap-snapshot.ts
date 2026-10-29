import postgres from "postgres";
import { env } from "@/lib/config/env";
import { refreshSitemapDocuments } from "@/modules/discovery/application/sitemap-snapshot";

// One connection so SET statement_timeout applies to every keyset page.
const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: {
    application_name: "jurvio-citations",
    statement_timeout: 120_000,
  },
});
try {
  await sql`SELECT pg_advisory_lock(hashtext('jurvio-sitemap-snapshot-v1'))`;
  const counts = await refreshSitemapDocuments(sql);
  console.log(JSON.stringify({ sitemap: counts }));
} finally {
  await sql.end();
}
