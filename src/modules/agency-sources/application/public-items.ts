import type postgres from "postgres";
import type { ItemDocument, KeyDate } from "../domain/item";

type Sql = ReturnType<typeof postgres>;

export interface CaseAgencyItem {
  title: string;
  itemKind: string;
  publisher: string;
  sourceName: string;
  issuingOffice: string | null;
  publishedAt: string | null;
  officialExcerpt: string | null;
  sourceUrl: string;
  documents: ItemDocument[];
  keyDates: KeyDate[];
  settlementAmount: string | null;
  docketNumber: string;
  courtCode: string;
}

/**
 * Official agency items linked to one published case: exact court + docket match only,
 * never restricted items. Newest first, at most 12.
 */
export async function listCaseAgencyItems(sql: Sql, casePublicId: string): Promise<CaseAgencyItem[]> {
  return sql<CaseAgencyItem[]>`
    SELECT DISTINCT ON (item.id)
      item.title, item.item_kind AS "itemKind", source.publisher, source.name AS "sourceName",
      item.issuing_office AS "issuingOffice", item.published_at::text AS "publishedAt",
      item.official_excerpt AS "officialExcerpt", item.source_url AS "sourceUrl",
      item.documents, item.key_dates AS "keyDates", item.settlement_amount AS "settlementAmount",
      ref.docket_number AS "docketNumber", ref.court_code AS "courtCode"
    FROM legal_case
    JOIN agency_item_case_ref ref ON ref.case_id = legal_case.id AND ref.match_status = 'matched'
    JOIN agency_source_item item ON item.id = ref.item_id
    JOIN agency_source source ON source.code = item.source_code
    WHERE legal_case.public_id = ${casePublicId} AND legal_case.publication = 'published'
      AND item.review_status = 'linked' AND NOT item.restricted
    ORDER BY item.id, item.published_at DESC NULLS LAST
    LIMIT 12
  `.then((rows) => [...rows].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")));
}
