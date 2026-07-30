import { closeDb, db } from "@/db/client";
import { discoverOfficialAppellateOpinions } from "@/modules/ingestion/application/discover-official-appellate-opinions";
import {
  APPELLATE_COURT_REGISTRY,
  appellateCourtByCode,
  fairAppellateOrder,
} from "@/modules/ingestion/providers/appellate/registry";

const argument = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const courtArgument = argument("court") ?? "all";
const watch = (argument("watch") ?? "false") === "true";
const concurrency = Math.max(1, Math.min(6, Number(argument("concurrency") ?? "4")));
const intervalMs = 5 * 60 * 1000;
const sql = db();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function heartbeat(
  stage: string,
  courtCode: string | null,
  metadata: Record<string, unknown> = {},
) {
  await sql`
    INSERT INTO appellate_worker_heartbeat (
      worker_id, stage, court_code, heartbeat_at, metadata
    ) VALUES (
      'appellate-discovery-1', ${stage}, ${courtCode}, now(), ${sql.json(metadata)}
    )
    ON CONFLICT (worker_id) DO UPDATE SET
      stage = EXCLUDED.stage,
      court_code = EXCLUDED.court_code,
      heartbeat_at = now(),
      metadata = EXCLUDED.metadata
  `;
}

async function cycle() {
  const checkpointRows = await sql<{ court_code: string; checkpoint: string | null }[]>`
    SELECT court_code, checkpoint FROM appellate_source_registry
  `;
  const order = courtArgument === "all"
    ? fairAppellateOrder(new Map(checkpointRows.map((row) => [row.court_code, row.checkpoint])))
    : [appellateCourtByCode(courtArgument)].filter((court) => court !== null);
  if (order.length === 0) throw new Error(`Unknown appellate court ${courtArgument}`);

  const results: Array<Record<string, unknown>> = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, order.length) }, async () => {
    while (cursor < order.length) {
      const court = order[cursor++];
      if (!court) continue;
      await heartbeat("discover", court.code, { remaining: order.length - cursor });
      try {
        results.push(await discoverOfficialAppellateOpinions(sql, court));
      } catch (error) {
        results.push({ court: court.code, error: error instanceof Error ? error.message : String(error) });
      }
    }
  });
  await Promise.all(workers);

  const [health] = await sql<{
    stalled_workers: number;
    blocked: number;
    oldest_minutes: number | null;
  }[]>`
    SELECT
      (SELECT count(*)::int FROM appellate_worker_heartbeat
        WHERE heartbeat_at < now() - interval '10 minutes') AS stalled_workers,
      (SELECT count(*)::int FROM appellate_ingestion_item
        WHERE state = 'blocked') AS blocked,
      (SELECT extract(epoch FROM (now() - min(first_seen_at))) / 60
        FROM appellate_ingestion_item
        WHERE state IN ('discovered','downloaded','extracted','enriched','publication_ready'))
        AS oldest_minutes
  `;
  await heartbeat("idle", null, { results, health });
  console.log(JSON.stringify({
    lane: "official-appellate",
    historicalOrder: "newest-to-oldest",
    configuredCircuits: APPELLATE_COURT_REGISTRY.length,
    results,
    health,
  }));
}

try {
  do {
    await cycle();
    if (watch) await sleep(intervalMs);
  } while (watch);
} finally {
  await closeDb();
}
