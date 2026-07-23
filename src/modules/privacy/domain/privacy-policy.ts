export type PrivacyVerificationStatus = "not_started" | "pending" | "verified" | "failed" | "expired";
export type PrivacyRequestDecision = "approved" | "partially_approved" | "rejected";

export interface PrivacyDecisionInput {
  identityStatus: PrivacyVerificationStatus;
  decision: PrivacyRequestDecision;
  reviewerNotes: string;
}

export function canFinalizePrivacyDecision(input: PrivacyDecisionInput): boolean {
  if (!input.reviewerNotes.trim()) return false;
  if (input.decision === "rejected") return true;
  return input.identityStatus === "verified";
}

export function canonicalPrivacyRule(input: {
  originalPath: string;
  stablePublicPath: string;
  nameMustBeRemoved: boolean;
}): { directive: "noindex" | "redirect_301"; canonicalPath: string | null } {
  if (!input.nameMustBeRemoved) return { directive: "noindex", canonicalPath: null };
  if (input.originalPath === input.stablePublicPath) return { directive: "noindex", canonicalPath: null };
  return { directive: "redirect_301", canonicalPath: input.stablePublicPath };
}

export function maskedEntityName(entityType: "person" | "organization"): string {
  return entityType === "person" ? "Private individual" : "Private organization";
}

export function canApprovePrivacyAction(proposedBy: string, reviewerId: string): boolean {
  return proposedBy !== reviewerId;
}
