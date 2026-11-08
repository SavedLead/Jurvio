/**
 * Persist the current October Term orders index. Does not download PDFs,
 * write docket entries, or send alerts. Exits cleanly when migration 0201
 * is not applied yet.
 *
 *   tsx scripts/sync-official-scotus-orders.ts
 */
import { closeDb, db } from "@/db/client";
import { syncOfficialOrderIndex } from "@/modules/ingestion/application/ingest-official-scotus-orders";
import { fetchOfficialOrdersIndex } from "@/modules/ingestion/providers/scotus/official-orders";
import { currentOctoberTerm } from "@/modules/scotus/domain/term";

const term = currentOctoberTerm(new Date()).yy;
const index = await fetchOfficialOrdersIndex(term);
const result = await syncOfficialOrderIndex(db(), index.entries, index.retrievedAt);
console.log(JSON.stringify({
  term,
  sourceUri: index.sourceUri,
  retrievedAt: index.retrievedAt,
  contentHash: index.contentHash,
  entries: index.entries.length,
  orderLists: index.entries.filter((entry) => entry.kind === "order_list").length,
  ...result,
  alertsQueued: 0,
}));
await closeDb();
