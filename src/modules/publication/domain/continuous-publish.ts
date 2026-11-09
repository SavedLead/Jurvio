/**
 * Continuous publishing stays off until CONTINUOUS_PUBLISH=1.
 * JURVIO_PAUSE_CONTINUOUS_PUBLISH=1 turns it off again even if the first flag is set.
 * SCOTUS stays on the official Court pipeline. Sealed text is never selected.
 */
export type ContinuousBucket = "substantial" | "recent" | "pre2000_thin";

const RANK: Record<ContinuousBucket, number> = { substantial: 0, recent: 1, pre2000_thin: 2 };

export function continuousPublishEnabled(env?: Record<string, string | undefined>): boolean {
  const source = env ?? process.env;
  return source.CONTINUOUS_PUBLISH === "1" && source.JURVIO_PAUSE_CONTINUOUS_PUBLISH !== "1";
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
