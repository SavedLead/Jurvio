import postgres from "postgres";
import { env } from "@/lib/config/env";

let client: ReturnType<typeof postgres> | undefined;

function intEnv(source: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = source[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Workers and the public site share one Postgres. A worker query must not be
 * allowed to occupy every core for minutes: the public pool stays larger, keeps
 * a little parallelism, and gets a shorter statement budget. Scheduler lanes and
 * JURVIO_DB_WORKER=1 opt into the worker profile.
 */
export function databaseSessionSettings(source: Record<string, string | undefined> = process.env) {
  const worker = source.JURVIO_DB_WORKER === "1" || Boolean(source.JURVIO_SCHEDULER_LANE);
  const lane = source.JURVIO_SCHEDULER_LANE || (worker ? "worker" : "web");
  return {
    worker,
    max: intEnv(source, "JURVIO_DB_POOL_MAX", worker ? 2 : 8),
    connection: {
      application_name: `jurvio-${lane}`,
      statement_timeout: intEnv(source, "JURVIO_DB_STATEMENT_TIMEOUT_MS", worker ? 30_000 : 20_000),
      lock_timeout: intEnv(source, "JURVIO_DB_LOCK_TIMEOUT_MS", worker ? 5_000 : 3_000),
      max_parallel_workers_per_gather: intEnv(source, "JURVIO_DB_MAX_PARALLEL_PER_GATHER", worker ? 0 : 2),
    },
  };
}

export function db() {
  const session = databaseSessionSettings();
  client ??= postgres(env().DATABASE_URL, {
    // Each process opens its own pool. Workers default to 2 connections so a
    // restarted scheduler cannot fill max_connections ahead of the public app.
    max: session.max,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
    transform: { undefined: null },
    connection: session.connection,
  });
  return client;
}

export async function closeDb() {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
  }
}
