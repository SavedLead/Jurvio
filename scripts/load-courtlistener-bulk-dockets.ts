import postgres from "postgres";
import { env } from "@/lib/config/env";
import { loadCourtListenerBulkDockets } from "@/modules/ingestion/application/bulk-docket-load";

function option(name: string): string | undefined {
  const equals = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (equals) return equals.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const filePath = option("file");
const snapshotDate = option("snapshot-date");
const rowLimit = Number(option("row-limit") ?? "100000");
const budgetMinutes = Number(option("budget-minutes") ?? "90");
const allowAnytime = option("allow-anytime") === "true";
const resetCheckpoint = option("reset-checkpoint") === "true";
const includeBankruptcy = option("include-bankruptcy") === "true";

if (!filePath || !snapshotDate) {
  throw new Error(
    "Usage: node jobs/load-courtlistener-bulk-dockets.mjs --file <dockets.csv.bz2> --snapshot-date YYYY-MM-DD [--row-limit 100000] [--budget-minutes 90] [--allow-anytime true|false] [--reset-checkpoint true|false] [--include-bankruptcy true|false]",
  );
}

const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: { application_name: "jurvio-bulk-dockets" },
});

try {
  await sql`SELECT set_config('statement_timeout', '180s', false)`;
  const result = await loadCourtListenerBulkDockets(sql, {
    filePath,
    snapshotDate,
    rowLimit,
    budgetMs: budgetMinutes * 60_000,
    allowAnytime,
    resetCheckpoint,
    includeBankruptcy,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.stopped === "disk") process.exitCode = 2;
} finally {
  await sql.end({ timeout: 5 });
}
