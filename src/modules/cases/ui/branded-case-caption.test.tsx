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

  it("removes a malformed leading one from government captions", () => {
    expect(cleanCaseCaption("1USA v. ESTRADA-CARRILLO et al")).toBe("USA v. ESTRADA-CARRILLO et al");
    expect(cleanCaseCaption("1United States v. IBOBO")).toBe("United States v. IBOBO");
  });

  it("preserves legitimate leading numbers", () => {
    expect(cleanCaseCaption("1-800 Contacts, Inc. v. Lens.com, Inc.")).toBe("1-800 Contacts, Inc. v. Lens.com, Inc.");
    expect(cleanCaseCaption("1USA Holdings v. Example Corp.")).toBe("1USA Holdings v. Example Corp.");
  });

  it("normalizes repeated whitespace and preserves ordinary captions", () => {
    expect(cleanCaseCaption("  In re   Grand Jury  ")).toBe("In re Grand Jury");
  });
});
