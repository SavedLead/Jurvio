import { describe, expect, it } from "vitest";
import { evaluatePublicationCandidate } from "./publication-policy";

const qualified = {
  hasCanonicalSource: true,
  hasStableIdentity: true,
  hasMeaningfulContent: true,
  isBlockedOrSealed: false,
  verification: "verified" as const,
  containsUnresolvedSensitiveData: false,
};

describe("publication preflight", () => {
  it("never automatically publishes a qualified record", () => {
    expect(evaluatePublicationCandidate(qualified)).toMatchObject({
      recommendation: "manual_review",
      reasons: ["human_publication_approval_required"],
    });
  });

  it("rejects sealed or source-less content", () => {
    expect(evaluatePublicationCandidate({
      ...qualified,
      isBlockedOrSealed: true,
      hasCanonicalSource: false,
    })).toMatchObject({
      recommendation: "reject",
      reasons: ["blocked_or_sealed", "missing_canonical_source"],
    });
  });

  it("routes unresolved verification and sensitive data to review", () => {
    expect(evaluatePublicationCandidate({
      ...qualified,
      verification: "conflict",
      containsUnresolvedSensitiveData: true,
    })).toMatchObject({
      recommendation: "manual_review",
      reasons: ["sensitive_data_review", "verification_conflict"],
    });
  });
});
