/**
 * Store official order-list rows. This module does not write docket_entry,
 * direct_court_event, or any alert table. History and backfill therefore
 * cannot notify subscribers. New feed alerts stay off until a later,
 * separately tested path projects a row into the docket.
 */
import { createHash } from "node:crypto";
import type postgres from "postgres";
import type { OfficialOrderIndexEntry, RelatingToOrdersOpinion } from "../providers/scotus/official-orders";
import {
  ORDER_LIST_PARSER_VERSION,
  parseOrderListText,
  type ParsedOrderListItem,
} from "../providers/scotus/order-list-text";

type Sql = ReturnType<typeof postgres>;

/** Order ingestion never queues subscriber alerts. */
export const ORDER_INGEST_ALERTS_ENABLED = false;

export interface OrderListIngest {
  entry: OfficialOrderIndexEntry;
  /** When the orders index HTML that produced `entry` was fetched. */
  indexRetrievedAt: string;
  /** PDF bytes actually retrieved. Absent for an index-only row. */
  pdf?: { bytes: Uint8Array; retrievedAt: string; text: string | null };
  relating?: RelatingToOrdersOpinion[];
}

export interface OrderIngestResult {
  lists: number;
  items: number;
  withheld: number;
  alertsQueued: 0;
}

function pdfHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Upsert index rows only. No PDF download, no docket entries, no alerts. */
export async function syncOfficialOrderIndex(
  sql: Sql,
  entries: readonly OfficialOrderIndexEntry[],
  indexRetrievedAt: string,
): Promise<{ lists: number; skipped: boolean }> {
  if (ORDER_INGEST_ALERTS_ENABLED) throw new Error("Order ingestion must not enable alerts");
  if (Number.isNaN(Date.parse(indexRetrievedAt))) throw new Error("Order index retrieval time is missing");
  const [table] = await sql<{ present: string | null }[]>`SELECT to_regclass('scotus_order_list')::text AS present`;
  if (!table?.present) return { lists: 0, skipped: true };
  for (const entry of entries) {
    await sql`
      INSERT INTO scotus_order_list (
        source_record_id, term_year, source_url, list_date, list_kind, label, amended,
        index_entry_hash, index_retrieved_at, withheld_items, parser_version
      ) VALUES (
        ${entry.sourceRecordId}, ${entry.termYear}, ${entry.sourceUrl}, ${entry.listDate},
        ${entry.kind}, ${entry.label}, ${entry.amended}, ${entry.indexEntryHash},
        ${indexRetrievedAt}, 0, ${ORDER_LIST_PARSER_VERSION}
      )
      ON CONFLICT (source_record_id) DO UPDATE SET
        label = EXCLUDED.label,
        amended = EXCLUDED.amended,
        index_entry_hash = EXCLUDED.index_entry_hash,
        index_retrieved_at = EXCLUDED.index_retrieved_at,
        updated_at = now()
    `;
  }
  return { lists: entries.length, skipped: false };
}

export async function ingestOfficialOrderLists(sql: Sql, lists: readonly OrderListIngest[]): Promise<OrderIngestResult> {
  if (ORDER_INGEST_ALERTS_ENABLED) throw new Error("Order ingestion must not enable alerts");
  let items = 0;
  let withheld = 0;
  for (const list of lists) {
    if (Number.isNaN(Date.parse(list.indexRetrievedAt))) throw new Error("Order index retrieval time is missing");
    const parsed = list.pdf?.text ? parseOrderListText(list.pdf.text) : { items: [] as ParsedOrderListItem[], withheld: 0 };
    withheld += parsed.withheld;
    const pdfSha = list.pdf ? pdfHash(list.pdf.bytes) : null;
    if (list.pdf && (!pdfSha || Number.isNaN(Date.parse(list.pdf.retrievedAt)))) {
      throw new Error("Refusing to store a PDF without its bytes and retrieval time");
    }
    const relating = (list.relating ?? []).filter((opinion) => opinion.listDate === list.entry.listDate);
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO scotus_order_list (
          source_record_id, term_year, source_url, list_date, list_kind, label, amended,
          index_entry_hash, index_retrieved_at, pdf_sha256, pdf_retrieved_at, withheld_items, parser_version
        ) VALUES (
          ${list.entry.sourceRecordId}, ${list.entry.termYear}, ${list.entry.sourceUrl}, ${list.entry.listDate},
          ${list.entry.kind}, ${list.entry.label}, ${list.entry.amended}, ${list.entry.indexEntryHash},
          ${list.indexRetrievedAt}, ${pdfSha}, ${list.pdf?.retrievedAt ?? null}, ${parsed.withheld}, ${ORDER_LIST_PARSER_VERSION}
        )
        ON CONFLICT (source_record_id) DO UPDATE SET
          label = EXCLUDED.label,
          amended = EXCLUDED.amended,
          index_entry_hash = EXCLUDED.index_entry_hash,
          index_retrieved_at = EXCLUDED.index_retrieved_at,
          pdf_sha256 = COALESCE(scotus_order_list.pdf_sha256, EXCLUDED.pdf_sha256),
          pdf_retrieved_at = COALESCE(scotus_order_list.pdf_retrieved_at, EXCLUDED.pdf_retrieved_at),
          withheld_items = EXCLUDED.withheld_items,
          parser_version = EXCLUDED.parser_version,
          updated_at = now()
      `;
      await tx`DELETE FROM scotus_order_list_item WHERE list_source_record_id = ${list.entry.sourceRecordId}`;
      for (const item of parsed.items) {
        const matches = await tx<{ id: string }[]>`
          SELECT legal_case.id
          FROM legal_case
          JOIN court ON court.id = legal_case.court_id
          WHERE lower(court.provider_court_id) = 'scotus'
            AND lower(legal_case.docket_number) = lower(${item.docketNumber})
            AND legal_case.publication IN ('draft', 'published')
          LIMIT 2
        `;
        const caseId = matches.length === 1 ? matches[0]!.id : null;
        await tx`
          INSERT INTO scotus_order_list_item (
            list_source_record_id, source_item_id, docket_number, caption, section,
            item_kind, disposition, writing_kind, body, source_url, case_id
          ) VALUES (
            ${list.entry.sourceRecordId}, ${item.sourceItemId}, ${item.docketNumber}, ${item.caption},
            ${item.section}, ${item.itemKind}, ${item.disposition}, ${item.writingKind}, ${item.body},
            ${list.entry.sourceUrl}, ${caseId}
          )
        `;
        items += 1;
      }
      for (const opinion of relating) {
        if (opinion.docketNumber.toUpperCase() !== opinion.docketNumber) continue;
        await tx`
          INSERT INTO scotus_order_list_item (
            list_source_record_id, source_item_id, docket_number, caption, section,
            item_kind, disposition, writing_kind, body, source_url, case_id
          ) VALUES (
            ${list.entry.sourceRecordId}, ${`relating:${opinion.docketNumber}`}, ${opinion.docketNumber},
            ${opinion.caseName}, 'RELATING TO ORDERS', 'separate_writing', NULL, 'separate_opinion',
            NULL, ${opinion.sourceUrl}, NULL
          )
          ON CONFLICT (list_source_record_id, source_item_id) DO NOTHING
        `;
        if (opinion.revision) {
          await tx`
            INSERT INTO scotus_order_list_item (
              list_source_record_id, source_item_id, docket_number, caption, section,
              item_kind, disposition, writing_kind, body, source_url, case_id
            ) VALUES (
              ${list.entry.sourceRecordId}, ${`relating:${opinion.docketNumber}:revision`}, ${opinion.docketNumber},
              ${opinion.caseName}, 'RELATING TO ORDERS', 'separate_writing', NULL, 'separate_opinion',
              NULL, ${opinion.revision.sourceUrl}, NULL
            )
            ON CONFLICT (list_source_record_id, source_item_id) DO NOTHING
          `;
        }
      }
    });
  }
  return { lists: lists.length, items, alertsQueued: 0, withheld };
}
