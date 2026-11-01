// Back-fill party appearances for federal district cases from the Federal
// Judicial Center Integrated Database.
//
//   pnpm ingest:fjc:parties --file /data/fjc-integrated-database-2026-06-30.csv.bz2 \
//     --snapshot-date 2026-06-30 --filing-year 2019
//
// Download the file first (it is not fetched here, matching the other bulk
// importers):
//   base=https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data
//   wget -c -O /data/fjc-integrated-database-2026-06-30.csv.bz2 \
//     "$base/fjc-integrated-database-2026-06-30.csv.bz2"
//
// The export is a single ~280MB compressed CSV covering every federal civil
// case since the 1970s, so run it one filing year at a time. Every write is
// idempotent (ON CONFLICT on the artifact, the entity identifier, and the
// appearance), so re-running a year is safe and writes nothing new.
import { closeDb, db } from "@/db/client";
import {
  ingestFjcIdbParties,
  recordFjcIdbCheckpoint,
} from "@/modules/ingestion/application/ingest-fjc-idb-parties";

function option(name: string): string | undefined {
  const prefixed = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefixed));
  if (inline) return inline.slice(prefixed.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const usage = "Usage: pnpm ingest:fjc:parties --file <fjc-integrated-database-YYYY-MM-DD.csv.bz2> "
  + "--snapshot-date YYYY-MM-DD [--filing-year YYYY] [--row-limit N] [--batch-size N]";

const filePath = option("file");
const snapshotDate = option("snapshot-date");
if (!filePath || !snapshotDate) throw new Error(usage);

const rawFilingYear = option("filing-year");
const filingYear = rawFilingYear === undefined ? undefined : Number(rawFilingYear);
if (filingYear !== undefined && !Number.isInteger(filingYear)) {
  throw new Error("--filing-year must be an integer year");
}

const rawRowLimit = option("row-limit");
const rowLimit = rawRowLimit === undefined ? undefined : Number(rawRowLimit);
if (rowLimit !== undefined && (!Number.isInteger(rowLimit) || rowLimit < 1)) {
  throw new Error("--row-limit must be a positive integer");
}

const rawBatchSize = option("batch-size");
const batchSize = rawBatchSize === undefined ? undefined : Number(rawBatchSize);
if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
  throw new Error("--batch-size must be a positive integer");
}

const sql = db();

try {
  const result = await ingestFjcIdbParties(sql, {
    filePath,
    snapshotDate,
    filingYear,
    rowLimit,
    batchSize,
  });
  if (filingYear !== undefined) {
    await recordFjcIdbCheckpoint(sql, {
      snapshotDate,
      filingYear,
      result,
      completed: rowLimit === undefined && result.failed === 0,
    });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await closeDb();
}
