import { createHash } from "node:crypto";
import type postgres from "postgres";
import type { AgencyItem, AgencySourceDefinition } from "../domain/item";
import { findDistrictDockets } from "../domain/district-docket";
import { matchDistrictCase } from "./match";

type Sql = ReturnType<typeof postgres>;

export async function registerSources(sql: Sql, definitions: readonly AgencySourceDefinition[]): Promise<void> {
  for (const source of definitions) {
    await sql`
      INSERT INTO agency_source (code, name, agency_kind, jurisdiction, publisher, home_url, feed_url, enabled, last_status, last_error)
      VALUES (${source.code}, ${source.name}, ${source.agencyKind}, ${source.jurisdiction}, ${source.publisher}, ${source.homeUrl},
        ${source.feedUrl}, ${source.enabled}, ${source.enabled ? null : "not_polled"}, ${source.disabledReason ?? null})
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, agency_kind = EXCLUDED.agency_kind, jurisdiction = EXCLUDED.jurisdiction,
        publisher = EXCLUDED.publisher, home_url = EXCLUDED.home_url, feed_url = EXCLUDED.feed_url, enabled = EXCLUDED.enabled,
        last_status = CASE WHEN EXCLUDED.enabled THEN agency_source.last_status ELSE 'not_polled' END,
        last_error = CASE WHEN EXCLUDED.enabled THEN agency_source.last_error ELSE EXCLUDED.last_error END,
        updated_at = now()
    `;
  }
}

export async function knownRecords(sql: Sql, sourceCode: string, recordIds: readonly string[]): Promise<Map<string, string | null>> {
  if (recordIds.length === 0) return new Map();
  const rows = await sql<{ source_record_id: string; change_key: string | null }[]>`
    SELECT source_record_id, change_key FROM agency_source_item
    WHERE source_code = ${sourceCode} AND source_record_id = ANY(${[...recordIds]}::text[])
  `;
  return new Map(rows.map((row) => [row.source_record_id, row.change_key]));
}

export interface SaveCounts { isNew: boolean; refs: number; matched: number; queued: boolean; restricted: boolean }

function contentHash(item: AgencyItem): string {
  return createHash("sha256").update(JSON.stringify([item.title, item.officialExcerpt, item.documents, item.keyDates,
    item.settlementAmount, item.references.map((ref) => [ref.docket.canonical, ref.courtCode]), item.restrictedReason])).digest("hex");
}

function itemText(item: AgencyItem): string {
  return [item.title, item.officialExcerpt ?? "", ...item.documents.map((document) => document.label), item.matchText ?? ""].join("\n");
}

/** Store one item and its stated court references, then match each reference. Idempotent. */
export async function saveItem(sql: Sql, item: AgencyItem): Promise<SaveCounts> {
  if (!item.sourceUrl.startsWith("https://")) throw new Error(`refusing non-https source URL ${item.sourceUrl}`);
  const hash = contentHash(item);
  const restricted = Boolean(item.restrictedReason);
  return sql.begin(async (tx) => {
    const [row] = await tx<{ id: string; inserted: boolean; unchanged: boolean }[]>`
      INSERT INTO agency_source_item (source_code, source_record_id, source_url, title, item_kind, issuing_office, published_at,
        official_excerpt, documents, key_dates, settlement_amount, restricted, restricted_reason, review_status, content_hash, change_key)
      VALUES (${item.sourceCode}, ${item.sourceRecordId}, ${item.sourceUrl}, ${item.title.slice(0, 1000)}, ${item.itemKind},
        ${item.issuingOffice}, ${item.publishedAt}, ${item.officialExcerpt}, ${tx.json(item.documents as unknown as postgres.JSONValue)},
        ${tx.json(item.keyDates as unknown as postgres.JSONValue)}, ${item.settlementAmount}, ${restricted}, ${item.restrictedReason},
        ${item.notCourt ? "not_court" : "queued"}, ${hash}, ${item.changeKey ?? null})
      ON CONFLICT (source_code, source_record_id) DO UPDATE SET
        source_url = EXCLUDED.source_url, title = EXCLUDED.title, item_kind = EXCLUDED.item_kind, issuing_office = EXCLUDED.issuing_office,
        published_at = coalesce(EXCLUDED.published_at, agency_source_item.published_at), official_excerpt = EXCLUDED.official_excerpt,
        documents = EXCLUDED.documents, key_dates = EXCLUDED.key_dates, settlement_amount = EXCLUDED.settlement_amount,
        restricted = EXCLUDED.restricted, restricted_reason = EXCLUDED.restricted_reason, content_hash = EXCLUDED.content_hash,
        change_key = EXCLUDED.change_key,
        review_status = CASE WHEN EXCLUDED.restricted THEN 'queued' ELSE agency_source_item.review_status END,
        updated_at = now()
      RETURNING id, (xmax = 0) AS inserted, false AS unchanged
    `;
    if (!row) throw new Error("agency item not persisted");
    let matched = 0;
    const text = itemText(item);
    for (const reference of item.references) {
      const result = restricted ? { status: "unmatched" as const, caseId: null, note: "item is restricted" }
        : await matchDistrictCase(tx as unknown as Sql, reference.courtCode, reference.docket, text);
      if (result.status === "matched") matched += 1;
      await tx`
        INSERT INTO agency_item_case_ref (item_id, docket_number, court_code, court_evidence, match_status, case_id, match_note, matched_at, checked_at)
        VALUES (${row.id}, ${reference.docket.canonical}, ${reference.courtCode}, ${reference.courtEvidence?.slice(0, 300) ?? null},
          ${result.status}, ${result.caseId}, ${"note" in result ? result.note ?? null : null},
          ${result.status === "matched" ? tx`now()` : null}, now())
        ON CONFLICT (item_id, docket_number, court_code) DO UPDATE SET court_evidence = EXCLUDED.court_evidence,
          match_status = EXCLUDED.match_status, case_id = EXCLUDED.case_id, match_note = EXCLUDED.match_note,
          matched_at = coalesce(agency_item_case_ref.matched_at, EXCLUDED.matched_at), checked_at = now()
      `;
    }
    if (!item.notCourt) {
      await tx`
        UPDATE agency_source_item SET review_status = ${!restricted && matched > 0 ? "linked" : "queued"}
        WHERE id = ${row.id} AND review_status <> 'rejected'
      `;
    }
    return { isNew: row.inserted, refs: item.references.length, matched, queued: !item.notCourt && (restricted || matched === 0), restricted };
  });
}

/**
 * Re-check references that did not match: the case may have been ingested since.
 * Bounded per run; oldest check first.
 */
export async function recheckUnmatched(sql: Sql, limit = 300): Promise<{ checked: number; newlyMatched: number }> {
  const refs = await sql<{ id: string; item_id: string; docket_number: string; court_code: string; text: string }[]>`
    SELECT ref.id, ref.item_id, ref.docket_number, ref.court_code,
      concat_ws(E'\n', item.title, item.official_excerpt, (SELECT string_agg(doc->>'label', E'\n') FROM jsonb_array_elements(item.documents) doc)) AS text
    FROM agency_item_case_ref ref JOIN agency_source_item item ON item.id = ref.item_id
    WHERE ref.match_status = 'unmatched' AND ref.court_code IS NOT NULL AND NOT item.restricted
      AND ref.checked_at < now() - interval '6 hours' AND item.first_seen_at > now() - interval '180 days'
    ORDER BY ref.checked_at LIMIT ${limit}
  `;
  let newlyMatched = 0;
  for (const ref of refs) {
    const docket = findDistrictDockets(ref.docket_number)[0];
    if (!docket) continue;
    const result = await matchDistrictCase(sql, ref.court_code, docket, ref.text);
    await sql`
      UPDATE agency_item_case_ref SET match_status = ${result.status}, case_id = ${result.caseId},
        match_note = ${"note" in result ? result.note ?? null : null}, checked_at = now(),
        matched_at = CASE WHEN ${result.status} = 'matched' THEN now() ELSE matched_at END
      WHERE id = ${ref.id}
    `;
    if (result.status === "matched") {
      newlyMatched += 1;
      await sql`UPDATE agency_source_item SET review_status = 'linked', updated_at = now() WHERE id = ${ref.item_id} AND review_status = 'queued' AND NOT restricted`;
    }
  }
  return { checked: refs.length, newlyMatched };
}
