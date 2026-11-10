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

/** Largest case commit while the site is answering. Latency does not lower this. */
export const PUBLISH_BATCH_CAP = 5_000;

/**
 * Publish the full requested batch. A slow page is not a reason to stop.
 * The adaptive loop is what stops, and only after repeated failed probes.
 */
export function pacedPublishLimit(requested: number, _searchMs: number | null, _slowDbQueries: number): number {
  return Math.max(0, Math.floor(requested));
}

export interface PublishPace {
  searchMs: number | null;
  casePageMs: number | null;
  slowQueries: number;
  lockWaits: number;
}

/**
 * Full batches until probes have failed twice in a row (timeout or HTTP 5xx).
 * A slow 200 is still the site answering, so it does not shrink the batch.
 */
export function nextPublishBatch(_previous: number, _pace: PublishPace, consecutiveFailures = 0): number {
  if (consecutiveFailures >= 2) return 0;
  return PUBLISH_BATCH_CAP;
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
