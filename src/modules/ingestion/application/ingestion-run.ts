import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export async function startIngestionRun(
  sql: Sql,
  input: { providerCode: string; runType: string; selection: postgres.JSONValue; selectedCount: number },
): Promise<string> {
  const [run] = await sql<{ id: string }[]>`
    INSERT INTO ingestion_run (provider_id, run_type, status, selection, selected_count)
    SELECT provider.id, ${input.runType}, 'running', ${sql.json(input.selection)}, ${input.selectedCount}
    FROM provider WHERE provider.code = ${input.providerCode}
    RETURNING id
  `;
  if (!run) throw new Error("Ingestion run could not be created");
  return run.id;
}

export async function startIngestionRunItem(sql: Sql, runId: string, sourceRecordId: string) {
  await sql`
    INSERT INTO ingestion_run_item (ingestion_run_id, source_record_id, status)
    VALUES (${runId}, ${sourceRecordId}, 'processing')
    ON CONFLICT (ingestion_run_id, source_record_id)
    DO UPDATE SET status = 'processing', started_at = now(), completed_at = NULL,
      case_public_id = NULL, document_count = NULL, error_message = NULL
  `;
}

export async function finishIngestionRunItem(
  sql: Sql,
  input: { runId: string; sourceRecordId: string; casePublicId?: string; documentCount?: number; error?: string },
) {
  await sql`
    UPDATE ingestion_run_item SET
      status = ${input.error ? "failed" : "succeeded"},
      case_public_id = ${input.casePublicId ?? null},
      document_count = ${input.documentCount ?? null},
      error_message = ${input.error?.slice(0, 4000) ?? null}, completed_at = now()
    WHERE ingestion_run_id = ${input.runId} AND source_record_id = ${input.sourceRecordId}
  `;
}

export async function finishIngestionRun(sql: Sql, runId: string, fatalError?: string) {
  await sql`
    UPDATE ingestion_run run SET
      succeeded_count = counts.succeeded,
      failed_count = counts.failed,
      status = (
        CASE
          WHEN ${fatalError ?? null}::text IS NOT NULL THEN 'failed'
          WHEN counts.failed > 0 THEN 'completed_with_errors'
          ELSE 'completed'
        END
      )::ingestion_run_status,
      error = ${fatalError ? sql.json({ message: fatalError.slice(0, 4000) }) : null},
      completed_at = now()
    FROM (
      SELECT count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
        count(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM ingestion_run_item WHERE ingestion_run_id = ${runId}
    ) counts
    WHERE run.id = ${runId}
  `;
}
