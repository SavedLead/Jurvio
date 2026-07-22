import { access } from "node:fs/promises";
import {
  courtListenerBulkCourtSchema,
  openBulkCsv,
  parseBulkCsv,
} from "@/modules/ingestion/providers/courtlistener/bulk";

const [filePath] = process.argv.slice(2);
if (!filePath) {
  throw new Error("Usage: pnpm validate:bulk:courts <courts-YYYY-MM-DD.csv.bz2>");
}

await access(filePath);
const source = openBulkCsv(filePath);
let records = 0;

try {
  for await (const court of parseBulkCsv(source.stream, courtListenerBulkCourtSchema)) {
    void court;
    records += 1;
  }
  await source.completion;
  process.stdout.write(`${JSON.stringify({ records })}\n`);
} finally {
  source.close();
}
