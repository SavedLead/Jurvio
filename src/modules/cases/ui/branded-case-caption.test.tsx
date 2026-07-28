import { describe, expect, it } from "vitest";
import { cleanCaseCaption, splitAdversarialCaseCaption } from "./branded-case-caption";

describe("branded case captions", () => {
  it("splits adversarial captions around v.", () => {
    expect(splitAdversarialCaseCaption("Pitts v. Mississippi")).toEqual(["Pitts", "Mississippi"]);
  });

  it("does not force the treatment onto non-adversarial matters", () => {
    expect(splitAdversarialCaseCaption("In re Grand Jury")).toBeNull();
    expect(splitAdversarialCaseCaption("Ex parte Young")).toBeNull();
  });

  it("removes official revision suffixes without changing the case name", () => {
    expect(cleanCaseCaption("Trump v. Slaughter Revisions : 7/07/26")).toBe("Trump v. Slaughter");
    expect(cleanCaseCaption("Landor v. Louisiana Revised: 6/28/2026")).toBe("Landor v. Louisiana");
  });

  it("normalizes repeated whitespace and preserves ordinary captions", () => {
    expect(cleanCaseCaption("  In re   Grand Jury  ")).toBe("In re Grand Jury");
  });
});
