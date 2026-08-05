import { describe, expect, it } from "vitest";
import { calculateOutcomeRates } from "./public-judge-analytics";

describe("calculateOutcomeRates", () => {
  it("keeps mixed outcomes separate and exposes the sample", () => {
    expect(calculateOutcomeRates({ plaintiffWins: 5, defendantWins: 3, mixedOutcomes: 2 })).toEqual({
      sample: 10,
      plaintiffPercent: 50,
      defendantPercent: 30,
      mixedPercent: 20,
    });
  });

  it("does not manufacture percentages without observations", () => {
    expect(calculateOutcomeRates({ plaintiffWins: 0, defendantWins: 0, mixedOutcomes: 0 })).toEqual({
      sample: 0,
      plaintiffPercent: null,
      defendantPercent: null,
      mixedPercent: null,
    });
  });

  it("rounds rates to one decimal place", () => {
    expect(calculateOutcomeRates({ plaintiffWins: 1, defendantWins: 2, mixedOutcomes: 0 })).toEqual({
      sample: 3,
      plaintiffPercent: 33.3,
      defendantPercent: 66.7,
      mixedPercent: 0,
    });
  });
});
