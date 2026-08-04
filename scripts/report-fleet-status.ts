/**
 * Read-only production fleet-status report.
 *
 * Emits a per-court operational "heartbeat" for the full federal fleet
 * (1 Supreme Court + 13 Courts of Appeals + 94 District Courts) plus the
 * corpus, publishing, failure, and PACER-cost surfaces that tell an operator
 * whether ingestion and publication are actually live.
 *
 * This job ONLY reads. It performs no writes, no ingestion, and no publication.
 * Every section is isolated so a single failing query degrades that section to
 * an error string instead of aborting the whole report.
 *
 * Output: a human-readable summary on stderr and a single machine-readable
 * JSON document on stdout (so it can back the z.jurvio.com/in heartbeat later).
 */
import { closeDb, db } from "@/db/client";

const sql = db();

type Section<T> = { ok: true; data: T } | { ok: false; error: string };

async function safe<T>(fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const num = (value: unknown): number => Number(value ?? 0);

try {
  const checkedAt = new Date().toISOString();

  // ---- Corpus totals -------------------------------------------------------
  const corpus = await safe(async () => {
    const [row] = await sql<{
      cases: string; published: string; draft: string; restricted: string;
      suppressed: string; needs_review: string; docket_entries: string;
      documents: string; opinions: string; artifacts: string;
      latest_source_at: string | null; database_bytes: string;
    }[]>`
      SELECT
        (SELECT count(*) FROM legal_case)::text AS cases,
        (SELECT count(*) FROM legal_case WHERE publication='published')::text AS published,
        (SELECT count(*) FROM legal_case WHERE publication='draft')::text AS draft,
        (SELECT count(*) FROM legal_case WHERE publication='restricted')::text AS restricted,
        (SELECT count(*) FROM legal_case WHERE publication='suppressed')::text AS suppressed,
        (SELECT count(*) FROM legal_case WHERE verification='needs_review' AND publication='draft')::text AS needs_review,
        (SELECT count(*) FROM docket_entry)::text AS docket_entries,
        (SELECT count(*) FROM document)::text AS documents,
        (SELECT count(*) FROM judicial_opinion)::text AS opinions,
        (SELECT count(*) FROM raw_artifact)::text AS artifacts,
        (SELECT max(retrieved_at) FROM raw_artifact)::text AS latest_source_at,
        pg_database_size(current_database())::text AS database_bytes
    `;
    return row;
  });

  // ---- Publishing pipeline health -----------------------------------------
  const publishing = await safe(async () => {
    const reviewQueue = await sql<{ status: string; count: string }[]>`
      SELECT status, count(*)::text FROM publication_review GROUP BY status ORDER BY status
    `;
    const [outbox] = await sql<{ unpublished: string; oldest_unpublished: string | null }[]>`
      SELECT count(*) FILTER (WHERE published_at IS NULL)::text AS unpublished,
             min(created_at) FILTER (WHERE published_at IS NULL)::text AS oldest_unpublished
      FROM outbox_event
    `;
    return { reviewQueue, outbox };
  });

  // ---- Supreme Court -------------------------------------------------------
  const scotus = await safe(async () => {
    const candidates = await sql<{ review_status: string; count: string }[]>`
      SELECT review_status, count(*)::text
      FROM official_opinion_candidate GROUP BY review_status ORDER BY review_status
    `;
    return { opinionCandidatesByStatus: candidates };
  });

  // ---- Courts of Appeals (13 circuits) ------------------------------------
  const appellate = await safe(async () => {
    const registry = await sql<{
      court_code: string; circuit: string; health_state: string;
      last_successful_retrieval: string | null; consecutive_failures: number;
      next_poll_at: string | null;
    }[]>`
      SELECT court_code, circuit, health_state,
             last_successful_retrieval::text, consecutive_failures, next_poll_at::text
      FROM appellate_source_registry ORDER BY court_code
    `;
    const govinfo = await sql<{
      court_code: string; status: string; records_discovered: string;
      records_enqueued: string; consecutive_failures: number;
      last_successful_retrieval: string | null; last_error: string | null;
    }[]>`
      SELECT court_code, status, records_discovered::text, records_enqueued::text,
             consecutive_failures, last_successful_retrieval::text, last_error
      FROM govinfo_appellate_checkpoint ORDER BY court_code
    `;
    const backlog = await sql<{ court_code: string; state: string; count: string; last_seen_at: string | null }[]>`
      SELECT court_code, state, count(*)::text, max(last_seen_at)::text AS last_seen_at
      FROM appellate_ingestion_item GROUP BY court_code, state ORDER BY court_code, state
    `;
    const lastPublished = await sql<{ court_code: string; last_published_at: string | null; published: string }[]>`
      SELECT court_code, max(last_seen_at) FILTER (WHERE state='published')::text AS last_published_at,
             count(*) FILTER (WHERE state='published')::text AS published
      FROM appellate_ingestion_item GROUP BY court_code ORDER BY court_code
    `;
    return { registry, govinfo, backlog, lastPublished };
  });

  // ---- District Courts (94) -----------------------------------------------
  const district = await safe(async () => {
    const registry = await sql<{
      court_code: string; circuit: string | null; rss_available: boolean;
      health_state: string; last_successful_retrieval: string | null;
      consecutive_failures: number; polling_minutes: number;
    }[]>`
      SELECT court_code, circuit, rss_available, health_state,
             last_successful_retrieval::text, consecutive_failures, polling_minutes
      FROM direct_court_registry WHERE court_type='district' ORDER BY court_code
    `;
    const events = await sql<{
      court_code: string; total: string; published: string; pending: string;
      unmatched: string; last_event_at: string | null; last_published_at: string | null;
    }[]>`
      SELECT court_code,
             count(*)::text AS total,
             count(*) FILTER (WHERE publication_state='published')::text AS published,
             count(*) FILTER (WHERE publication_state='pending')::text AS pending,
             count(*) FILTER (WHERE case_id IS NULL)::text AS unmatched,
             max(last_seen_at)::text AS last_event_at,
             max(published_at)::text AS last_published_at
      FROM direct_court_event GROUP BY court_code ORDER BY court_code
    `;
    const [summary] = await sql<{
      total: string; rss_enabled: string; healthy: string; degraded: string; unknown: string;
    }[]>`
      SELECT count(*)::text AS total,
             count(*) FILTER (WHERE rss_available)::text AS rss_enabled,
             count(*) FILTER (WHERE health_state='healthy')::text AS healthy,
             count(*) FILTER (WHERE health_state='degraded')::text AS degraded,
             count(*) FILTER (WHERE health_state='unknown')::text AS unknown
      FROM direct_court_registry WHERE court_type='district'
    `;
    return { summary, registry, events };
  });

  // ---- Failure & stall surfaces -------------------------------------------
  const failures = await safe(async () => {
    const [runItems] = await sql<{ failed_24h: string }[]>`
      SELECT count(*)::text AS failed_24h FROM ingestion_run_item
      WHERE status='failed' AND started_at > now() - interval '24 hours'
    `;
    const appellateBlocked = await sql<{ blocker_code: string | null; count: string }[]>`
      SELECT blocker_code, count(*)::text FROM appellate_ingestion_item
      WHERE state='blocked' GROUP BY blocker_code ORDER BY count(*) DESC
    `;
    const stalledWorkers = await sql<{ worker_id: string; stage: string; court_code: string | null; heartbeat_at: string }[]>`
      SELECT worker_id, stage, court_code, heartbeat_at::text
      FROM appellate_worker_heartbeat
      WHERE heartbeat_at < now() - interval '10 minutes' ORDER BY heartbeat_at
    `;
    const runningRuns = await sql<{ provider_id: string; count: string; oldest_started: string | null }[]>`
      SELECT provider_id::text, count(*)::text, min(started_at)::text AS oldest_started
      FROM ingestion_run WHERE status='running' GROUP BY provider_id
    `;
    return { failedRunItems24h: runItems?.failed_24h ?? "0", appellateBlocked, stalledWorkers, runningRuns };
  });

  // ---- PACER zero-cost proof ----------------------------------------------
  const pacerCost = await safe(async () => {
    const [row] = await sql<{ entries: string; estimated_cents: string; actual_cents: string }[]>`
      SELECT count(*)::text AS entries,
             coalesce(sum(estimated_cost_cents),0)::text AS estimated_cents,
             coalesce(sum(actual_cost_cents),0)::text AS actual_cents
      FROM pacer_cost_ledger
    `;
    return row;
  });

  const report = {
    report: "fleet-status",
    checkedAt,
    corpus,
    publishing,
    scotus,
    appellate,
    district,
    failures,
    pacerCost,
  };

  // Human-readable summary → stderr (visible in Actions log alongside JSON).
  const line = (s: string) => process.stderr.write(s + "\n");
  line("================ JURVIO FLEET STATUS ================");
  line(`checked_at: ${checkedAt}`);
  if (corpus.ok) {
    const c = corpus.data;
    line(`corpus: cases=${c.cases} published=${c.published} draft=${c.draft} ` +
      `held_needs_review=${c.needs_review} docket_entries=${c.docket_entries} ` +
      `documents=${c.documents} opinions=${c.opinions}`);
    line(`latest_ingested_source_at: ${c.latest_source_at ?? "n/a"}  db_size=${(num(c.database_bytes) / 1e9).toFixed(2)}GB`);
  } else line(`corpus: ERROR ${corpus.error}`);
  if (publishing.ok) {
    line(`publishing: outbox_unpublished=${publishing.data.outbox.unpublished} ` +
      `oldest_unpublished=${publishing.data.outbox.oldest_unpublished ?? "n/a"} ` +
      `review_queue=${JSON.stringify(publishing.data.reviewQueue)}`);
  } else line(`publishing: ERROR ${publishing.error}`);
  if (appellate.ok) {
    const degraded = appellate.data.registry.filter((r) => r.health_state !== "healthy").map((r) => r.court_code);
    const govModes = appellate.data.govinfo.map((g) => `${g.court_code}:${g.status}`).join(",");
    line(`appellate(13): non_healthy=[${degraded.join(",") || "none"}]`);
    line(`appellate.govinfo_checkpoints: ${govModes || "none"}`);
  } else line(`appellate: ERROR ${appellate.error}`);
  if (district.ok && district.data.summary) {
    const s = district.data.summary;
    line(`district(94): total=${s.total} rss_enabled=${s.rss_enabled} healthy=${s.healthy} degraded=${s.degraded} unknown=${s.unknown}`);
  } else if (!district.ok) line(`district: ERROR ${district.error}`);
  if (failures.ok) {
    line(`failures: run_items_24h=${failures.data.failedRunItems24h} ` +
      `stalled_workers=${failures.data.stalledWorkers.length} ` +
      `appellate_blocked=${JSON.stringify(failures.data.appellateBlocked)}`);
  } else line(`failures: ERROR ${failures.error}`);
  if (pacerCost.ok) {
    line(`pacer_cost: entries=${pacerCost.data.entries} estimated_cents=${pacerCost.data.estimated_cents} actual_cents=${pacerCost.data.actual_cents}`);
  } else line(`pacer_cost: ERROR ${pacerCost.error}`);
  line("=====================================================");

  process.stdout.write(JSON.stringify(report) + "\n");
} finally {
  await closeDb();
}
