/**
 * Parse a few official order-list PDFs into scotus_order_list_item.
 * Dry-run unless CONFIRM=LOAD_ORDER_PDFS. Does not write docket entries or alerts.
 * Needs pdftotext. Refuses to invent text when the converter is missing.
 *
 *   pnpm exec tsx scripts/load-scotus-order-pdfs.ts --limit=1
 *   CONFIRM=LOAD_ORDER_PDFS pnpm exec tsx scripts/load-scotus-order-pdfs.ts --limit=1 --apply=1
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { closeDb, db } from "@/db/client";
import { ingestOfficialOrderLists } from "@/modules/ingestion/application/ingest-official-scotus-orders";
import { fetchOfficialOrdersIndex } from "@/modules/ingestion/providers/scotus/official-orders";
import { parseOrderListText } from "@/modules/ingestion/providers/scotus/order-list-text";
import { currentOctoberTerm } from "@/modules/scotus/domain/term";

const exec = promisify(execFile);
const limit = Math.min(3, Math.max(1, Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? "1")));
const apply = process.argv.includes("--apply=1");
if (apply && process.env.CONFIRM !== "LOAD_ORDER_PDFS") throw new Error("Set CONFIRM=LOAD_ORDER_PDFS to store rows");

try {
  await exec("pdftotext", ["-v"]);
} catch {
  console.log(JSON.stringify({ skipped: "pdftotext is not installed", stored: 0 }));
  process.exit(apply ? 1 : 0);
}

const term = currentOctoberTerm(new Date()).yy;
const index = await fetchOfficialOrdersIndex(term);
const lists = index.entries.filter((entry) => entry.kind === "order_list").slice(0, limit);
const dir = await mkdtemp(join(tmpdir(), "scotus-orders-"));
const prepared = [];
for (const entry of lists) {
  const response = await fetch(entry.sourceUrl, { headers: { "user-agent": "Jurvio/0.1" }, redirect: "error" });
  if (!response.ok) throw new Error(`${entry.sourceUrl} returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const path = join(dir, "list.pdf");
  await writeFile(path, bytes);
  const { stdout } = await exec("pdftotext", ["-layout", path, "-"], { encoding: "utf8", maxBuffer: 8_000_000 });
  const parsed = parseOrderListText(stdout);
  prepared.push({ entry, indexRetrievedAt: index.retrievedAt, pdf: { bytes, retrievedAt: new Date().toISOString(), text: stdout } });
  console.log(JSON.stringify({ url: entry.sourceUrl, items: parsed.items.length, withheld: parsed.withheld }));
}
if (!apply) {
  console.log(JSON.stringify({ dryRun: true, lists: prepared.length, alertsQueued: 0 }));
} else {
  const result = await ingestOfficialOrderLists(db(), prepared);
  console.log(JSON.stringify({ dryRun: false, ...result }));
  await closeDb();
}
await rm(dir, { recursive: true, force: true });
