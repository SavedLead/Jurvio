/**
 * Orders-list monitor. One current-term index read, one opinions-relating-to-orders
 * index read, a conditional recheck of the newest parsed order list, and at most
 * a few new order-list PDFs. Miscellaneous orders are recorded from the index
 * and their PDFs are not fetched. Nothing here writes docket_entry, sends mail,
 * or calls the emergency, live-docket, or slip-opinion jobs.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type postgres from "postgres";
import {
  ORDERS_PARSER_VERSION, chooseOrderListFetches, normalizeOrdersDocket, ordersIndexUrl, ordersTermYear,
  parseOrderListText, parseOrdersIndex, parseRelatingToOrdersIndex, planOrdersWatch, relatingIndexUrl,
  type CaseCandidate, type OrdersKind, type OrdersLabel, type OrdersParseStatus, type OrdersPdfInput,
  type OrdersWatchPlan, type OrdersWrite, type StoredOrdersEntryRef, type StoredOrdersList,
} from "@/modules/scotus/domain/orders-list";
import { FetchBudget } from "./polite-fetcher";

const execFileAsync = promisify(execFile);
const MAX_PDF_BYTES = 8_000_000;

type Sql = ReturnType<typeof postgres>;
type Db = Sql | postgres.TransactionSql;

export interface OrdersRuntime {
  fetchText(url: string): Promise<{ body: string } | { error: string }>;
  fetchPdf(url: string, lastModified: string | null): Promise<
    | { notModified: true }
    | { error: string }
    | { text: string; contentHash: string; lastModified: string | null }
  >;
  loadLists(termYear: number): Promise<StoredOrdersList[]>;
  loadEntries(termYear: number): Promise<StoredOrdersEntryRef[]>;
  loadCandidates(dockets: string[]): Promise<CaseCandidate[]>;
  apply(plan: OrdersWatchPlan, termYear: number): Promise<void>;
}

export interface OrdersRunOptions {
  now?: Date;
  termYear?: number;
  explicitBackfill?: boolean;
  maxPdfs?: number;
}

export async function runScotusOrders(runtime: OrdersRuntime, options: OrdersRunOptions = {}): Promise<OrdersWatchPlan> {
  const now = options.now ?? new Date();
  const termYear = options.termYear ?? ordersTermYear(now);
  const runDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const maxPdfs = Math.min(Math.max(options.maxPdfs ?? 1, 0), 5);
  const explicitBackfill = options.explicitBackfill === true;
  const indexUrl = ordersIndexUrl(termYear);
  const index = await runtime.fetchText(indexUrl);
  if ("error" in index) {
    const plan = planOrdersWatch({
      termYear, runDay, explicitBackfill, ordersIndex: { error: index.error }, relatingIndex: null,
      pdfs: [], stored: [], previousEntries: [], candidates: [],
    });
    await runtime.apply(plan, termYear);
    return plan;
  }

  const parsedIndex = parseOrdersIndex(index.body, termYear, indexUrl);
  const stored = parsedIndex.termMismatch ? [] : await runtime.loadLists(termYear);
  const choice = parsedIndex.termMismatch ? { revalidate: null, downloads: [] } : chooseOrderListFetches(parsedIndex.items, stored);
  const pdfs: OrdersPdfInput[] = [];
  let bodies = 0;
  const consider = async (url: string, lastModified: string | null) => {
    if (bodies >= maxPdfs) return;
    const result = await runtime.fetchPdf(url, lastModified);
    if ("notModified" in result) {
      pdfs.push({ sourceUrl: url, notModified: true });
      return;
    }
    bodies += 1;
    if ("error" in result) pdfs.push({ sourceUrl: url, error: result.error });
    else pdfs.push({ sourceUrl: url, text: result.text, contentHash: result.contentHash, lastModified: result.lastModified });
  };
  if (choice.revalidate) await consider(choice.revalidate.sourceUrl, choice.revalidate.lastModified);
  for (const url of choice.downloads) await consider(url, null);

  const relatingUrl = relatingIndexUrl(termYear);
  const relating = parsedIndex.termMismatch ? null : await runtime.fetchText(relatingUrl);
  const dockets = new Set<string>();
  for (const pdf of pdfs) {
    if (!pdf.text) continue;
    for (const entry of parseOrderListText(pdf.text, pdf.sourceUrl)) {
      const key = normalizeOrdersDocket(entry.docketNumber);
      if (key) dockets.add(key);
    }
  }
  if (relating && "body" in relating) {
    for (const item of parseRelatingToOrdersIndex(relating.body, relatingUrl)) {
      const key = normalizeOrdersDocket(item.docketNumber);
      if (key) dockets.add(key);
    }
  }
  const plan = planOrdersWatch({
    termYear, runDay, explicitBackfill,
    ordersIndex: { html: index.body, pageUrl: indexUrl },
    relatingIndex: relating == null ? null : "error" in relating ? { error: relating.error } : { html: relating.body, pageUrl: relatingUrl },
    pdfs, stored,
    previousEntries: parsedIndex.termMismatch ? [] : await runtime.loadEntries(termYear),
    candidates: dockets.size ? await runtime.loadCandidates([...dockets]) : [],
  });
  await runtime.apply(plan, termYear);
  return plan;
}

export async function extractOrderListText(pdf: Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jurvio-orders-"));
  try {
    const file = join(dir, "order.pdf");
    await writeFile(file, pdf);
    const { stdout } = await execFileAsync("pdftotext", ["-layout", file, "-"], {
      encoding: "utf8", maxBuffer: MAX_PDF_BYTES, timeout: 60_000,
    });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function ordersRuntime(sql: Sql, budget: FetchBudget, extract: (pdf: Uint8Array) => Promise<string> = extractOrderListText): OrdersRuntime {
  return {
    async fetchText(url) {
      try {
        return { body: await budget.text(url, "text/html") };
      } catch (error) {
        return { error: error instanceof Error ? error.message.slice(0, 300) : "fetch failed" };
      }
    },
    async fetchPdf(url, lastModified) {
      try {
        const response = await budget.get(url, "application/pdf", { headers: lastModified ? { "If-Modified-Since": lastModified } : {} });
        if (response.status === 304) return { notModified: true as const };
        if (!response.ok) return { error: `HTTP ${response.status}` };
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_PDF_BYTES || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
          return { error: "response was not a PDF inside the size cap" };
        }
        return {
          text: await extract(bytes),
          contentHash: createHash("sha256").update(bytes).digest("hex"),
          lastModified: response.headers.get("last-modified"),
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message.slice(0, 300) : "pdf fetch failed" };
      }
    },
    loadLists(termYear) {
      return loadOrdersLists(sql, termYear);
    },
    loadEntries(termYear) {
      return loadOrdersEntries(sql, termYear);
    },
    loadCandidates(dockets) {
      return loadOrdersCandidates(sql, dockets);
    },
    apply(plan, termYear) {
      return applyOrdersPlan(sql, plan, termYear);
    },
  };
}

export async function loadOrdersLists(sql: Db, termYear: number): Promise<StoredOrdersList[]> {
  const rows = await sql<{
    source_url: string; content_hash: string; posted_on: string; label: OrdersLabel;
    parse_status: OrdersParseStatus; superseded: boolean; last_modified: string | null;
  }[]>`
    SELECT source_url, content_hash, posted_on::text AS posted_on, label, parse_status,
      superseded_by IS NOT NULL AS superseded, last_modified
    FROM scotus_orders_list WHERE term_year = ${termYear}`;
  return rows.map((row) => ({
    sourceUrl: row.source_url, contentHash: row.content_hash, postedOn: row.posted_on, label: row.label,
    parseStatus: row.parse_status, superseded: row.superseded, lastModified: row.last_modified,
  }));
}

export async function loadOrdersEntries(sql: Db, termYear: number): Promise<StoredOrdersEntryRef[]> {
  const rows = await sql<{ source_url: string; source_record_id: string; docket_number: string | null; kind: OrdersKind }[]>`
    SELECT l.source_url, e.source_record_id, e.docket_number, e.kind
    FROM scotus_orders_entry e
    JOIN scotus_orders_list l ON l.id = e.list_id
    WHERE l.term_year = ${termYear} AND l.superseded_by IS NULL`;
  return rows.map((row) => ({
    sourceUrl: row.source_url, sourceRecordId: row.source_record_id, docketNumber: row.docket_number, kind: row.kind,
  }));
}

export async function loadOrdersCandidates(sql: Db, dockets: readonly string[]): Promise<CaseCandidate[]> {
  if (dockets.length === 0) return [];
  const rows = await sql<{ id: string; docket_number: string; supreme_court_term: number | null }[]>`
    SELECT legal_case.id::text AS id, legal_case.docket_number, legal_case.supreme_court_term
    FROM legal_case
    JOIN court ON court.id = legal_case.court_id
    WHERE lower(court.provider_court_id) = 'scotus'
      AND upper(replace(replace(replace(replace(replace(legal_case.docket_number, '—', '-'), '–', '-'), ' ', ''), ',', ''), '.', ''))
        = ANY(${[...dockets]}::text[])`;
  return rows.map((row) => ({ id: row.id, docketNumber: row.docket_number, supremeCourtTerm: row.supreme_court_term }));
}

/** Persists list rows and coverage. alert_eligible is the literal false, not a value from the plan. */
export async function applyOrdersPlan(sql: Sql, plan: OrdersWatchPlan, termYear: number): Promise<void> {
  await sql.begin(async (tx: postgres.TransactionSql) => {
    const db: Db = tx;
    for (const write of plan.writes) {
      if (write.action === "touch") {
        await db`UPDATE scotus_orders_list SET retrieved_at = now() WHERE source_url = ${write.sourceUrl} AND superseded_by IS NULL`;
        continue;
      }
      const listId = await upsertOrdersList(db, write);
      for (const entry of write.entries) {
        await db`
          INSERT INTO scotus_orders_entry (
            source_record_id, list_id, position, docket_number, section, kind, merits,
            caption, exact_wording, plain_line, author_text, citation, source_url,
            withheld, case_id, match_status, match_candidates, amended_from, backfilled, alert_eligible
          ) VALUES (
            ${entry.sourceRecordId}, ${listId}, ${entry.position}, ${entry.docketNumber}, ${entry.section},
            ${entry.kind}, ${entry.merits}, ${entry.caption}, ${entry.exactWording}, ${entry.plainLine},
            ${entry.authorText}, ${entry.citation}, ${entry.sourceUrl}, ${entry.withheld}, ${entry.caseId},
            ${entry.matchStatus}, ${entry.matchCandidates}, ${entry.amendedFrom}, ${entry.backfilled}, false
          )
          ON CONFLICT (source_record_id) DO NOTHING`;
      }
    }
    const diagnostic = plan.diagnostic;
    const detail = {
      successfulButIncomplete: diagnostic.successfulButIncomplete,
      missed: diagnostic.missed,
      stale: diagnostic.stale,
      failures: diagnostic.failures,
      withheldCount: diagnostic.withheldCount,
    };
    await db`
      INSERT INTO scotus_orders_coverage (
        term_year, run_succeeded, complete, orders_index_known, relating_index_known,
        missed_count, stale_count, failure_count, withheld_count, newest_posted_on, detail, checked_at
      ) VALUES (
        ${termYear}, ${diagnostic.runSucceeded}, ${diagnostic.complete}, ${diagnostic.ordersIndexKnown},
        ${diagnostic.relatingIndexKnown}, ${diagnostic.missed.length}, ${diagnostic.stale.length},
        ${diagnostic.failures.length}, ${diagnostic.withheldCount}, ${diagnostic.newestPostedOn},
        ${db.json(JSON.parse(JSON.stringify(detail)) as postgres.JSONValue)}, now()
      )
      ON CONFLICT (term_year) DO UPDATE SET
        run_succeeded = EXCLUDED.run_succeeded, complete = EXCLUDED.complete,
        orders_index_known = EXCLUDED.orders_index_known, relating_index_known = EXCLUDED.relating_index_known,
        missed_count = EXCLUDED.missed_count, stale_count = EXCLUDED.stale_count,
        failure_count = EXCLUDED.failure_count, withheld_count = EXCLUDED.withheld_count,
        newest_posted_on = EXCLUDED.newest_posted_on, detail = EXCLUDED.detail, checked_at = now()`;
  });
}

async function upsertOrdersList(db: Db, write: Exclude<OrdersWrite, { action: "touch" }>): Promise<string> {
  if (write.action === "update_pending") {
    const [pending] = await db<{ id: string }[]>`
      UPDATE scotus_orders_list SET
        content_hash = ${write.list.contentHash}, parse_status = ${write.list.parseStatus},
        posted_on = ${write.list.postedOn}, backfilled = ${write.list.backfilled},
        last_modified = ${write.list.lastModified}, entry_count = ${write.list.entryCount},
        withheld_count = ${write.list.withheldCount}, parser_version = ${ORDERS_PARSER_VERSION}, retrieved_at = now()
      WHERE source_url = ${write.list.sourceUrl} AND parse_status = 'pending' AND superseded_by IS NULL
      RETURNING id::text AS id`;
    if (pending) return pending.id;
  }
  const [inserted] = await db<{ id: string }[]>`
    INSERT INTO scotus_orders_list (
      source_url, term_year, posted_on, label, content_hash, parse_status, backfilled,
      last_modified, entry_count, withheld_count, parser_version
    ) VALUES (
      ${write.list.sourceUrl}, ${write.list.termYear}, ${write.list.postedOn}, ${write.list.label},
      ${write.list.contentHash}, ${write.list.parseStatus}, ${write.list.backfilled},
      ${write.list.lastModified}, ${write.list.entryCount}, ${write.list.withheldCount}, ${ORDERS_PARSER_VERSION}
    )
    ON CONFLICT (source_url, content_hash) DO UPDATE SET retrieved_at = now()
    RETURNING id::text AS id`;
  if (!inserted) throw new Error("orders list row was not saved");
  if (write.action === "supersede") {
    await db`
      UPDATE scotus_orders_list SET superseded_by = ${inserted.id}::uuid
      WHERE source_url = ${write.list.sourceUrl} AND id <> ${inserted.id}::uuid AND superseded_by IS NULL`;
  }
  return inserted.id;
}
