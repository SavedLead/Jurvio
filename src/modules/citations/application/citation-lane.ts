import type postgres from "postgres";
import { LIVE_CITATION_PRIORITY, syncCitationGraph } from "./sync-citation-graph";

type Sql = ReturnType<typeof postgres>;

export interface CitationLanePlan {
  /** Rows per queue per batch (identities and documents each). */
  batch: number;
  /** Stop starting new batches after this many milliseconds. */
  budgetMs: number;
  /** Pause between batches so the database and web traffic get room. */
  pauseMs: number;
  /**
   * Batches of backfill (priority 0) work after live work is drained.
   * Infinity = keep draining backfill until the budget ends (builder backfill).
   */
  backfillBatches: number;
  /** When set, skip the live-priority pass (builder backfill leaves live work to the resident lane). */
  backfillOnly?: boolean;
  /** Back off while more than this many other sessions are active (0 = never check). */
  maxActiveSessions?: number;
}

export interface CitationLaneResult {
  batches: number;
  liveBatches: number;
  identities: number;
  documents: number;
  stoppedBy: "empty" | "budget" | "backfill_batches";
  elapsedMs: number;
  throttledMs: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Other sessions currently running a statement (not idle), excluding this one. */
async function activeSessions(sql: Sql): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE state = 'active' AND pid <> pg_backend_pid() AND backend_type = 'client backend'`;
  return row?.n ?? 0;
}

/**
 * Drain the citation queues in batches until the budget ends.
 *
 * Before this the lane took one 200-row batch per 15 minutes in FIFO order,
 * so a new opinion waited behind ~689k backfill documents and the last run was
 * killed at its 12-minute budget. Now: every batch commits on its own, live
 * work (priority >= 10, set by the content triggers) goes first, and the loop
 * stops starting batches when the budget is spent instead of being killed.
 */
export async function runCitationLane(
  sql: Sql,
  plan: CitationLanePlan,
  now: () => number = Date.now,
): Promise<CitationLaneResult> {
  const started = now();
  const result: CitationLaneResult = {
    batches: 0, liveBatches: 0, identities: 0, documents: 0, stoppedBy: "empty", elapsedMs: 0, throttledMs: 0,
  };
  const overBudget = () => now() - started >= plan.budgetMs;
  const throttle = async () => {
    if (!plan.maxActiveSessions) return;
    for (let i = 0; i < 12 && !overBudget(); i++) {
      if ((await activeSessions(sql)) <= plan.maxActiveSessions) return;
      result.throttledMs += 5_000;
      await sleep(5_000);
    }
  };
  const pass = async (options: { minPriority?: number; maxPriority?: number }) => {
    const synced = await syncCitationGraph(sql, plan.batch, options);
    result.batches++;
    result.identities += synced.identities;
    result.documents += synced.documents;
    return synced.identities + synced.documents;
  };

  if (plan.budgetMs <= 0) {
    // No budget: exactly one batch, highest priority first (the old behavior).
    const n = await pass(plan.backfillOnly ? { maxPriority: LIVE_CITATION_PRIORITY - 1 } : {});
    result.stoppedBy = n ? "budget" : "empty";
    result.elapsedMs = now() - started;
    return result;
  }
  if (!plan.backfillOnly) {
    while (!overBudget()) {
      const n = await pass({ minPriority: LIVE_CITATION_PRIORITY });
      if (!n) break;
      result.liveBatches++;
      if (plan.pauseMs) await sleep(plan.pauseMs);
    }
  }
  let backfill = 0;
  for (;;) {
    if (overBudget()) { result.stoppedBy = "budget"; break; }
    if (backfill >= plan.backfillBatches) { result.stoppedBy = "backfill_batches"; break; }
    await throttle();
    // Builder backfill takes everything except live rows so it never races the
    // resident lane for them; the resident lane takes any row (live first).
    const n = await pass(plan.backfillOnly ? { maxPriority: LIVE_CITATION_PRIORITY - 1 } : {});
    backfill++;
    if (!n) { result.stoppedBy = "empty"; break; }
    if (plan.pauseMs) await sleep(plan.pauseMs);
  }
  result.elapsedMs = now() - started;
  return result;
}

/**
 * Queue sizes without counting 1.7M rows on every run: planner estimates for
 * the totals, exact counts only for the small live set (index range scan).
 */
export async function citationBacklog(sql: Sql) {
  const [row] = await sql<{
    identities_estimate: number; documents_estimate: number; identities_live: number; documents_live: number;
  }[]>`SELECT
    GREATEST((SELECT reltuples FROM pg_class WHERE oid = 'case_citation_work'::regclass), 0)::bigint AS identities_estimate,
    GREATEST((SELECT reltuples FROM pg_class WHERE oid = 'document_citation_work'::regclass), 0)::bigint AS documents_estimate,
    (SELECT count(*) FROM case_citation_work WHERE priority >= ${LIVE_CITATION_PRIORITY})::int AS identities_live,
    (SELECT count(*) FROM document_citation_work WHERE priority >= ${LIVE_CITATION_PRIORITY})::int AS documents_live`;
  const states = await sql<{ state: string; n: number }[]>`
    SELECT state, count(*)::int AS n FROM missing_case_citation GROUP BY state`;
  return {
    identities_remaining_estimate: Number(row?.identities_estimate ?? 0),
    documents_remaining_estimate: Number(row?.documents_estimate ?? 0),
    identities_live: row?.identities_live ?? 0,
    documents_live: row?.documents_live ?? 0,
    missing_by_state: Object.fromEntries(states.map((s) => [s.state, s.n])),
  };
}
