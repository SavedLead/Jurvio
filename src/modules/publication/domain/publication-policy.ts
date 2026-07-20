export const PUBLICATION_PREFLIGHT_VERSION = "publication-preflight-v1";

export interface PublicationCandidate {
  hasCanonicalSource: boolean;
  hasStableIdentity: boolean;
  hasMeaningfulContent: boolean;
  isBlockedOrSealed: boolean;
  verification: "verified" | "stale" | "conflict" | "needs_review" | "not_verified";
  containsUnresolvedSensitiveData: boolean;
}

export type PublicationRecommendation = "reject" | "manual_review";

export interface PublicationPreflight {
  recommendation: PublicationRecommendation;
  reasons: string[];
  version: string;
}

export function evaluatePublicationCandidate(
  candidate: PublicationCandidate,
): PublicationPreflight {
  const reasons: string[] = [];

  if (candidate.isBlockedOrSealed) reasons.push("blocked_or_sealed");
  if (!candidate.hasCanonicalSource) reasons.push("missing_canonical_source");
  if (!candidate.hasStableIdentity) reasons.push("missing_stable_identity");
  if (!candidate.hasMeaningfulContent) reasons.push("thin_or_empty_content");

  if (reasons.length > 0) {
    return { recommendation: "reject", reasons, version: PUBLICATION_PREFLIGHT_VERSION };
  }

  if (candidate.containsUnresolvedSensitiveData) reasons.push("sensitive_data_review");
  if (candidate.verification !== "verified") {
    reasons.push("verification_" + candidate.verification);
  }
  if (reasons.length === 0) reasons.push("human_publication_approval_required");

  return {
    recommendation: "manual_review",
    reasons,
    version: PUBLICATION_PREFLIGHT_VERSION,
  };
}
