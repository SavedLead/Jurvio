import postgres from "postgres";
import { env } from "@/lib/config/env";
import { refreshPublicCaseSearch } from "@/modules/cases/application/public-case-search";

// One connection and its own advisory lock (jurvio-public-case-search-v1).
// try_lock returns at once when a previous pass is still connected. The cursor
// is stored after every batch, so a pass stopped by the scheduler budget resumes.
const maxBatchesArg = process.argv.find((arg) => arg.startsWith("--max-batches="));
const maxBatches = maxBatchesArg ? Number.parseInt(maxBatchesArg.split("=")[1] ?? "", 10) : undefined;
if (maxBatches !== undefined && (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 1000)) {
  throw new Error("--max-batches must be 1-1000");
}
const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: {
    application_name: "jurvio-precompute",
  },
});
try {
  await sql`SELECT set_config('statement_timeout', '120s', false)`;
  const [lock] = await sql<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(hashtext('jurvio-public-case-search-v1')) AS locked
  `;
  if (!lock?.locked) {
    console.log(JSON.stringify({ caseSearch: "skipped", reason: "advisory lock held" }));
  } else {
    await refreshPublicCaseSearch(sql, { maxBatches });
  }
} finally {
  await sql.end();
}
