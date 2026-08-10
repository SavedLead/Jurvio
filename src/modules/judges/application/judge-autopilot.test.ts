import { describe, expect, it } from "vitest";
import { assessJudgeAutopilot, type JudgeAutopilotSnapshot } from "./judge-autopilot";

const healthy: JudgeAutopilotSnapshot = {
  roster: 3_000, active: 900, services: 4_000, assignments: 50_000,
  published: 3_000, pendingMatches: 0, reviewMatches: 10,
  latestRosterAt: "2026-08-09T12:00:00.000Z",
};

describe("Judge Autopilot assessment", () => {
  it("accepts a complete, fresh and published roster", () => {
    expect(assessJudgeAutopilot(healthy, new Date("2026-08-10T00:00:00.000Z"))).toEqual({
      rosterMissing: false, rosterStale: false, publicationBehind: false, matchingBehind: false,
    });
  });

  it("detects incomplete roster, stale source, publishing gaps and matcher backlog", () => {
    expect(assessJudgeAutopilot({
      ...healthy, roster: 1, services: 0, published: 0, pendingMatches: 50,
      latestRosterAt: "2026-08-01T00:00:00.000Z",
    }, new Date("2026-08-10T00:00:00.000Z"))).toEqual({
      rosterMissing: true, rosterStale: true, publicationBehind: true, matchingBehind: true,
    });
  });
});
