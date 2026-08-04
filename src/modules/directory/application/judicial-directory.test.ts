import { describe, expect, it } from "vitest";
import { canPublishJudge, mayInferPoliticalParty } from "./judicial-directory";

describe("judicial directory policy", () => {
  it("requires verified identity, authoritative appointment, and published case substance", () => {
    expect(canPublishJudge({ verification: "verified", authoritativeSourceUrl: "https://fjc.gov/judge", appointmentCount: 1, caseCount: 2 })).toBe(true);
    expect(canPublishJudge({ verification: "verified", appointmentCount: 1, caseCount: 2 })).toBe(false);
    expect(canPublishJudge({ verification: "verified", authoritativeSourceUrl: "https://fjc.gov/judge", appointmentCount: 1, caseCount: 0 })).toBe(false);
  });
  it("never infers political party", () => { expect(mayInferPoliticalParty()).toBe(false); });
});
