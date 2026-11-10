/**
 * Continuous publishing is on unless CONTINUOUS_PUBLISH=0 or
 * JURVIO_PAUSE_CONTINUOUS_PUBLISH=1. SCOTUS stays on the official Court pipeline.
 * Sealed text is never selected.
 */
export type ContinuousBucket = "substantial" | "recent" | "pre2000_thin";

const RANK: Record<ContinuousBucket, number> = { substantial: 0, recent: 1, pre2000_thin: 2 };

export function continuousPublishEnabled(env?: Record<string, string | undefined>): boolean {
  const source = env ?? process.env;
  if (source.JURVIO_PAUSE_CONTINUOUS_PUBLISH === "1" || source.CONTINUOUS_PUBLISH === "0") return false;
  return true;
}

/** Metadata publication stays on unless JURVIO_PAUSE_FEDERAL_METADATA=1. */
export function metadataPublicationEnabled(env?: Record<string, string | undefined>): boolean {
  const source = env ?? process.env;
  return source.JURVIO_PAUSE_FEDERAL_METADATA !== "1";
}

/** One-time docket display backfill. Off only when explicitly paused. */
export function docketDisplayBackfillEnabled(env?: Record<string, string | undefined>): boolean {
  const source = env ?? process.env;
  return source.JURVIO_PAUSE_DOCKET_DISPLAY_BACKFILL !== "1";
}

/**
 * Shrink a publish batch when public search is slow or the database already
 * has slow web queries. A failed probe uses a small batch rather than stopping.
 */
export function pacedPublishLimit(requested: number, searchMs: number | null, slowDbQueries: number): number {
  const capped = Math.max(0, Math.floor(requested));
  if (searchMs !== null && (searchMs >= 2000 || slowDbQueries >= 3)) return 0;
  if (searchMs === null || searchMs >= 1500 || slowDbQueries > 0) return Math.min(capped, Math.max(1, Math.floor(capped / 4)));
  return capped;
}

export interface PublishPace {
  searchMs: number | null;
  casePageMs: number | null;
  slowQueries: number;
  lockWaits: number;
}

/** Next short-commit size. Ramp while search and case pages stay under 1.5s. Stop at 2s. */
export function nextPublishBatch(previous: number, pace: PublishPace): number {
  const search = pace.searchMs;
  const page = pace.casePageMs;
  const known = [search, page].filter((value): value is number => value !== null);
  const slowest = known.length ? Math.max(...known) : null;
  if ((search !== null && search >= 2000) || (page !== null && page >= 2000) || pace.slowQueries >= 3 || pace.lockWaits >= 3) {
    return 0;
  }
  const base = Math.max(400, Math.floor(previous) || 400);
  if (slowest === null || slowest >= 3000 || pace.slowQueries > 0 || pace.lockWaits > 0) {
    return Math.max(200, Math.floor(base / 4));
  }
  if (slowest < 1500) return Math.min(10_000, Math.floor(base * 1.5));
  return Math.min(10_000, base);
}

export function continuousPublishBucket(input: {
  filedOn: string | null;
  hasOpinionText: boolean;
  signalCount: number;
  hasName: boolean;
  now?: Date;
}): ContinuousBucket | null {
  const now = input.now ?? new Date();
  const recentCutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  recentCutoff.setUTCDate(recentCutoff.getUTCDate() - 90);
  const filed = input.filedOn ? new Date(`${input.filedOn.slice(0, 10)}T00:00:00Z`) : null;
  const substantial = input.hasOpinionText || (input.hasName && input.signalCount >= 2 && filed !== null && filed >= new Date("2000-01-01T00:00:00Z"));
  if (substantial) return "substantial";
  if (filed && filed >= recentCutoff && filed <= now) return "recent";
  if (filed && filed < new Date("2000-01-01T00:00:00Z")) return "pre2000_thin";
  return null;
}

export function orderContinuousCases<T extends { bucket: ContinuousBucket; filedOn: string | null }>(cases: readonly T[]): T[] {
  return [...cases].sort((a, b) => {
    const rank = RANK[a.bucket] - RANK[b.bucket];
    if (rank !== 0) return rank;
    return (b.filedOn ?? "").localeCompare(a.filedOn ?? "");
  });
}
