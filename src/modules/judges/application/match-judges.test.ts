import { describe, expect, it } from "vitest";
import { decideJudgeMatch, rankEligibleJudges } from "./match-judges";

describe("jurisdiction and timeframe judge matching", () => {
  it("accepts one exact eligible judge", () => {
    const ranked = rankEligibleJudges("jane a smith", [
      { judgeId: "eligible", normalizedValue: "jane a smith" },
      { judgeId: "other", normalizedValue: "robert jones" },
    ]);
    expect(decideJudgeMatch(ranked)).toEqual({ status: "accepted", acceptedJudgeId: "eligible" });
  });

  it("resolves initials inside the eligible court and date roster", () => {
    const ranked = rankEligibleJudges("j a smith", [
      { judgeId: "eligible", normalizedValue: "jane alice smith" },
      { judgeId: "other", normalizedValue: "robert smith" },
    ]);
    expect(ranked[0]?.score).toBe(0.95);
    expect(decideJudgeMatch(ranked)).toEqual({ status: "accepted", acceptedJudgeId: "eligible" });
  });

  it("never guesses when two eligible judges share compatible initials", () => {
    const ranked = rankEligibleJudges("j smith", [
      { judgeId: "one", normalizedValue: "jane smith" },
      { judgeId: "two", normalizedValue: "john smith" },
    ]);
    expect(decideJudgeMatch(ranked)).toEqual({ status: "needs_review", acceptedJudgeId: null });
  });

  it("does not accept a surname-only signal", () => {
    const ranked = rankEligibleJudges("jane smith", [
      { judgeId: "one", normalizedValue: "robert smith" },
    ]);
    expect(decideJudgeMatch(ranked)).toEqual({ status: "needs_review", acceptedJudgeId: null });
  });
});
