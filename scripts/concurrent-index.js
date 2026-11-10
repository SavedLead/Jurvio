// Helpers for CREATE INDEX CONCURRENTLY migrations.
//
// A cancelled deploy can leave the build running, or leave the index INVALID.
// CREATE INDEX CONCURRENTLY waits behind pg_dump and takes ShareUpdateExclusive
// on the table, which blocks writes for the whole build. The migrator must not
// start that build while one of those sessions is still connected, and it must
// not take AccessExclusiveLock to clear an invalid index.

const INDEX_STATEMENT = /CREATE\s+INDEX\s+CONCURRENTLY(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_][a-z0-9_]*)/gi;

export function concurrentIndexNames(sqlText) {
  return [...sqlText.matchAll(INDEX_STATEMENT)].map((match) => match[1]);
}

export function assertIndexName(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to touch an index whose name is not a plain identifier: ${name}`);
  }
  return name;
}

/**
 * Sessions that would make a concurrent build wait or collide.
 * `pg_dump` holds AccessShare for the whole dump. Another CREATE INDEX on the
 * same name still holds ShareUpdateExclusive. Idle sessions are ignored.
 */
/**
 * @typedef {object} IndexSession
 * @property {number} pid
 * @property {string} [application_name]
 * @property {string} [state]
 * @property {string} [query_age]
 * @property {string} [query]
 */

/**
 * @param {IndexSession[]} activity
 * @param {string} indexName
 * @returns {IndexSession[]}
 */
export function sessionsBlockingIndexBuild(activity, indexName) {
  const name = assertIndexName(indexName).toLowerCase();
  return activity.filter((row) => {
    if (!row || row.state === "idle") return false;
    const application = String(row.application_name ?? "").toLowerCase();
    const query = String(row.query ?? "").toLowerCase();
    return application.startsWith("pg_dump") || query.includes(name);
  });
}

/**
 * @param {string} indexName
 * @param {IndexSession[]} sessions
 */
export function formatBlockingSessions(indexName, sessions) {
  const lines = sessions.map((row) =>
    `pid=${row.pid} application_name=${row.application_name ?? ""} state=${row.state ?? ""} query_age=${row.query_age ?? ""} query=${row.query ?? ""}`,
  );
  return [
    `Refusing to build ${indexName} while another backend is still connected. Do not terminate it without approval.`,
    ...lines,
  ].join("\n");
}
