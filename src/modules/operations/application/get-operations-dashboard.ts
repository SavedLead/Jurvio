import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface OperationsDashboard {
  generatedAt: string;
  corpus: {
    cases: number;
    publishedCases: number;
    courts: number;
    entities: number;
    parties: number;
    docketEntries: number;
    documents: number;
    opinions: number;
    searchableOpinions: number;
    rawArtifacts: number;
  };
  ingestion: {
    running: number;
    completedLast24Hours: number;
    failedLast24Hours: number;
    itemsSucceededLast24Hours: number;
    itemsFailedLast24Hours: number;
    oldestRunningStartedAt: string | null;
  };
  storage: {
    databaseBytes: number;
    rawArtifactBytesRecorded: number;
    documentWords: number;
  };
  sources: Array<{
    code: string;
    name: string;
    baseUrl: string;
    latestRunStatus: string | null;
    latestRunStartedAt: string | null;
    latestRunCompletedAt: string | null;
    latestArtifactAt: string | null;
    checkpointCount: number;
  }>;
  recentRuns: Array<{
    id: string;
    provider: string;
    runType: string | null;
    status: string;
    startedAt: string;
    completedAt: string | null;
    selectedCount: number;
    succeededCount: number;
    failedCount: number;
    recordsSeen: number;
    recordsChanged: number;
    errorMessage: string | null;
  }>;
  recentFailures: Array<{
    runId: string;
    provider: string;
    runType: string | null;
    sourceRecordId: string;
    errorMessage: string;
    completedAt: string | null;
  }>;
}

function numberValue(value: number | string | bigint | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatByteCount(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const nextUnit of units) {
    value /= 1_000;
    unit = nextUnit;
    if (value < 1_000) break;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

export function classifySourceHealth(source: OperationsDashboard["sources"][number], now = Date.now()) {
  if (source.latestRunStatus === "running") return { label: "Running", tone: "active" as const };
  if (source.latestRunStatus === "failed" || source.latestRunStatus === "completed_with_errors") {
    return { label: "Needs attention", tone: "danger" as const };
  }
  const activityAt = source.latestArtifactAt ?? source.latestRunCompletedAt ?? source.latestRunStartedAt;
  if (!activityAt) return { label: "Not started", tone: "muted" as const };
  const age = now - new Date(activityAt).getTime();
  if (age > 7 * 24 * 60 * 60 * 1000) return { label: "Stale", tone: "warning" as const };
  return { label: "Healthy", tone: "good" as const };
}

export async function getOperationsDashboard(sql: Sql): Promise<OperationsDashboard> {
  const [corpusRows, ingestionRows, storageRows, sourceRows, runRows, failureRows] = await Promise.all([
    sql<Array<Record<string, number | string>>>`
      SELECT
        (SELECT count(*)::int FROM legal_case) AS cases,
        (SELECT count(*)::int FROM legal_case WHERE publication = 'published') AS published_cases,
        (SELECT count(*)::int FROM court) AS courts,
        (SELECT count(*)::int FROM entity) AS entities,
        (SELECT count(*)::int FROM party_appearance) AS parties,
        (SELECT count(*)::int FROM docket_entry) AS docket_entries,
        (SELECT count(*)::int FROM document) AS documents,
        (SELECT count(*)::int FROM judicial_opinion) AS opinions,
        (SELECT count(*)::int FROM opinion_search_projection) AS searchable_opinions,
        (SELECT count(*)::int FROM raw_artifact) AS raw_artifacts
    `,
    sql<Array<Record<string, number | string | null>>>`
      SELECT
        count(*) FILTER (WHERE status = 'running')::int AS running,
        count(*) FILTER (WHERE completed_at >= now() - interval '24 hours'
          AND status IN ('completed', 'completed_with_errors'))::int AS completed_last_24_hours,
        count(*) FILTER (WHERE completed_at >= now() - interval '24 hours'
          AND status IN ('failed', 'completed_with_errors'))::int AS failed_last_24_hours,
        (SELECT count(*)::int FROM ingestion_run_item
          WHERE completed_at >= now() - interval '24 hours' AND status = 'succeeded') AS items_succeeded_last_24_hours,
        (SELECT count(*)::int FROM ingestion_run_item
          WHERE completed_at >= now() - interval '24 hours' AND status = 'failed') AS items_failed_last_24_hours,
        min(started_at) FILTER (WHERE status = 'running')::text AS oldest_running_started_at
      FROM ingestion_run
    `,
    sql<Array<Record<string, number | string>>>`
      SELECT
        pg_database_size(current_database())::bigint AS database_bytes,
        coalesce((SELECT sum(coalesce((response_metadata->>'content_length')::bigint, 0))
          FROM raw_artifact
          WHERE response_metadata->>'content_length' ~ '^[0-9]+$'), 0)::bigint AS raw_artifact_bytes_recorded,
        coalesce((SELECT sum(word_count) FROM document_content), 0)::bigint AS document_words
    `,
    sql<Array<Record<string, number | string | null>>>`
      SELECT provider.code, provider.name, provider.base_url,
        latest.status::text AS latest_run_status,
        latest.started_at::text AS latest_run_started_at,
        latest.completed_at::text AS latest_run_completed_at,
        (SELECT max(retrieved_at)::text FROM raw_artifact WHERE provider_id = provider.id) AS latest_artifact_at,
        (SELECT count(*)::int FROM ingestion_checkpoint WHERE provider_id = provider.id) AS checkpoint_count
      FROM provider
      LEFT JOIN LATERAL (
        SELECT status, started_at, completed_at
        FROM ingestion_run WHERE provider_id = provider.id
        ORDER BY started_at DESC LIMIT 1
      ) latest ON true
      ORDER BY provider.name
    `,
    sql<Array<Record<string, number | string | null>>>`
      SELECT run.id::text, provider.name AS provider, run.run_type,
        run.status::text, run.started_at::text, run.completed_at::text,
        run.selected_count, run.succeeded_count, run.failed_count,
        run.records_seen, run.records_changed,
        coalesce(run.error->>'message', run.error::text) AS error_message
      FROM ingestion_run run
      JOIN provider ON provider.id = run.provider_id
      ORDER BY run.started_at DESC LIMIT 20
    `,
    sql<Array<Record<string, string | null>>>`
      SELECT item.ingestion_run_id::text AS run_id, provider.name AS provider,
        run.run_type, item.source_record_id, coalesce(item.error_message, 'Unknown failure') AS error_message,
        item.completed_at::text
      FROM ingestion_run_item item
      JOIN ingestion_run run ON run.id = item.ingestion_run_id
      JOIN provider ON provider.id = run.provider_id
      WHERE item.status = 'failed'
      ORDER BY item.completed_at DESC NULLS LAST, item.started_at DESC LIMIT 25
    `,
  ]);

  const corpus = corpusRows[0] ?? {};
  const ingestion = ingestionRows[0] ?? {};
  const storage = storageRows[0] ?? {};
  return {
    generatedAt: new Date().toISOString(),
    corpus: {
      cases: numberValue(corpus.cases), publishedCases: numberValue(corpus.published_cases),
      courts: numberValue(corpus.courts), entities: numberValue(corpus.entities),
      parties: numberValue(corpus.parties), docketEntries: numberValue(corpus.docket_entries),
      documents: numberValue(corpus.documents), opinions: numberValue(corpus.opinions),
      searchableOpinions: numberValue(corpus.searchable_opinions), rawArtifacts: numberValue(corpus.raw_artifacts),
    },
    ingestion: {
      running: numberValue(ingestion.running),
      completedLast24Hours: numberValue(ingestion.completed_last_24_hours),
      failedLast24Hours: numberValue(ingestion.failed_last_24_hours),
      itemsSucceededLast24Hours: numberValue(ingestion.items_succeeded_last_24_hours),
      itemsFailedLast24Hours: numberValue(ingestion.items_failed_last_24_hours),
      oldestRunningStartedAt: ingestion.oldest_running_started_at == null ? null : String(ingestion.oldest_running_started_at),
    },
    storage: {
      databaseBytes: numberValue(storage.database_bytes),
      rawArtifactBytesRecorded: numberValue(storage.raw_artifact_bytes_recorded),
      documentWords: numberValue(storage.document_words),
    },
    sources: sourceRows.map((row) => ({
      code: String(row.code), name: String(row.name), baseUrl: String(row.base_url),
      latestRunStatus: row.latest_run_status == null ? null : String(row.latest_run_status),
      latestRunStartedAt: row.latest_run_started_at == null ? null : String(row.latest_run_started_at),
      latestRunCompletedAt: row.latest_run_completed_at == null ? null : String(row.latest_run_completed_at),
      latestArtifactAt: row.latest_artifact_at == null ? null : String(row.latest_artifact_at),
      checkpointCount: numberValue(row.checkpoint_count),
    })),
    recentRuns: runRows.map((row) => ({
      id: String(row.id), provider: String(row.provider), runType: row.run_type == null ? null : String(row.run_type),
      status: String(row.status), startedAt: String(row.started_at),
      completedAt: row.completed_at == null ? null : String(row.completed_at),
      selectedCount: numberValue(row.selected_count), succeededCount: numberValue(row.succeeded_count),
      failedCount: numberValue(row.failed_count), recordsSeen: numberValue(row.records_seen),
      recordsChanged: numberValue(row.records_changed),
      errorMessage: row.error_message == null ? null : String(row.error_message),
    })),
    recentFailures: failureRows.map((row) => ({
      runId: String(row.run_id), provider: String(row.provider),
      runType: row.run_type ?? null, sourceRecordId: String(row.source_record_id),
      errorMessage: String(row.error_message), completedAt: row.completed_at ?? null,
    })),
  };
}
