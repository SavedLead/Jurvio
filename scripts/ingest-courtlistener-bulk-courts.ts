import { access } from "node:fs/promises";
import { closeDb, db } from "@/db/client";
import { ingestCourtListenerBulkCourts } from "@/modules/ingestion/application/ingest-courtlistener-bulk-courts";

const [filePath, snapshotDate] = process.argv.slice(2);
if (!filePath || !snapshotDate) {
  throw new Error(
    "Usage: pnpm ingest:bulk:courts <courts-YYYY-MM-DD.csv.bz2> <YYYY-MM-DD>",
  );
}

await access(filePath);

try {
  const result = await ingestCourtListenerBulkCourts(db(), filePath, snapshotDate);
  console.log(JSON.stringify(result));
} finally {
  await closeDb();
}
