import { describe, expect, it } from "vitest";
import { deriveDismissalAmendmentAnswers, type EvidenceEvent } from "./deterministic";

const dismissal: EvidenceEvent = { id: "order-1", occurredOn: "2026-07-09", eventType: "order_dismissal", description: "Complaint dismissed without prejudice. Plaintiff may file an amended complaint by August 1, 2026." };

describe("deterministic dismissal and amendment intelligence", () => {
  it("shows a live deadline before it passes", () => {
    const answers = deriveDismissalAmendmentAnswers([dismissal], "2026-07-20");
    expect(answers.find((a) => a.answerKey === "current_status")).toMatchObject({ state: "awaiting_deadline", refreshOn: "2026-08-01" });
  });

  it("does not guess after the deadline passes", () => {
    const answer = deriveDismissalAmendmentAnswers([dismissal], "2026-08-04").find((a) => a.answerKey === "current_status");
    expect(answer?.state).toBe("court_update_unknown");
    expect(answer?.text).toContain("does not yet have a later court entry");
  });

  it("revises itself when an amended complaint appears", () => {
    const amended: EvidenceEvent = { id: "entry-2", occurredOn: "2026-07-31", eventType: "amended_complaint", description: "First amended complaint filed" };
    const answer = deriveDismissalAmendmentAnswers([dismissal, amended], "2026-08-04").find((a) => a.answerKey === "current_status");
    expect(answer).toMatchObject({ state: "verified", evidenceIds: ["order-1", "entry-2"] });
  });
});
