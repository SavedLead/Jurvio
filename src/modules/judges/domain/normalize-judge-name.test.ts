import { describe, expect, it } from "vitest";
import { cleanJudgeDisplayName, normalizeJudgeName } from "./normalize-judge-name";

describe("judge name normalization", () => {
  it("removes judicial titles without changing the person's name", () => {
    expect(cleanJudgeDisplayName("Hon. Jane Q. Smith, U.S. District Judge")).toBe("Jane Q. Smith");
    expect(normalizeJudgeName("Hon. Jane Q. Smith, U.S. District Judge")).toBe("jane q smith");
  });

  it("collapses punctuation and accents for matching", () => {
    expect(normalizeJudgeName("José A. Cabranes")).toBe("jose a cabranes");
  });

  it("rejects non-person authorship labels and single tokens", () => {
    expect(normalizeJudgeName("Per Curiam")).toBeNull();
    expect(normalizeJudgeName("Unknown")).toBeNull();
    expect(normalizeJudgeName("Smith")).toBeNull();
  });
});
