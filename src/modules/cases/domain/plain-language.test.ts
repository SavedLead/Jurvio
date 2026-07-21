import { describe, expect, it } from "vitest";
import { presentCaseStatus, readableStatusValue } from "./plain-language";

describe("plain-language case status", () => {
  it("does not infer a status from unverified fields", () => {
    expect(
      presentCaseStatus({
        activityState: "active",
        proceduralPhase: "discovery",
        dispositionScope: "none",
        judgmentState: "none",
        appealState: "unavailable",
        verification: "needs_review",
        statusExplanation: "Discovery is underway.",
      }),
    ).toEqual({
      headline: "Current status not yet verified",
      explanation:
        "Jurvio has not found a qualifying court event that safely establishes the current status.",
      verified: false,
    });
  });

  it("uses a verified deterministic explanation", () => {
    const result = presentCaseStatus({
      activityState: "active",
      proceduralPhase: "discovery",
      dispositionScope: "none",
      judgmentState: "none",
      appealState: "unavailable",
      verification: "verified",
      statusExplanation: "The latest qualifying court event shows that discovery is underway.",
    });
    expect(result.headline).toBe("Case appears active");
    expect(result.verified).toBe(true);
  });

  it("turns machine values into readable labels", () => {
    expect(readableStatusValue("pre_trial")).toBe("pre trial");
    expect(readableStatusValue("none")).toBe("Not shown in the verified record");
  });
});
