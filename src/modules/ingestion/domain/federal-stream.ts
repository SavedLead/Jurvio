export type FederalLoop =
  | "new-case-discovery"
  | "active-case-updates"
  | "material-decisions"
  | "historical-backfill"
  | "publication-quarantine";

export interface StreamCursor {
  version: 1;
  windowStart: string;
  windowEnd: string;
  next: string | null;
  batchSize: number;
  completedWindows: number;
}

export const FEDERAL_BATCH_STEPS = [100, 1_000, 10_000] as const;

export function normalizeBatchSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error("Federal batch size must be between 1 and 10000");
  }
  return value;
}

export function nextBatchSize(current: number, failed: number, held: number): number {
  normalizeBatchSize(current);
  if (failed > 0 || held > 0) return current;
  const index = FEDERAL_BATCH_STEPS.findIndex((value) => value >= current);
  if (index < 0 || index === FEDERAL_BATCH_STEPS.length - 1) return 10_000;
  return FEDERAL_BATCH_STEPS[index + 1] ?? 10_000;
}

export function encodeStreamCursor(cursor: StreamCursor): string {
  return JSON.stringify(cursor);
}

export function decodeStreamCursor(value: string | null, fallback: StreamCursor): StreamCursor {
  if (!value) return fallback;
  const parsed = JSON.parse(value) as Partial<StreamCursor>;
  if (
    parsed.version !== 1 ||
    typeof parsed.windowStart !== "string" ||
    typeof parsed.windowEnd !== "string" ||
    !(typeof parsed.next === "string" || parsed.next === null) ||
    typeof parsed.batchSize !== "number" ||
    typeof parsed.completedWindows !== "number"
  ) {
    throw new Error("Stored federal ingestion checkpoint is malformed");
  }
  return {
    version: 1,
    windowStart: parsed.windowStart,
    windowEnd: parsed.windowEnd,
    next: parsed.next,
    batchSize: normalizeBatchSize(parsed.batchSize),
    completedWindows: parsed.completedWindows,
  };
}

export function isNonBankruptcyFederalJurisdiction(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("bankruptcy") || normalized === "fb") return false;
  return normalized === "f" ||
    normalized === "fd" ||
    normalized === "federal" ||
    normalized.includes("federal district") ||
    normalized.includes("federal appellate");
}

export function isRestrictedDocketText(value: string): boolean {
  return /\b(sealed|restricted|under seal|minor|juvenile)\b/i.test(value);
}
