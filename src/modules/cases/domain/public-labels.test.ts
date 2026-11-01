import { describe, expect, it } from "vitest";
import { publicDocumentType, publicOpinionType, publicPartyRole } from "./public-labels";

describe("public labels", () => {
  it("never shows raw enum values", () => {
    expect(publicDocumentType("judicial_opinion")).toBe("Court opinion");
    expect(publicDocumentType("judicial opinion")).toBe("Court opinion");
    expect(publicDocumentType("motion_to_dismiss")).toBe("Motion to dismiss");
    expect(publicPartyRole("counter_defendant")).toBe("Counter-defendant");
    expect(publicPartyRole("plaintiff")).toBe("Plaintiff");
    expect(publicOpinionType("unknown")).toBeNull();
    expect(publicOpinionType("020lead")).toBe("Lead opinion");
    expect(publicOpinionType("040dissent")).toBe("Dissenting opinion");
    expect(publicOpinionType("combined-opinion")).toBe("Opinion");
    expect(publicOpinionType("concurrence")).toBe("Concurring opinion");
    for (const value of [publicDocumentType("x_y"), publicPartyRole("a_b"), publicOpinionType("c_d")]) expect(value).not.toMatch(/_/);
  });
});
