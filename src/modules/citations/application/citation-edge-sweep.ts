import type postgres from "postgres";
import { processDirtyBatch, rebuildOutgoing, type DirtyResult } from "./citation-edges";

type Sql = ReturnType<typeof postgres>;

export interface EdgeJobPlan {
  budgetMs: number;
  /** Cases per outgoing batch in the sweep. */
  batch?: number;
  /** Dirty rows per batch. */
  dirtyBatch?: number;
  /** Pause between sweep batches. */
  pauseMs?: number;
  /** Start a new full sweep only when the last one is older than this. */
  sweepEveryMs?: number;
  /** Start a new (non-first) sweep only inside this America/New_York hour window [from, to). */
  offPeakHours?: readonly [number, number];
  /** Force a new sweep now (manual dispatch). */
  forceSweep?: boolean;
  now?: () => Date;
}

export interface EdgeJobResult {
  dirty: DirtyResult & { batches: number };
  sweep: { state: "idle" | "started" | "continued" | "completed"; batches: number; cases: number; skipped: number; edgesRemoved?: number; recounted?: number };
  elapsedMs: number;
}

const WEEK = 7 * 24 * 3600_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isStatementTimeout(error: unknown): boolean {
  if ((error as { code?: string }).code === "57014") return true;
  return String(error instanceof Error ? error.message : error).includes("statement timeout");
}

function easternHour(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(date));
}

async function nextSweepIds(sql: Sql, cursor: string | null, limit: number): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT c.id FROM legal_case c
    WHERE c.publication = 'published' AND (${cursor}::uuid IS NULL OR c.id > ${cursor}::uuid)
    ORDER BY c.id LIMIT ${limit}`;
  return rows.map((row) => row.id);
}

/**
 * The citation-edges job: drain the dirty set, then advance (or start) the
 * resumable full sweep that rebuilds every published case's outgoing edges.
 * Replaces the 2-hour citation-count-snapshot recount: counts now change
 * only for cases whose edges changed, plus one full sweep a week off-peak.
 */
export async function runCitationEdgeJob(sql: Sql, plan: EdgeJobPlan): Promise<EdgeJobResult> {
  const now = plan.now ?? (() => new Date());
  const started = now().getTime();
  const left = () => plan.budgetMs - (now().getTime() - started);
  const batchSize = plan.batch ?? 200;
  const dirtyBatch = plan.dirtyBatch ?? 200;
  const result: EdgeJobResult = {
    dirty: { batches: 0, taken: 0, outgoing: 0, incoming: 0, requeued: 0, edges: 0 },
    sweep: { state: "idle", batches: 0, cases: 0, skipped: 0 },
    elapsedMs: 0,
  };
  const [state] = await sql<{ sweep_started_at: Date | null; sweep_cursor: string | null; sweep_completed_at: Date | null;
    sweep_covered_from: Date | null; sweep_requested_at: Date | null; first_completed_at: Date | null }[]>`
    SELECT sweep_started_at, sweep_cursor, sweep_completed_at, sweep_covered_from, sweep_requested_at, first_completed_at
    FROM citation_edge_build WHERE id`;
  if (!state) throw new Error("citation_edge_build row missing (migration 0172)");
  const recount = Boolean(state.first_completed_at);
  const drainDirty = async (maxBatches: number) => {
    for (let i = 0; i < maxBatches && left() > 0; i++) {
      const r = await processDirtyBatch(sql, dirtyBatch, { recount });
      result.dirty.batches++;
      result.dirty.taken += r.taken; result.dirty.outgoing += r.outgoing; result.dirty.incoming += r.incoming;
      result.dirty.requeued += r.requeued; result.dirty.edges += r.edges;
      if (!r.taken) return true;
    }
    return false;
  };

  // Live changes first, but leave most of the budget for the sweep.
  await drainDirty(recount ? Number.POSITIVE_INFINITY : 25);

  let cursor = state.sweep_cursor;
  if (!state.sweep_started_at) {
    const hour = easternHour(now());
    const [from, to] = plan.offPeakHours ?? [1, 6];
    const requested = Boolean(state.sweep_requested_at
      && (!state.sweep_covered_from || state.sweep_requested_at > state.sweep_covered_from));
    const due = plan.forceSweep || !state.first_completed_at || requested
      || (now().getTime() - (state.sweep_completed_at?.getTime() ?? 0) >= (plan.sweepEveryMs ?? WEEK) && hour >= from && hour < to);
    if (!due || left() <= 0) { result.elapsedMs = now().getTime() - started; return result; }
    await sql`UPDATE citation_edge_build SET sweep_started_at = now(), sweep_cursor = NULL WHERE id`;
    cursor = null;
    result.sweep.state = "started";
  } else {
    result.sweep.state = "continued";
  }

  let limit = batchSize;
  let pending = await nextSweepIds(sql, cursor, batchSize);
  while (pending.length && left() > 0) {
    const slice = pending.slice(0, limit);
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('statement_timeout', '60s', true)`;
        await rebuildOutgoing(tx, slice, false);
        await tx`UPDATE citation_edge_build SET sweep_cursor = ${slice[slice.length - 1]!}::uuid WHERE id`;
      });
      result.sweep.batches++; result.sweep.cases += slice.length;
      cursor = slice[slice.length - 1]!;
      pending = pending.slice(slice.length);
      limit = batchSize;
    } catch (error) {
      if (!isStatementTimeout(error)) throw error;
      if (slice.length > 1) { limit = Math.max(1, Math.floor(slice.length / 4)); continue; }
      // One case that cannot finish in 60 s keeps its previous edges.
      result.sweep.skipped++;
      console.log(JSON.stringify({ citationEdges: "skipped", caseId: slice[0], reason: "statement_timeout" }));
      cursor = slice[0]!;
      await sql`UPDATE citation_edge_build SET sweep_cursor = ${cursor}::uuid WHERE id`;
      pending = pending.slice(1);
    }
    if (!pending.length) pending = await nextSweepIds(sql, cursor, batchSize);
    if (result.sweep.batches % 10 === 0) await drainDirty(2);
    if (plan.pauseMs) await sleep(plan.pauseMs);
  }
  if (!pending.length && left() > 0) {
    const [sweep] = await sql<{ sweep_started_at: Date }[]>`SELECT sweep_started_at FROM citation_edge_build WHERE id`;
    // Edges not refreshed by this sweep belong to cases that are no longer visible.
    const removed = await sql`DELETE FROM case_citation_edge WHERE refreshed_at < ${sweep!.sweep_started_at} RETURNING 1`;
    let recounted = 0;
    let after: string | null = null;
    for (;;) {
      const ids: { case_id: string }[] = await sql<{ case_id: string }[]>`
        SELECT case_id FROM case_citation_count WHERE (${after}::uuid IS NULL OR case_id > ${after}::uuid) ORDER BY case_id LIMIT 5000`;
      if (!ids.length) break;
      after = ids[ids.length - 1]!.case_id;
      const updated = await sql`
        UPDATE case_citation_count c SET cited_by = (SELECT count(*)::int FROM case_citation_edge e WHERE e.cited_case_id = c.case_id), refreshed_at = now()
        WHERE c.case_id = ANY(${ids.map((r) => r.case_id)}::uuid[]) RETURNING 1`;
      recounted += updated.length;
    }
    await sql`
      DELETE FROM case_citation_count stat WHERE NOT EXISTS (
        SELECT 1 FROM legal_case c WHERE c.id = stat.case_id AND c.publication = 'published')`;
    await sql`UPDATE citation_edge_build SET sweep_covered_from = sweep_started_at, sweep_started_at = NULL,
      sweep_cursor = NULL, sweep_completed_at = now(), first_completed_at = COALESCE(first_completed_at, now()) WHERE id`;
    result.sweep = { ...result.sweep, state: "completed", edgesRemoved: removed.length, recounted };
  }
  result.elapsedMs = now().getTime() - started;
  return result;
}
