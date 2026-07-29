import { access } from "node:fs/promises";
import { closeDb, db } from "@/db/client";
import { ingestCourtListenerBulkFederalDockets } from "@/modules/ingestion/application/ingest-courtlistener-bulk-federal-dockets";

function option(name: string): string | undefined {
  const equals = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (equals) return equals.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const filePath = option("file");
const snapshotDate = option("snapshot-date");
const year = Number(option("year"));
const includeBankruptcy = option("include-bankruptcy") !== "false";
const rowLimit = option("row-limit") ? Number(option("row-limit")) : undefined;
const jurisdiction = option("jurisdiction")?.trim().toUpperCase();

if (!filePath || !snapshotDate || !Number.isInteger(year)) {
  throw new Error(
    "Usage: pnpm ingest:bulk:federal-dockets --file <dockets.csv.bz2> --snapshot-date YYYY-MM-DD --year YYYY [--jurisdiction F|FD|FB] [--include-bankruptcy true|false] [--row-limit N]",
  );
}
if (jurisdiction && !["F", "FD", "FB"].includes(jurisdiction)) {
  throw new Error("--jurisdiction must be F, FD, or FB");
}
await access(filePath);

try {
  const result = await ingestCourtListenerBulkFederalDockets(db(), {
    filePath,
    snapshotDate,
    year,
    includeBankruptcy,
    jurisdiction: jurisdiction as "F" | "FD" | "FB" | undefined,
    rowLimit,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.failed > 0) process.exitCode = 1;
} finally {
  await closeDb();
}
