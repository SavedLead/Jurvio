import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

/**
 * True only after the resumable seed has walked every court. Until then
 * /cases and /coverage keep the planner estimate. A partial seed rewrites
 * case_count court by court, so summing it early would publish a mixed total.
 */
export async function publishedCountSeedComplete(sql: Sql): Promise<boolean> {
  try {
    const [row] = await sql<{ ready: boolean }[]>`
      SELECT coalesce(complete, false) AS ready
      FROM published_count_seed_cursor
      WHERE singleton = 1
    `;
    return row?.ready === true;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "42P01" || code === "42703") return false;
    throw error;
  }
}

/** Planner estimate of published cases. Not a count of legal_case. */
export async function readPlannerPublishedEstimate(sql: Sql): Promise<number> {
  const [estimate] = await sql<{ total: string }[]>`
    SELECT greatest(coalesce(reltuples, 0), 0)::bigint AS total
    FROM pg_class
    WHERE relname = 'legal_case_published_recency_idx'
  `;
  const estimated = Number(estimate?.total ?? 0);
  return Number.isFinite(estimated) ? estimated : 0;
}
