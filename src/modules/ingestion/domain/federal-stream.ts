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

export const FEDERAL_BATCH_STEPS = [100, 1_000, 10_000] as const;

export function normalizeBatchSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error("Federal batch size must be between 1 and 10000");
  }
  return value;
}

export function nextBatchSize(
  current: number,
  requested: number,
  failed: number,
  held: number,
  promotionApproved: boolean,
): number {
  normalizeBatchSize(current);
  normalizeBatchSize(requested);
  if (!promotionApproved || failed > 0 || held > 0 || requested <= current) return current;
  const currentIndex = FEDERAL_BATCH_STEPS.indexOf(
    current as (typeof FEDERAL_BATCH_STEPS)[number],
  );
  const requestedIndex = FEDERAL_BATCH_STEPS.indexOf(
    requested as (typeof FEDERAL_BATCH_STEPS)[number],
  );
  if (currentIndex < 0 || requestedIndex !== currentIndex + 1) {
    throw new Error("Federal batch promotion must follow 100 -> 1000 -> 10000");
  }
  return requested;
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
  return /\b(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\b/i.test(value);
}

export function evaluateFederalPublicationCandidate(
  candidate: FederalPublicationCandidate,
): FederalPublicationDecision {
  const reasons: string[] = [];
  const restricted = isRestrictedDocketText(candidate.restrictedText);
  if (!candidate.caption.trim() || !candidate.docketNumber.trim()) {
    reasons.push("missing_stable_identity");
  }
  if (!isNonBankruptcyFederalJurisdiction(candidate.courtJurisdiction)) {
    reasons.push("unverified_federal_court");
  }
  if (!candidate.courtProviderId) reasons.push("missing_court_provider_identity");
  if (candidate.courtVerification !== "verified") reasons.push("unverified_court_record");
  if (!candidate.sourceArtifactId) reasons.push("missing_source_artifact");
  if (candidate.sourceProviderCode !== "courtlistener") {
    reasons.push("unsupported_source_provider");
  }
  if (!candidate.sourceRecordId || candidate.sourceRecordId !== candidate.canonicalIdentifier) {
    reasons.push("source_identifier_mismatch");
  }
  if (
    !candidate.sourceUri?.startsWith("https://www.courtlistener.com/api/rest/v4/dockets/")
  ) {
    reasons.push("invalid_source_uri");
  }
  if (!candidate.sourceContentHash || !/^[a-f0-9]{64}$/i.test(candidate.sourceContentHash)) {
    reasons.push("invalid_source_checksum");
  }
  if (!candidate.sourceRetrievedAt || Number.isNaN(Date.parse(candidate.sourceRetrievedAt))) {
    reasons.push("missing_retrieval_timestamp");
  }
  if (candidate.canonicalIdentifierCount !== 1) {
    reasons.push("ambiguous_canonical_identifier");
  }
  if (candidate.identityCollisionCount > 1) reasons.push("duplicate_identity_collision");
  if (candidate.unresolvedRejections > 0) reasons.push("unresolved_ingestion_rejection");
  if (restricted) reasons.push("restricted_or_sensitive");
  return { eligible: reasons.length === 0, restricted, reasons };
}
