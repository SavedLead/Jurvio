import postgres from "postgres";
import { env } from "@/lib/config/env";
import { loadCourtListenerBulkClusters } from "@/modules/ingestion/application/bulk-cluster-load";
import { openBulkCsv } from "@/modules/ingestion/providers/courtlistener/bulk";
import { openBulkCsvFromUrl, readBulkOpinionClusters } from "@/modules/ingestion/providers/courtlistener/bulk-opinions";

function option(name: string): string | undefined {
  const equals = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (equals) return equals.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const url = option("url");
const filePath = option("file");
const snapshotDate = option("snapshot-date");
const rowLimit = Number(option("row-limit") ?? "100000");
const budgetMinutes = Number(option("budget-minutes") ?? "90");
const allowAnytime = option("allow-anytime") === "true";
const resetCheckpoint = option("reset-checkpoint") === "true";
const diskPath = option("disk-path") ?? "/var/lib/jurvio/artifacts";

if ((!url && !filePath) || !snapshotDate) {
  throw new Error(
    "Usage: node jobs/load-courtlistener-bulk-clusters.mjs (--url <opinion-clusters.csv.bz2 URL> | --file <path>) --snapshot-date YYYY-MM-DD [--row-limit 100000] [--budget-minutes 90] [--allow-anytime true|false] [--reset-checkpoint true|false] [--disk-path /var/lib/jurvio/artifacts]",
  );
}
if (!Number.isFinite(budgetMinutes) || budgetMinutes <= 0 || budgetMinutes > 90) {
  throw new Error("--budget-minutes must be 1-90");
}

const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: { application_name: "jurvio-bulk-clusters" },
});

try {
  await sql`SELECT set_config('statement_timeout', '180s', false)`;
  // Streamed straight from S3 through bzip2 (resuming dropped connections with Range).
  // Opened lazily: a finished snapshot only resolves pending clusters and never
  // starts the 2.5 GB download.
  const result = await loadCourtListenerBulkClusters(sql, {
    openClusters: () => readBulkOpinionClusters(url ? openBulkCsvFromUrl(url) : openBulkCsv(filePath!)),
    snapshotDate,
    rowLimit,
    budgetMs: budgetMinutes * 60_000,
    allowAnytime,
    resetCheckpoint,
    diskPath,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.stopped === "disk") process.exitCode = 2;
} finally {
  await sql.end({ timeout: 5 });
}
