import postgres from "postgres";
import { env } from "@/lib/config/env";

type PoolRole = "web" | "search";
const pools = new Map<PoolRole, ReturnType<typeof postgres>>();

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
 * JURVIO_DB_WORKER=1 opt into the worker profile. Keyword search uses a second
 * pool (searchDb) so case-page traffic cannot take its connections.
 */
export function databaseSessionSettings(source: Record<string, string | undefined> = process.env, role: PoolRole = "web") {
  if (role === "search") {
    return {
      worker: false,
      max: intEnv(source, "JURVIO_DB_SEARCH_POOL_MAX", 2),
      connection: {
        application_name: "jurvio-search",
        statement_timeout: intEnv(source, "JURVIO_DB_STATEMENT_TIMEOUT_MS", 20_000),
        lock_timeout: intEnv(source, "JURVIO_DB_LOCK_TIMEOUT_MS", 3_000),
        max_parallel_workers_per_gather: intEnv(source, "JURVIO_DB_MAX_PARALLEL_PER_GATHER", 2),
      },
    };
  }
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

function openPool(role: PoolRole) {
  const existing = pools.get(role);
  if (existing) return existing;
  const session = databaseSessionSettings(process.env, role);
  const sql = postgres(env().DATABASE_URL, {
    // Each process opens its own pools. Workers default to 2 connections so a
    // restarted scheduler cannot fill max_connections ahead of the public app.
    // Search keeps two connections the case pages cannot borrow.
    max: session.max,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
    transform: { undefined: null },
    connection: session.connection,
  });
  pools.set(role, sql);
  return sql;
}

export function db() {
  return openPool("web");
}

/** Keyword search and its facet counts. Case-page traffic uses db() instead. */
export function searchDb() {
  return openPool("search");
}

export async function closeDb() {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map((sql) => sql.end({ timeout: 5 })));
}
