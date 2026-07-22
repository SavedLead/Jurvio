import { describe, expect, it } from "vitest";
import { initialCaseStatus, replayStatus, STATUS_RULE_VERSION, type StatusEvent } from "./status";

describe("deterministic case status", () => {
  it("replays the same events deterministically", () => {
    const events: StatusEvent[] = [
      { id: "2", type: "motion_to_dismiss_denied", occurredOn: "2026-05-12", sourceLabel: "Order #25" },
      { id: "1", type: "complaint_filed", occurredOn: "2026-04-03", sourceLabel: "Complaint #1" },
    ];

    expect(replayStatus(events)).toEqual(replayStatus([...events].reverse()));
    expect(replayStatus(events)).toMatchObject({
      activity: "active",
      phase: "pleadings",
      verification: "verified",
      ruleVersion: STATUS_RULE_VERSION,
      triggeringEventId: "2",
    });
  });

  it("does not guess when an event is ambiguous", () => {
    const status = replayStatus([
      { id: "1", type: "complaint_filed", occurredOn: "2026-04-03", sourceLabel: "Complaint #1" },
      { id: "2", type: "ambiguous", occurredOn: "2026-05-20", sourceLabel: "Minute entry #32" },
    ]);

    expect(status.verification).toBe("needs_review");
    expect(status.activity).toBe("active");
    expect(status.explanation).toContain("has not changed");
  });

  it("distinguishes partial disposition from final judgment", () => {
    const partial = replayStatus([
      { id: "1", type: "summary_judgment_granted_partial", occurredOn: "2026-02-06", sourceLabel: "Order #74" },
    ]);
    expect(partial.disposition).toBe("partial");
    expect(partial.activity).toBe("active");

    const judgment = replayStatus([
      { id: "2", type: "judgment_entered", occurredOn: "2026-06-18", sourceLabel: "Judgment #118" },
    ]);
    expect(judgment).toMatchObject({
      activity: "closed",
      disposition: "complete",
      judgment: "entered",
      appeal: "eligible",
    });
  });

  it("starts unverified", () => {
    expect(initialCaseStatus.verification).toBe("not_verified");
  });
});
