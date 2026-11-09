import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

/** Time a public search. Null when the probe itself fails. */
export async function measurePublicSearchMs(
  url = "https://jurvio.com/search?q=smith",
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const started = Date.now();
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
    if (!response.ok) return null;
    await response.arrayBuffer();
    return Date.now() - started;
  } catch {
    return null;
  }
}

/** Median of the finite samples. Null when every probe failed. */
export function medianMs(samples: Array<number | null>): number | null {
  const values = samples.filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!values.length) return null;
  return values[Math.floor((values.length - 1) / 2)] ?? null;
}

/** Web or search queries already running longer than 2 seconds. */
export async function slowPublicQueryCount(sql: Sql): Promise<number> {
  const [row] = await sql<{ slow: number }[]>`
    SELECT count(*)::int AS slow
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND state = 'active'
      AND application_name IN ('jurvio-web', 'jurvio-search')
      AND now() - query_start > interval '2 seconds'
      AND pid <> pg_backend_pid()`;
  return row?.slow ?? 0;
}

/** Sessions waiting on a lock. */
export async function lockWaitCount(sql: Sql): Promise<number> {
  const [row] = await sql<{ locks: number }[]>`
    SELECT count(*)::int AS locks
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND wait_event_type = 'Lock'
      AND pid <> pg_backend_pid()`;
  return row?.locks ?? 0;
}

/** Draft-row estimate from the partial index, or null if it cannot be read quickly. */
export async function draftCaseEstimate(sql: Sql): Promise<number | null> {
  try {
    const [row] = await sql<{ estimate: number }[]>`
      SELECT reltuples::bigint AS estimate
      FROM pg_class
      WHERE relname = 'legal_case_draft_created_idx'`;
    return row ? Number(row.estimate) : null;
  } catch {
    return null;
  }
}
