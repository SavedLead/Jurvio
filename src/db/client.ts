import postgres from "postgres";
import { env } from "@/lib/config/env";

let client: ReturnType<typeof postgres> | undefined;

export function db() {
  client ??= postgres(env().DATABASE_URL, {
    // Each process (app, workers, and every spawned scheduler child) opens its
    // own pool, so this is per-process. Raised from 10 to give the higher-
    // concurrency ingestion/publication lanes real parallelism; Postgres
    // max_connections is raised to 200 in compose to cover the aggregate.
    max: Number.parseInt(process.env.JURVIO_DB_POOL_MAX ?? "14", 10),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
    transform: { undefined: null },
  });
  return client;
}

export async function closeDb() {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
  }
}
