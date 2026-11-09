import type postgres from "postgres";
import { siteOrigin } from "@/lib/config/site-url";
import { isRestrictedDocketText } from "@/modules/ingestion/domain/federal-stream";
import { visibleSql } from "./emergency-docket";
import type { ActivityFeedItem } from "../domain/activity-feed";

type Sql = ReturnType<typeof postgres>;
type Queryable = Sql | postgres.TransactionSql<Record<string, never>>;

function stamp(value: string | null): string {
  if (!value) return new Date(0).toISOString();
  const parsed = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed) ? new Date(0).toISOString() : new Date(parsed).toISOString();
}

export async function listScotusActivity(sql: Sql): Promise<ActivityFeedItem[]> {
  return sql.begin(async (tx) => listScotusActivityIn(tx));
}

async function listScotusActivityIn(sql: Queryable): Promise<ActivityFeedItem[]> {
  const origin = siteOrigin();
  await sql`SET LOCAL statement_timeout = '4s'`;
  const entries = await sql<{ id: string; filed_on: string; docket_number: string; caption: string; description: string; public_id: string }[]>`
      SELECT e.id::text, e.filed_on::text, c.docket_number, c.caption, left(e.description, 240) AS description, c.public_id
      FROM docket_entry e
      JOIN legal_case c ON c.id = e.case_id
      JOIN court ct ON ct.id = c.court_id
      WHERE lower(ct.provider_court_id) = 'scotus' AND c.publication = 'published' AND e.filed_on IS NOT NULL
      ORDER BY e.filed_on DESC, e.id DESC
      LIMIT 15`;
  const opinions = await sql<{ id: string; filed_on: string | null; docket_number: string; caption: string; title: string; public_id: string; document_id: string }[]>`
      SELECT d.id::text, cl.date_filed::text AS filed_on, c.docket_number, c.caption, d.title, c.public_id, d.public_id AS document_id
      FROM document d
      JOIN legal_case c ON c.id = d.case_id
      JOIN court ct ON ct.id = c.court_id
      JOIN judicial_opinion j ON j.document_id = d.id
      JOIN opinion_cluster cl ON cl.id = j.cluster_id
      WHERE lower(ct.provider_court_id) = 'scotus' AND c.publication = 'published' AND d.publication = 'published'
      ORDER BY cl.date_filed DESC NULLS LAST
      LIMIT 10`;
  const emergency = await sql<{ docket_number: string; caption: string; status: string; last_entry_on: string | null; kind: string }[]>`
      SELECT docket_number, caption, status::text, coalesce(last_entry_on, submitted_on)::text AS last_entry_on, kind::text
      FROM scotus_application a
      WHERE ${sql.unsafe(visibleSql("a"))} AND a.kind <> 'extension' AND a.source_lane = 'live'
      ORDER BY coalesce(a.last_entry_on, a.submitted_on) DESC NULLS LAST
      LIMIT 15`;
  const orders = await listOrderItems(sql);
  const items: ActivityFeedItem[] = [
    ...entries.map((row) => ({
      id: `${origin}/feeds/scotus#docket-${row.id}`,
      title: `${row.docket_number}: ${row.caption}`,
      url: `${origin}/case/${row.public_id}`,
      updated: stamp(row.filed_on),
      summary: row.description,
      category: "docket-entry",
    })),
    ...opinions.map((row) => ({
      id: `${origin}/feeds/scotus#opinion-${row.id}`,
      title: `${row.docket_number}: ${row.title || row.caption}`,
      url: `${origin}/case/${row.public_id}/documents/${row.document_id}`,
      updated: stamp(row.filed_on),
      summary: "Published opinion on Jurvio.",
      category: "opinion",
    })),
    ...emergency.map((row) => ({
      id: `${origin}/feeds/scotus#emergency-${row.docket_number}`,
      title: `${row.docket_number}: ${row.caption}`,
      url: `${origin}/supreme-court/emergency/${row.docket_number}`,
      updated: stamp(row.last_entry_on),
      summary: `${row.kind} application, ${row.status}.`,
      category: "emergency",
    })),
    ...orders,
  ];
  return items.filter((item) => !isRestrictedDocketText(`${item.title} ${item.summary}`))
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, 40);
}

async function listOrderItems(sql: Queryable): Promise<ActivityFeedItem[]> {
  const origin = siteOrigin();
  const [table] = await sql<{ present: string | null }[]>`SELECT to_regclass('scotus_order_list_item')::text AS present`;
  if (!table?.present) return [];
  const rows = await sql<{ id: string; docket_number: string; caption: string | null; body: string | null; list_date: string; disposition: string | null }[]>`
    SELECT item.source_item_id AS id, item.docket_number, item.caption, left(item.body, 240) AS body, list.list_date::text, item.disposition
    FROM scotus_order_list_item item
    JOIN scotus_order_list list ON list.source_record_id = item.list_source_record_id
    ORDER BY list.list_date DESC, item.source_item_id
    LIMIT 15`;
  return rows.map((row) => ({
    id: `${origin}/feeds/scotus#order-${row.id}`,
    title: `${row.docket_number}: ${row.caption ?? "Order"}`,
    url: `${origin}/supreme-court`,
    updated: stamp(row.list_date),
    summary: row.body ?? row.disposition ?? "Order list entry.",
    category: "order",
  }));
}

export async function listAdministrationFeed(sql: Sql): Promise<ActivityFeedItem[]> {
  return sql.begin((tx) => listAdministrationIn(tx));
}

async function listAdministrationIn(sql: Queryable): Promise<ActivityFeedItem[]> {
  const origin = siteOrigin();
  await sql`SET LOCAL statement_timeout = '4s'`;
  const rows = await sql<{ docket_number: string; caption: string; administration: string; status: string; last_entry_on: string | null }[]>`
    SELECT docket_number, caption, administration, status::text, coalesce(last_entry_on, submitted_on)::text AS last_entry_on
    FROM scotus_application a
    WHERE ${sql.unsafe(visibleSql("a"))}
      AND a.kind <> 'extension' AND a.applicant_kind = 'federal' AND a.administration IS NOT NULL
    ORDER BY coalesce(a.last_entry_on, a.submitted_on) DESC NULLS LAST
    LIMIT 40`;
  return rows.filter((row) => !isRestrictedDocketText(row.caption)).map((row) => ({
    id: `${origin}/feeds/scotus/administration#${row.docket_number}`,
    title: `${row.docket_number}: ${row.caption}`,
    url: `${origin}/supreme-court/emergency/${row.docket_number}`,
    updated: stamp(row.last_entry_on),
    summary: `Automatic label: ${row.administration}. Status ${row.status}.`,
    category: "administration-approximate",
  }));
}
