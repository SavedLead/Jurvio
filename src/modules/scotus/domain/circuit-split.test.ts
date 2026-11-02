import { describe, expect, it } from "vitest";
import { circuitsNamed, readCircuitSplit } from "./circuit-split";

describe("circuit split", () => {
  it("quotes the sentence and names the circuits", () => {
    const text = "Background. We granted certiorari to resolve a split among the Courts of Appeals. Compare 1 F.4th 1 (CA5) with 2 F.4th 2 (CA9). The rest.";
    const found = readCircuitSplit(text);
    expect(found).toHaveLength(1);
    expect(found[0]?.sentence).toContain("split among the Courts of Appeals");
    expect(found[0]?.circuits).toEqual(["Fifth", "Ninth"]);
  });
  it("keeps abbreviations inside one sentence", () => {
    const found = readCircuitSplit("The Courts of Appeals are divided: the D. C. Circuit and the Fifth Circuit say yes. See 5 F. 4th 1. Next.");
    expect(found[0]?.circuits).toEqual(["Fifth", "D.C."]);
  });
  it("reads named circuit lists", () => {
    expect(circuitsNamed("the Second, Fourth, and Ninth Circuits disagree with the D. C. Circuit")).toEqual(["Second", "Fourth", "Ninth", "D.C."]);
  });
  it("ignores sentences that deny a split, and text with none", () => {
    expect(readCircuitSplit("The Government argues there is no circuit split on this question.")).toEqual([]);
    expect(readCircuitSplit("The judgment is affirmed.")).toEqual([]);
  });
});
