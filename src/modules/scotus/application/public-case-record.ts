/**
 * Official Supreme Court facts already stored beside the case. Read only.
 * Sealed wording stays out. These tables are not alert inputs.
 */
import type postgres from "postgres";
import { isRestrictedDocketText } from "@/modules/ingestion/domain/federal-stream";

type Sql = ReturnType<typeof postgres>;

const SEALED = String.raw`\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\M`;

export interface ScotusCounselRow {
  side: string;
  name: string;
  firm: string | null;
  counselOfRecord: boolean;
}

export interface ScotusFilingLink {
  sourceUrl: string;
  description: string | null;
  filedOn: string | null;
}

export interface ScotusOrderItem {
  listDate: string;
  label: string;
  sourceUrl: string;
  itemKind: string;
  disposition: string | null;
  body: string | null;
}

export interface ScotusDocketFacts {
  sourceUrl: string | null;
  petitioner: string | null;
  respondent: string | null;
  lowerCourt: string | null;
  lowerCourtDecidedOn: string | null;
  lowerCaseNumbers: string[];
  docketedOn: string | null;
  certStatus: string | null;
  certStatusOn: string | null;
  judgmentOn: string | null;
  lastEntryOn: string | null;
  arguedOn: string | null;
  rearguedOn: string | null;
  counselCount: number;
  filingCount: number;
  orderCount: number;
}

export interface ScotusPublicRecord {
  facts: ScotusDocketFacts;
  counsel: ScotusCounselRow[];
  filings: ScotusFilingLink[];
  orders: ScotusOrderItem[];
}

const EMPTY_FACTS: ScotusDocketFacts = {
  sourceUrl: null, petitioner: null, respondent: null, lowerCourt: null, lowerCourtDecidedOn: null,
  lowerCaseNumbers: [], docketedOn: null, certStatus: null, certStatusOn: null, judgmentOn: null,
  lastEntryOn: null, arguedOn: null, rearguedOn: null, counselCount: 0, filingCount: 0, orderCount: 0,
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

export async function loadScotusPublicRecord(sql: Sql, casePublicId: string): Promise<ScotusPublicRecord> {
  const facts: ScotusDocketFacts = { ...EMPTY_FACTS, lowerCaseNumbers: [] };
  const [header] = await sql<{
    sourceUrl: string | null; petitioner: string | null; respondent: string | null;
    lowerCourt: string | null; lowerCourtDecidedOn: string | null; lowerCaseNumbers: unknown;
    docketedOn: string | null; certStatus: string | null; certStatusOn: string | null;
    judgmentOn: string | null; lastEntryOn: string | null; arguedOn: string | null; rearguedOn: string | null;
  }[]>`
    SELECT
      COALESCE(status.source_url, enrichment.official_docket_url) AS "sourceUrl",
      status.petitioner_title AS petitioner,
      status.respondent_title AS respondent,
      COALESCE(status.lower_court, enrichment.lower_court_name) AS "lowerCourt",
      COALESCE(status.lower_court_decided_on, enrichment.lower_court_decided_on)::text AS "lowerCourtDecidedOn",
      enrichment.lower_court_case_numbers AS "lowerCaseNumbers",
      COALESCE(status.docketed_on, enrichment.docketed_on)::text AS "docketedOn",
      status.cert_status AS "certStatus",
      status.cert_status_on::text AS "certStatusOn",
      status.judgment_on::text AS "judgmentOn",
      status.last_entry_on::text AS "lastEntryOn",
      scdb.argued_on::text AS "arguedOn",
      scdb.reargued_on::text AS "rearguedOn"
    FROM legal_case c
    LEFT JOIN scotus_docket_status status ON status.case_id = c.id
    LEFT JOIN scotus_case_enrichment enrichment ON enrichment.case_id = c.id
    LEFT JOIN scdb_case scdb ON scdb.legal_case_id = c.id
    WHERE c.public_id = ${casePublicId} AND c.publication = 'published'
    LIMIT 1
  `.catch(() => []);
  if (header) {
    facts.sourceUrl = asText(header.sourceUrl);
    facts.petitioner = asText(header.petitioner);
    facts.respondent = asText(header.respondent);
    facts.lowerCourt = asText(header.lowerCourt);
    facts.lowerCourtDecidedOn = asText(header.lowerCourtDecidedOn);
    facts.lowerCaseNumbers = asList(header.lowerCaseNumbers);
    facts.docketedOn = asText(header.docketedOn);
    facts.certStatus = asText(header.certStatus);
    facts.certStatusOn = asText(header.certStatusOn);
    facts.judgmentOn = asText(header.judgmentOn);
    facts.lastEntryOn = asText(header.lastEntryOn);
    facts.arguedOn = asText(header.arguedOn);
    facts.rearguedOn = asText(header.rearguedOn);
  }

  const counsel = await sql<ScotusCounselRow[]>`
    SELECT counsel.side, counsel.name, counsel.firm, counsel.counsel_of_record AS "counselOfRecord"
    FROM scotus_counsel counsel
    JOIN legal_case c ON c.id = counsel.case_id
    WHERE c.public_id = ${casePublicId} AND c.publication = 'published'
      AND counsel.name !~* ${SEALED}
    ORDER BY counsel.side, counsel.counsel_of_record DESC, counsel.name
  `.catch(() => []);
  facts.counselCount = counsel.length;

  const [filingCount] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM scotus_filing_link link
    JOIN legal_case c ON c.id = link.case_id
    WHERE c.public_id = ${casePublicId} AND c.publication = 'published'
      AND coalesce(link.description, '') !~* ${SEALED}
  `.catch(() => [{ n: 0 }]);
  facts.filingCount = filingCount?.n ?? 0;
  const filings = await sql<ScotusFilingLink[]>`
    SELECT link.source_url AS "sourceUrl", link.description, link.filed_on::text AS "filedOn"
    FROM scotus_filing_link link
    JOIN legal_case c ON c.id = link.case_id
    WHERE c.public_id = ${casePublicId} AND c.publication = 'published'
      AND coalesce(link.description, '') !~* ${SEALED}
    ORDER BY link.filed_on DESC NULLS LAST, link.source_url
    LIMIT 200
  `.catch(() => []);

  const [orderCount] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM scotus_order_list_item item
    JOIN legal_case c ON c.publication = 'published' AND c.public_id = ${casePublicId}
      AND (item.case_id = c.id OR lower(item.docket_number) = lower(c.docket_number))
    WHERE coalesce(item.body, '') !~* ${SEALED}
      AND coalesce(item.disposition, '') !~* ${SEALED}
      AND coalesce(item.caption, '') !~* ${SEALED}
  `.catch(() => [{ n: 0 }]);
  facts.orderCount = orderCount?.n ?? 0;
  const orders = await sql<ScotusOrderItem[]>`
    SELECT list.list_date::text AS "listDate", list.label, list.source_url AS "sourceUrl",
      item.item_kind AS "itemKind", item.disposition, item.body
    FROM scotus_order_list_item item
    JOIN scotus_order_list list ON list.source_record_id = item.list_source_record_id
    JOIN legal_case c ON c.publication = 'published' AND c.public_id = ${casePublicId}
      AND (item.case_id = c.id OR lower(item.docket_number) = lower(c.docket_number))
    WHERE coalesce(item.body, '') !~* ${SEALED}
      AND coalesce(item.disposition, '') !~* ${SEALED}
      AND coalesce(item.caption, '') !~* ${SEALED}
    ORDER BY list.list_date DESC, item.source_item_id
    LIMIT 100
  `.catch(() => []);

  return {
    facts,
    counsel: counsel.filter((row) => !isRestrictedDocketText(row.name)),
    filings: filings.filter((row) => !isRestrictedDocketText(row.description ?? "")),
    orders: orders.filter((row) => !isRestrictedDocketText(`${row.disposition ?? ""} ${row.body ?? ""}`)),
  };
}

export function scotusRecordHasFacts(record: ScotusPublicRecord): boolean {
  const facts = record.facts;
  return Boolean(
    facts.petitioner || facts.respondent || facts.lowerCourt || facts.docketedOn || facts.certStatus
    || facts.judgmentOn || facts.arguedOn || facts.lowerCaseNumbers.length
    || record.counsel.length || record.filings.length || record.orders.length,
  );
}
