import { describe, expect, it } from "vitest";
import { countOf, microusdToUsd, qualityHealth } from "./governance-health";

describe("governance dashboard helpers", () => {
  it("separates verified records from records requiring attention", () => {
    expect(qualityHealth([
      { label: "verified", value: 12 },
      { label: "not_verified", value: 4 },
      { label: "needs_review", value: 2 },
      { label: "conflict", value: 1 },
    ])).toEqual({ reviewed: 12, attention: 3, total: 19 });
  });

  it("returns zero for an absent metric", () => {
    expect(countOf([], "pending")).toBe(0);
  });

  it("formats micro-dollar costs without overstating precision", () => {
    expect(microusdToUsd(1_250_000)).toBe("$1.25");
    expect(microusdToUsd(12_345)).toBe("$0.0123");
  });
});
