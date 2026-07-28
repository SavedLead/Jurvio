import { describe, expect, it } from "vitest";
import { splitAdversarialCaseCaption } from "./branded-case-caption";

describe("branded case captions", () => {
  it("splits adversarial captions around v.", () => {
    expect(splitAdversarialCaseCaption("Pitts v. Mississippi")).toEqual(["Pitts", "Mississippi"]);
  });

  it("does not force the treatment onto non-adversarial matters", () => {
    expect(splitAdversarialCaseCaption("In re Grand Jury")).toBeNull();
    expect(splitAdversarialCaseCaption("Ex parte Young")).toBeNull();
  });
});
