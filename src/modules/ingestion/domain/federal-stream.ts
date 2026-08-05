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
  /**
   * Legacy field retained only for wire-compatibility with checkpoints written by
   * the old fixed-batch throttle. It no longer limits how much a cycle processes —
   * adaptive concurrency plus the runaway safety bound govern that now — but keeping
   * it lets already-stored production cursors decode without a migration.
   */
  batchSize: number;
  completedWindows: number;
}

/**
 * Nominal value stamped onto newly written cursors for the retained `batchSize`
 * field. It is informational only; nothing throttles on it anymore.
 */
export const LEGACY_CURSOR_BATCH_SIZE = 100;

export interface FederalPublicationCandidate {
  caption: string;
  docketNumber: string;
  courtJurisdiction: string | null;
  courtProviderId: string | null;
  courtVerification: string | null;
  sourceArtifactId: string | null;
  sourceProviderCode: string | null;
  sourceRecordId: string | null;
  sourceUri: string | null;
  sourceContentHash: string | null;
  sourceRetrievedAt: string | null;
  hasReadableContent: boolean;
  canonicalIdentifier: string | null;
  canonicalIdentifierCount: number;
  identityCollisionCount: number;
  unresolvedRejections: number;
  restrictedText: string;
}

export interface FederalPublicationDecision {
  eligible: boolean;
  restricted: boolean;
  reasons: string[];
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
    typeof parsed.completedWindows !== "number"
  ) {
    throw new Error("Stored federal ingestion checkpoint is malformed");
  }
  // `batchSize` is legacy and no longer throttles anything; accept whatever a stored
  // cursor carried (or default it) so old checkpoints keep decoding.
  const batchSize =
    typeof parsed.batchSize === "number" && Number.isFinite(parsed.batchSize)
      ? parsed.batchSize
      : LEGACY_CURSOR_BATCH_SIZE;
  return {
    version: 1,
    windowStart: parsed.windowStart,
    windowEnd: parsed.windowEnd,
    next: parsed.next,
    batchSize,
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

export function isFederalJurisdiction(value: string | null): boolean {
  if (isNonBankruptcyFederalJurisdiction(value)) return true;
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "fb" || normalized.includes("bankruptcy");
}

export function isRestrictedDocketText(value: string): boolean {
  return /\b(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\b/i.test(value);
}

export function isValidHttpSourceUri(sourceUri: string | null): boolean {
  if (!sourceUri || !sourceUri.trim()) return false;
  let parsed: URL;
  try {
    parsed = new URL(sourceUri);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * A federal court awaiting decision/opinion ingestion, annotated with how much recent
 * activity it has seen so districts can be serviced busiest-first.
 */
export interface FederalCourtWorkload {
  providerCourtId: string;
  jurisdiction: string | null;
  /** Recent docket-entry volume for this court; higher == busier == higher priority. */
  recentEventVolume: number;
}

/**
 * Service-priority tier for a federal court. Lower rank is serviced first:
 *   0 = SCOTUS, 1 = circuit/appellate courts, 2 = district courts, 3 = anything else.
 *
 * SCOTUS additionally runs on its own dedicated scheduler lane; ranking it first here
 * is belt-and-suspenders for any loop that happens to see it alongside other courts.
 */
export function federalCourtServiceRank(court: {
  providerCourtId: string;
  jurisdiction: string | null;
}): number {
  if (court.providerCourtId.trim().toLowerCase() === "scotus") return 0;
  const normalized = court.jurisdiction?.trim().toLowerCase() ?? "";
  if (normalized === "f" || normalized.includes("appellate")) return 1;
  if (normalized === "fd" || normalized.includes("district")) return 2;
  return 3;
}

/**
 * Total ordering for federal court work: by service rank first (SCOTUS -> circuits ->
 * districts -> other), then busiest-first within a rank (recent event volume, desc), then
 * a stable provider-id tiebreak so the order is deterministic.
 */
export function compareFederalCourtPriority(a: FederalCourtWorkload, b: FederalCourtWorkload): number {
  const rankDelta = federalCourtServiceRank(a) - federalCourtServiceRank(b);
  if (rankDelta !== 0) return rankDelta;
  const volumeDelta = b.recentEventVolume - a.recentEventVolume;
  if (volumeDelta !== 0) return volumeDelta;
  return a.providerCourtId.localeCompare(b.providerCourtId);
}

/** Returns a new array of courts ordered by {@link compareFederalCourtPriority}. */
export function orderFederalCourtsByPriority<T extends FederalCourtWorkload>(courts: readonly T[]): T[] {
  return [...courts].sort(compareFederalCourtPriority);
}

export function evaluateFederalPublicationCandidate(
  candidate: FederalPublicationCandidate,
): FederalPublicationDecision {
  const reasons: string[] = [];
  const restricted = isRestrictedDocketText(candidate.restrictedText);
  if (!candidate.caption.trim() || !candidate.docketNumber.trim()) {
    reasons.push("missing_stable_identity");
  }
  if (!isFederalJurisdiction(candidate.courtJurisdiction)) {
    reasons.push("unverified_federal_court");
  }
  if (!candidate.courtProviderId) reasons.push("missing_court_provider_identity");
  if (candidate.courtVerification !== "verified") reasons.push("unverified_court_record");
  if (!candidate.sourceArtifactId) reasons.push("missing_source_artifact");
  if (!isValidHttpSourceUri(candidate.sourceUri)) {
    reasons.push("missing_source_url");
  }
  if (!candidate.sourceContentHash || !/^[a-f0-9]{64}$/i.test(candidate.sourceContentHash)) {
    reasons.push("invalid_source_checksum");
  }
  if (!candidate.sourceRetrievedAt || Number.isNaN(Date.parse(candidate.sourceRetrievedAt))) {
    reasons.push("missing_retrieval_timestamp");
  }
  if (!candidate.hasReadableContent) reasons.push("missing_readable_content");
  if (candidate.identityCollisionCount > 1) reasons.push("duplicate_identity_collision");
  if (candidate.unresolvedRejections > 0) reasons.push("unresolved_ingestion_rejection");
  if (restricted) reasons.push("restricted_or_sensitive");
  return { eligible: reasons.length === 0, restricted, reasons };
}
