import postgres from "postgres";
import { env } from "@/lib/config/env";
import { refreshDueFollowedCases, syncFollowedItemPriority } from "@/modules/ingestion/application/followed-item-priority";
import { createArtifactStore } from "@/modules/ingestion/infrastructure/create-artifact-store";

// Followed-item lane. Ingestion host only (scheduler lane "core").
//   node jobs/run-followed-item-priority.mjs [--limit=6]
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw] as const;
}));
const limit = Number.parseInt(args.get("limit") ?? "", 10);
const budgetSeconds = Number.parseInt(args.get("budget-seconds") ?? "", 10);
const budgetMs = (Number.isFinite(budgetSeconds) && budgetSeconds > 0 ? budgetSeconds : 240) * 1000;

const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: { application_name: "jurvio-followed-priority", statement_timeout: 60_000, lock_timeout: 3_000 },
});
try {
  const [lock] = await sql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext('jurvio-followed-item-priority-v1')) AS ok`;
  if (!lock?.ok) {
    console.log(JSON.stringify({ followedPriority: "skipped", reason: "previous run still active" }));
  } else {
    const started = Date.now();
    const synced = await syncFollowedItemPriority(sql);
    const refreshed = await refreshDueFollowedCases(sql, createArtifactStore({ localRoot: process.env.JURVIO_ARTIFACT_ROOT ?? ".data/artifacts" }), {
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      deadlineMs: Date.now() + budgetMs,
    });
    console.log(JSON.stringify({ followedPriority: "done", elapsedMs: Date.now() - started, ...synced, ...refreshed }));
    await sql`SELECT pg_advisory_unlock(hashtext('jurvio-followed-item-priority-v1'))`;
  }
} finally {
  await sql.end({ timeout: 5 });
}
