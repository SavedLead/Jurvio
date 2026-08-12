// Prints the number of migration files that have NOT yet been applied to the
// database (files in db/migrations not present in the schema_migration table).
// Used by the production release to decide whether a pre-release backup is
// warranted. FAIL-SAFE: on ANY error it prints "unknown" (never "0"), so the
// caller treats the state as "might migrate" and backs up.
import { readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stdout.write("unknown\n");
  process.exit(0);
}

const sql = postgres(databaseUrl, { max: 1 });
try {
  const directory = path.resolve("db/migrations");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const rows = await sql<{ name: string }[]>`SELECT name FROM schema_migration`;
  const applied = new Set(rows.map((row) => row.name));
  const pending = files.filter((name) => !applied.has(name));
  process.stdout.write(`${pending.length}\n`);
} catch {
  process.stdout.write("unknown\n");
} finally {
  await sql.end();
}
