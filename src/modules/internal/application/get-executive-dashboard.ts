import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface ExecutiveDashboard {
  cases: { total: number; published: number; verified: number; addedThisWeek: number };
  content: { documents: number; docketEntries: number; entities: number; courts: number };
  operations: {
    reviewQueue: number;
    failedIngestionRuns: number;
    queuedEnrichments: number;
    unpublishedOutboxEvents: number;
  };
  demand: { events30d: number; human30d: number; machine30d: number };
  latestIngestion: {
    provider: string;
    status: string;
    recordsSeen: number;
    recordsChanged: number;
    startedAt: string;
    completedAt: string | null;
  } | null;
}

interface CountRow { value: number }

export async function getExecutiveDashboard(sql: Sql): Promise<ExecutiveDashboard> {
  const [
    caseCounts,
    contentCounts,
    operationalCounts,
    demandCounts,
    latestIngestion,
  ] = await Promise.all([
    sql<Array<{ total: number; published: number; verified: number; addedThisWeek: number }>>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE publication = 'published')::int AS published,
        count(*) FILTER (WHERE verification = 'verified')::int AS verified,
        count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS "addedThisWeek"
      FROM legal_case
    `,
    sql<Array<{ documents: number; docketEntries: number; entities: number; courts: number }>>`
      SELECT
        (SELECT count(*)::int FROM document) AS documents,
        (SELECT count(*)::int FROM docket_entry) AS "docketEntries",
        (SELECT count(*)::int FROM entity) AS entities,
        (SELECT count(*)::int FROM court) AS courts
    `,
    sql<Array<{
      reviewQueue: number;
      failedIngestionRuns: number;
      queuedEnrichments: number;
      unpublishedOutboxEvents: number;
    }>>`
      SELECT
        (SELECT count(*)::int FROM publication_review WHERE status IN ('pending', 'needs_changes')) AS "reviewQueue",
        (SELECT count(*)::int FROM ingestion_run WHERE status = 'failed') AS "failedIngestionRuns",
        (SELECT count(*)::int FROM enrichment_request WHERE status = 'queued') AS "queuedEnrichments",
        (SELECT count(*)::int FROM outbox_event WHERE published_at IS NULL) AS "unpublishedOutboxEvents"
    `,
    sql<Array<{ events30d: number; human30d: number; machine30d: number }>>`
      SELECT
        count(*)::int AS "events30d",
        count(*) FILTER (WHERE visitor_class = 'human')::int AS "human30d",
        count(*) FILTER (
          WHERE visitor_class IN ('search_bot', 'ai_bot', 'agent', 'api')
        )::int AS "machine30d"
      FROM demand_event
      WHERE occurred_at >= now() - interval '30 days'
    `,
    sql<Array<{
      provider: string;
      status: string;
      recordsSeen: number;
      recordsChanged: number;
      startedAt: Date;
      completedAt: Date | null;
    }>>`
      SELECT
        provider.name AS provider,
        ingestion_run.status::text AS status,
        ingestion_run.records_seen AS "recordsSeen",
        ingestion_run.records_changed AS "recordsChanged",
        ingestion_run.started_at AS "startedAt",
        ingestion_run.completed_at AS "completedAt"
      FROM ingestion_run
      JOIN provider ON provider.id = ingestion_run.provider_id
      ORDER BY ingestion_run.started_at DESC
      LIMIT 1
    `,
  ]);

  const zero: CountRow = { value: 0 };
  const latest = latestIngestion[0];
  return {
    cases: caseCounts[0] ?? { total: 0, published: 0, verified: 0, addedThisWeek: 0 },
    content: contentCounts[0] ?? { documents: 0, docketEntries: 0, entities: 0, courts: 0 },
    operations: operationalCounts[0] ?? {
      reviewQueue: 0,
      failedIngestionRuns: 0,
      queuedEnrichments: 0,
      unpublishedOutboxEvents: 0,
    },
    demand: demandCounts[0] ?? { events30d: zero.value, human30d: 0, machine30d: 0 },
    latestIngestion: latest ? {
      ...latest,
      startedAt: latest.startedAt.toISOString(),
      completedAt: latest.completedAt?.toISOString() ?? null,
    } : null,
  };
}
