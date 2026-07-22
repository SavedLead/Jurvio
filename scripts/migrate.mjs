import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

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
    await sql.unsafe(await readFile(path.join(directory, name), "utf8"));
    await sql`INSERT INTO schema_migration (name) VALUES (${name})`;
    process.stdout.write(`Applied ${name}\n`);
  }
} finally {
  await sql.end();
}
