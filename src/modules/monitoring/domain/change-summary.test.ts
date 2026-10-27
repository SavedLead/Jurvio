import { describe, expect, it } from "vitest";
import { initialCaseStatus, type CaseStatus, type StatusEvent } from "@/modules/cases/domain/status";
import { summarizeStatusChange } from "./change-summary";

const event = (overrides: Partial<StatusEvent> = {}): StatusEvent => ({
  id: "evt-1",
  type: "judgment_entered",
  occurredOn: "2026-03-01",
  sourceLabel: "N.D. Cal. docket #58",
  ...overrides,
});

describe("summarizeStatusChange", () => {
  it("fills all five required parts plus provenance", () => {
    const prev: CaseStatus = { ...initialCaseStatus, activity: "active", phase: "trial" };
    const next: CaseStatus = { ...prev, activity: "closed", phase: "post_trial", judgment: "entered", disposition: "complete" };
    const s = summarizeStatusChange(prev, next, event());

    for (const part of [s.whatHappened, s.whyItMatters, s.whatChanged, s.unresolved, s.whatNext]) {
      expect(part.length).toBeGreaterThan(0);
    }
    expect(s.sourceLabel).toBe("N.D. Cal. docket #58");
    expect(s.ruleVersion).toBe(next.ruleVersion);
  });

  it("describes the concrete status delta", () => {
    const prev: CaseStatus = { ...initialCaseStatus, judgment: "none", disposition: "none" };
    const next: CaseStatus = { ...prev, judgment: "entered", disposition: "complete" };
    const s = summarizeStatusChange(prev, next, event());
    expect(s.whatChanged).toContain("judgment entered");
    expect(s.whatChanged).toContain("all claims resolved");
  });

  it("reports no-change when the status is unchanged", () => {
    const status: CaseStatus = { ...initialCaseStatus, activity: "active" };
    const s = summarizeStatusChange(status, status, event({ type: "ambiguous" }));
    expect(s.whatChanged).toBe("No change to the overall case status.");
  });

  it("flags a pending appeal as unresolved", () => {
    const prev: CaseStatus = { ...initialCaseStatus, judgment: "entered" };
    const next: CaseStatus = { ...prev, appeal: "filed" };
    const s = summarizeStatusChange(prev, next, event({ type: "notice_of_appeal_filed" }));
    expect(s.unresolved).toContain("appeal is pending");
  });

  it("reports nothing outstanding on a fully resolved case", () => {
    const prev: CaseStatus = { ...initialCaseStatus, activity: "active" };
    const next: CaseStatus = { ...prev, activity: "closed", disposition: "complete", judgment: "entered", appeal: "resolved" };
    const s = summarizeStatusChange(prev, next, event({ type: "appeal_resolved" }));
    expect(s.unresolved).toBe("Nothing further appears outstanding on the record.");
  });

  it("prefers a specific court entry detail for what-happened when provided", () => {
    const status: CaseStatus = { ...initialCaseStatus };
    const s = summarizeStatusChange(status, status, event({ detail: "Clerk's judgment entered for plaintiff." }));
    expect(s.whatHappened).toBe("Clerk's judgment entered for plaintiff.");
  });
});
