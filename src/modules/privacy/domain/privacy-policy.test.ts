import { describe, expect, it } from "vitest";
import { canApprovePrivacyAction, canFinalizePrivacyDecision, canonicalPrivacyRule, maskedEntityName } from "./privacy-policy";

describe("privacy request policy", () => {
  it("requires identity verification before approving a remedy", () => {
    expect(canFinalizePrivacyDecision({ identityStatus: "pending", decision: "approved", reviewerNotes: "Evidence pending." })).toBe(false);
    expect(canFinalizePrivacyDecision({ identityStatus: "verified", decision: "approved", reviewerNotes: "Identity and target match reviewed." })).toBe(true);
  });

  it("allows a documented rejection without collecting identity evidence", () => {
    expect(canFinalizePrivacyDecision({ identityStatus: "not_started", decision: "rejected", reviewerNotes: "Requester withdrew duplicate request." })).toBe(true);
  });

  it("redirects a name-bearing URL to a stable public path", () => {
    expect(canonicalPrivacyRule({ originalPath: "/case/jv-123/acme-v-widgets", stablePublicPath: "/case/jv-123", nameMustBeRemoved: true })).toEqual({ directive: "redirect_301", canonicalPath: "/case/jv-123" });
  });

  it("uses neutral reversible replacement labels", () => {
    expect(maskedEntityName("person")).toBe("Private individual");
  });

  it("requires a second reviewer for a proposed remedy", () => {
    expect(canApprovePrivacyAction("reviewer-a", "reviewer-a")).toBe(false);
    expect(canApprovePrivacyAction("reviewer-a", "reviewer-b")).toBe(true);
  });
});
