import type { db } from "@/db/client";

// Lane-health self-detection for the on-box scheduler.
//
// `recordLaneRun` is called by the scheduler at the end of every lane child
// process; `detectFailingLanes` is called by the supervisor each tick to find
// lanes that keep crashing (ran repeatedly in the window and never once
// succeeded), so it can surface them as ingestion_repair_action rows instead of
// letting a crash-loop stay invisible. `laneHealthMatrix` gives read-only status
// reports the most-recent outcome per lane.
//
// Nothing here restarts or mutates a lane — detection and audit only. Deciding to
// change a lane's config or code stays a human/PR action, in keeping with the
// supervisor's "never silently repair beyond safe requeues" contract.

type Db = ReturnType<typeof db>;

export interface LaneRunOutcome {
  readonly lane: string;
  readonly schedulerLane: string;
  readonly command: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly errorTail: string | null;
}

/**
 * A lane run is healthy only on a clean exit: exit code 0 and no terminating
 * signal. Any non-zero code (e.g. the startup throw that exits 1), a signal death
 * (SIGKILL/137 OOM, SIGTERM), or a null exit code from a spawn failure is NOT ok.
 * Pure so it can be unit-tested without a database.
 */
export function isLaneRunHealthy(exitCode: number | null, signal: string | null): boolean {
  return exitCode === 0 && signal === null;
}

/** Trailing bytes of a lane's output to persist, bounded so a chatty lane can't bloat the row. */
export const LANE_ERROR_TAIL_MAX = 8_000;

/**
 * Persist the outcome of one lane child process. Best-effort: callers must wrap
 * this so a bookkeeping-DB failure never takes down the scheduler.
 */
export async function recordLaneRun(sql: Db, outcome: LaneRunOutcome): Promise<void> {
  const ok = isLaneRunHealthy(outcome.exitCode, outcome.signal);
  // Cap the stored tail so a noisy lane can never bloat the row.
  const tail = outcome.errorTail ? outcome.errorTail.slice(-LANE_ERROR_TAIL_MAX) : null;
  await sql`
    INSERT INTO scheduler_lane_run (lane, scheduler_lane, command, started_at, finished_at,
      duration_ms, exit_code, signal, ok, error_tail)
    VALUES (${outcome.lane}, ${outcome.schedulerLane}, ${outcome.command},
      ${outcome.startedAt.toISOString()}, ${outcome.finishedAt.toISOString()},
      ${outcome.durationMs}, ${outcome.exitCode}, ${outcome.signal}, ${ok},
      ${ok ? null : tail})
  `;
}

export interface FailingLane {
  readonly lane: string;
  readonly schedulerLane: string;
  readonly failedRuns: number;
  readonly lastExitCode: number | null;
  readonly lastSignal: string | null;
  readonly lastRunAt: Date;
  readonly lastErrorTail: string | null;
}

export interface DetectFailingLanesOptions {
  /** Only consider runs within this many minutes. Default 30. */
  readonly windowMinutes?: number;
  /** A lane must have failed at least this many times in the window. Default 2. */
  readonly minFailures?: number;
}

/**
 * A lane is "persistently failing" when, within the window, it ran at least
 * `minFailures` times and never once exited cleanly. That distinguishes a real
 * crash-loop (e.g. a lane throwing on startup every cycle) from an occasional
 * transient failure between healthy runs, keeping false positives low.
 */
export async function detectFailingLanes(
  sql: Db,
  options: DetectFailingLanesOptions = {},
): Promise<FailingLane[]> {
  const windowMinutes = options.windowMinutes ?? 30;
  const minFailures = options.minFailures ?? 2;
  const rows = await sql<Array<{
    lane: string;
    scheduler_lane: string;
    failed_runs: string;
    last_exit_code: number | null;
    last_signal: string | null;
    last_run_at: Date;
    last_error_tail: string | null;
  }>>`
    SELECT lane, scheduler_lane,
      count(*) FILTER (WHERE NOT ok) AS failed_runs,
      (array_agg(exit_code ORDER BY started_at DESC))[1] AS last_exit_code,
      (array_agg(signal ORDER BY started_at DESC))[1] AS last_signal,
      max(started_at) AS last_run_at,
      (array_agg(error_tail ORDER BY started_at DESC) FILTER (WHERE NOT ok))[1] AS last_error_tail
    FROM scheduler_lane_run
    WHERE started_at > now() - make_interval(mins => ${windowMinutes})
    GROUP BY lane, scheduler_lane
    HAVING count(*) FILTER (WHERE ok) = 0
      AND count(*) FILTER (WHERE NOT ok) >= ${minFailures}
    ORDER BY max(started_at) DESC
  `;
  return rows.map((row) => ({
    lane: row.lane,
    schedulerLane: row.scheduler_lane,
    failedRuns: Number(row.failed_runs),
    lastExitCode: row.last_exit_code,
    lastSignal: row.last_signal,
    lastRunAt: row.last_run_at,
    lastErrorTail: row.last_error_tail,
  }));
}

export interface LaneHealth {
  readonly lane: string;
  readonly schedulerLane: string;
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly lastRunAt: Date;
  readonly durationMs: number | null;
}

/** Most-recent run per lane in the window, for read-only status matrices. */
export async function laneHealthMatrix(sql: Db, windowMinutes = 60): Promise<LaneHealth[]> {
  const rows = await sql<Array<{
    lane: string;
    scheduler_lane: string;
    ok: boolean;
    exit_code: number | null;
    last_run_at: Date;
    duration_ms: number | null;
  }>>`
    SELECT DISTINCT ON (lane) lane, scheduler_lane, ok, exit_code,
      started_at AS last_run_at, duration_ms
    FROM scheduler_lane_run
    WHERE started_at > now() - make_interval(mins => ${windowMinutes})
    ORDER BY lane, started_at DESC
  `;
  return rows.map((row) => ({
    lane: row.lane,
    schedulerLane: row.scheduler_lane,
    ok: row.ok,
    exitCode: row.exit_code,
    lastRunAt: row.last_run_at,
    durationMs: row.duration_ms,
  }));
}
