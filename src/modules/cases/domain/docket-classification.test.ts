import { describe, expect, it } from "vitest";
import {
  docketEntryKind, isOrderKind, jurisdictionBasisFromText, juryDemandFromText, namedParties, statedOutcome,
} from "./docket-classification";

describe("docket entry classification", () => {
  it("labels the line from the court's bracket or words", () => {
    expect(docketEntryKind("[Complaint] Anderson v. Google")).toBe("complaint");
    expect(docketEntryKind("[Order on Motion to Dismiss]")).toBe("order");
    expect(docketEntryKind("[Summons Issued]")).toBe("summons");
    expect(docketEntryKind("NOTICE of appearance")).toBe("notice");
    expect(docketEntryKind("[Stipulation of dismissal]")).toBe("stipulation");
    expect(docketEntryKind("[Judgment] entered")).toBe("judgment");
    expect(docketEntryKind("MOTION to dismiss")).toBe("motion");
    expect(isOrderKind("order")).toBe(true);
    expect(isOrderKind("motion")).toBe(false);
  });

  it("repeats an outcome only when the entry states one", () => {
    expect(statedOutcome("ORDER granting the motion to dismiss")).toBe("Granted");
    expect(statedOutcome("[Order on Motion to Dismiss]")).toBeNull();
    expect(statedOutcome("MOTION to dismiss filed")).toBeNull();
    expect(statedOutcome("The motion is denied.")).toBe("Denied");
    expect(statedOutcome("Judgment entered for the plaintiff")).toBe("Judgment entered");
  });

  it("names a party only when the entry contains that name", () => {
    expect(namedParties("MOTION by Deutsch to dismiss", ["UCS Trading Inc", "Deutsch"])).toEqual(["Deutsch"]);
    expect(namedParties("[Summons Issued]", ["UCS Trading Inc", "Deutsch"])).toEqual([]);
  });

  it("reads jurisdiction and jury demand only from explicit stored text", () => {
    expect(jurisdictionBasisFromText("28 U.S.C. § 1332 Diversity", [])).toBe("Diversity");
    expect(jurisdictionBasisFromText(null, ["Jurisdiction: Federal question"])).toBe("Federal question");
    expect(jurisdictionBasisFromText(null, ["[Complaint] filed"])).toBeNull();
    expect(juryDemandFromText(["Jury Demand: Plaintiff"])).toBe("Plaintiff");
    expect(juryDemandFromText(["[Complaint] filed"])).toBeNull();
  });
});