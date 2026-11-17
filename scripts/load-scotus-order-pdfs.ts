/**
 * Parse a few official order-list PDFs into scotus_order_list_item.
 * Does not write docket entries or send alerts. Needs pdftotext.
 * Refuses to invent text when the converter is missing.
 *
 * Picks order lists whose PDF has not been stored, newest first.
 * The scheduler runs `--apply=1 --limit=30` once an hour on the core worker.
 * Each request to supremecourt.gov waits at least five seconds after the previous one.
 *
 *   pnpm exec tsx scripts/load-scotus-order-pdfs.ts --limit=1
 *   pnpm exec tsx scripts/load-scotus-order-pdfs.ts --limit=30 --apply=1
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { closeDb, db } from "@/db/client";
import { ingestOfficialOrderLists, ORDER_INGEST_ALERTS_ENABLED, syncOfficialOrderIndex } from "@/modules/ingestion/application/ingest-official-scotus-orders";
import { fetchOfficialOrdersIndex, type OfficialOrderIndexEntry } from "@/modules/ingestion/providers/scotus/official-orders";
import { parseOrderListText } from "@/modules/ingestion/providers/scotus/order-list-text";
import { currentOctoberTerm } from "@/modules/scotus/domain/term";

const exec = promisify(execFile);
const COURT_GAP_MS = 5_000;
const limit = Math.min(30, Math.max(1, Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? "30")));
const apply = process.argv.includes("--apply=1");
if (ORDER_INGEST_ALERTS_ENABLED) throw new Error("Order ingestion must not enable alerts");

let lastCourtRequestAt = 0;
async function waitForCourt() {
  const wait = lastCourtRequestAt === 0 ? 0 : COURT_GAP_MS - (Date.now() - lastCourtRequestAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
const courtFetch: typeof fetch = async (input, init) => {
  await waitForCourt();
  return fetch(input, init);
};
function courtRequestFinished() {
  lastCourtRequestAt = Date.now();
}

try {
  await exec("pdftotext", ["-v"]);
} catch {
  console.log(JSON.stringify({ skipped: "pdftotext is not installed", stored: 0, alertsQueued: 0 }));
  process.exit(0);
}

const currentTerm = currentOctoberTerm(new Date()).yy;

function earlierTerm(yy: string): string | null {
  const year = Number(yy);
  // Two-digit terms walk 26, 25, ... and stop at 00. They do not wrap to 99.
  if (!Number.isInteger(year) || year <= 0) return null;
  return String(year - 1).padStart(2, "0");
}

const index = await fetchOfficialOrdersIndex(currentTerm, courtFetch);
courtRequestFinished();
if (apply) {
  const synced = await syncOfficialOrderIndex(db(), index.entries, index.retrievedAt);
  if (synced.skipped) {
    console.log(JSON.stringify({ skipped: "migration 0201 is not applied", indexEntries: index.entries.length, alertsQueued: 0 }));
    await closeDb();
    process.exit(0);
  }
  // One older term per run, and only after the newer term has no unstored order list.
  // The orders index still publishes lists before the slip-opinion era. A term
  // whose page has no order-list PDF is the end of that walk.
  const [openTerm] = (await db()`
    SELECT term_year FROM scotus_order_list
    WHERE list_kind = 'order_list' AND pdf_sha256 IS NULL AND term_year >= '00' AND term_year <= ${currentTerm}
    ORDER BY term_year DESC
    LIMIT 1`) as { term_year: string }[];
  if (!openTerm) {
    const [oldest] = (await db()`
      SELECT min(term_year) AS term_year FROM (
        SELECT term_year FROM scotus_order_list WHERE term_year >= '00' AND term_year <= ${currentTerm}
        UNION
        SELECT term_year FROM scotus_orders_index_probe WHERE term_year >= '00' AND term_year <= ${currentTerm}
      ) seen`) as { term_year: string | null }[];
    const next = earlierTerm(oldest?.term_year ?? currentTerm);
    if (next) {
      const older = await fetchOfficialOrdersIndex(next, courtFetch);
      courtRequestFinished();
      const orderLists = older.entries.filter((entry) => entry.kind === "order_list");
      if (orderLists.length === 0) {
        await db()`
          INSERT INTO scotus_orders_index_probe (term_year, order_lists, probed_at)
          VALUES (${next}, 0, now())
          ON CONFLICT (term_year) DO UPDATE SET order_lists = 0, probed_at = now()`;
        console.log(JSON.stringify({ probed: next, orderLists: 0, alertsQueued: 0 }));
      } else {
        await syncOfficialOrderIndex(db(), older.entries, older.retrievedAt);
      }
    }
  }
}

type StoredList = {
  source_record_id: string; source_url: string; term_year: string; list_date: string;
  label: string; amended: boolean; index_entry_hash: string; index_retrieved_at: string;
};
const stored = (apply ? await db()`
  SELECT source_record_id, source_url, term_year, list_date::text AS list_date, label, amended, index_entry_hash,
    index_retrieved_at::text AS index_retrieved_at
  FROM scotus_order_list
  WHERE list_kind = 'order_list' AND pdf_sha256 IS NULL AND term_year >= '00' AND term_year <= ${currentTerm}
  ORDER BY term_year DESC, list_date DESC
  LIMIT ${limit}` : []) as StoredList[];

const byId = new Map(index.entries.map((entry) => [entry.sourceRecordId, entry]));
const retrievedAt = new Map(stored.map((row) => [row.source_record_id, row.index_retrieved_at]));
const targets: OfficialOrderIndexEntry[] = stored.map((row) => byId.get(row.source_record_id) ?? {
  sourceRecordId: row.source_record_id,
  termYear: row.term_year,
  listDate: row.list_date,
  label: row.label,
  kind: "order_list" as const,
  amended: row.amended,
  sourceUrl: row.source_url,
  indexEntryHash: row.index_entry_hash,
});
const fallback = index.entries.filter((entry) => entry.kind === "order_list").slice(-limit).reverse();
const chosen = targets.length ? targets : apply ? [] : fallback;

const dir = await mkdtemp(join(tmpdir(), "scotus-orders-"));
const prepared = [];
for (const entry of chosen) {
  const response = await courtFetch(entry.sourceUrl, { headers: { "user-agent": "Jurvio/0.1" }, redirect: "error" });
  if (!response.ok) throw new Error(`${entry.sourceUrl} returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  courtRequestFinished();
  if (bytes.byteLength > 15_000_000) throw new Error("Order list PDF exceeds 15MB");
  const path = join(dir, "list.pdf");
  await writeFile(path, bytes);
  const { stdout } = await exec("pdftotext", ["-layout", path, "-"], { encoding: "utf8", maxBuffer: 8_000_000 });
  const parsed = parseOrderListText(stdout);
  prepared.push({
    entry,
    indexRetrievedAt: retrievedAt.get(entry.sourceRecordId) ?? index.retrievedAt,
    pdf: { bytes, retrievedAt: new Date().toISOString(), text: stdout },
  });
  console.log(JSON.stringify({ url: entry.sourceUrl, items: parsed.items.length, withheld: parsed.withheld, alertsQueued: 0 }));
}
if (!apply) {
  console.log(JSON.stringify({ dryRun: true, lists: prepared.length, alertsQueued: 0 }));
} else if (prepared.length) {
  const result = await ingestOfficialOrderLists(db(), prepared);
  console.log(JSON.stringify({ dryRun: false, ...result }));
} else {
  console.log(JSON.stringify({ dryRun: false, lists: 0, items: 0, withheld: 0, alertsQueued: 0 }));
}
await rm(dir, { recursive: true, force: true });
if (apply) await closeDb();
