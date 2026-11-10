import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import {
  assertIndexName,
  concurrentIndexNames,
  formatBlockingSessions,
  sessionsBlockingIndexBuild,
} from "./concurrent-index.mjs";
import { splitMigrationChunks } from "./migration-chunks.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

/**
 * CREATE INDEX CONCURRENTLY cannot run inside a transaction and must not start
 * behind a leftover pg_dump or an earlier build of the same index. An invalid
 * index left by a cancelled build is dropped concurrently (no AccessExclusive
 * lock) before the chunk creates it again. A still-connected backend is
 * reported and left running.
 */
async function guardConcurrentIndexes(sql, chunk) {
  const names = concurrentIndexNames(chunk);
  if (!names.length) return;
  for (const indexName of names) {
    assertIndexName(indexName);
    const activity = await sql`
      SELECT pid, application_name, state,
        (now() - query_start)::text AS query_age,
        left(query, 300) AS query
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
    `;
    const blockers = sessionsBlockingIndexBuild(activity, indexName);
    if (blockers.length) {
      throw new Error(formatBlockingSessions(indexName, blockers));
    }
    const [existing] = await sql`
      SELECT NOT index_row.indisvalid AS invalid
      FROM pg_index index_row
      JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
      JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
      WHERE index_namespace.nspname = 'public'
        AND index_class.relname = ${indexName}
    `;
    if (existing?.invalid) {
      process.stdout.write(`Dropping invalid index ${indexName} concurrently\n`);
      await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS ${indexName}`);
    }
    await sql.unsafe("SET statement_timeout = 0");
    await sql.unsafe("SET lock_timeout = '15s'");
  }
}

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });
try {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migration (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  const directory = path.resolve("db/migrations");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    const [applied] = await sql`SELECT 1 FROM schema_migration WHERE name = ${name}`;
    if (applied) continue;
    // Each chunk is its own simple-protocol query, so it commits before the next
    // chunk starts. That is what lets a later chunk run CREATE INDEX CONCURRENTLY.
    for (const chunk of splitMigrationChunks(await readFile(path.join(directory, name), "utf8"))) {
      await guardConcurrentIndexes(sql, chunk);
      try {
        await sql.unsafe(chunk);
      } finally {
        if (concurrentIndexNames(chunk).length) {
          await sql.unsafe("RESET statement_timeout");
          await sql.unsafe("RESET lock_timeout");
        }
      }
    }
    await sql`INSERT INTO schema_migration (name) VALUES (${name})`;
    process.stdout.write(`Applied ${name}\n`);
  }
} finally {
  await sql.end();
}
