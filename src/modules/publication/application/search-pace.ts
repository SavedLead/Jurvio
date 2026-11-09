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
