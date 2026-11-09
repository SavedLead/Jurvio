/**
 * Recent publisher cycles for the staff readout. Counts only: no captions,
 * docket numbers, or addresses.
 */
import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface PublisherCycle {
  runType: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  published: number;
  scanned: number;
  held: number;
  heldByReason: Record<string, number>;
  searchMs: number | null;
  slowQueries: number | null;
  publishCap: number | null;
  batchSize: number | null;
  perHour: number | null;
  draftEstimate: number | null;
}

const REASON = /^[a-z0-9_]+$/;

function reasons(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    if (!REASON.test(key) || typeof count !== "number") continue;
    out[key] = count;
  }
  return out;
}

export async function listPublisherCycles(sql: Sql, limit = 12): Promise<PublisherCycle[]> {
  const rows = await sql<{
    runType: string;
    startedAt: string;
    completedAt: string | null;
    status: string;
    published: number;
    scanned: number;
    selection: Record<string, unknown> | null;
  }[]>`
    SELECT run_type AS "runType", started_at::text AS "startedAt", completed_at::text AS "completedAt",
      status::text AS status, succeeded_count AS published, records_seen AS scanned, selection
    FROM ingestion_run
    WHERE run_type IN ('publication-quarantine', 'continuous-publish')
    ORDER BY started_at DESC
    LIMIT ${Math.min(24, Math.max(1, limit))}`;
  return rows.map((row) => {
    const selection = row.selection ?? {};
    return {
      runType: row.runType,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      status: row.status,
      published: Number(selection.published ?? row.published ?? 0),
      scanned: Number(selection.scanned ?? row.scanned ?? 0),
      held: Number(selection.held ?? 0),
      heldByReason: reasons(selection.heldByReason),
      searchMs: typeof selection.searchMs === "number" ? selection.searchMs : null,
      slowQueries: typeof selection.slowQueries === "number" ? selection.slowQueries : null,
      publishCap: typeof selection.publishCap === "number" ? selection.publishCap : null,
      batchSize: typeof selection.batchSize === "number" ? selection.batchSize : null,
      perHour: typeof selection.perHour === "number" ? selection.perHour : null,
      draftEstimate: typeof selection.draftEstimate === "number" ? selection.draftEstimate : null,
    };
  });
}
