import { describe, expect, it } from "vitest";
import { splitCaseTypePrefix } from "./case-type-prefix";

describe("case type prefixes", () => {
  it("replaces a confirmed leading code and keeps the party names", () => {
    expect(splitCaseTypePrefix("(HC) Cabrera Velasquez v. Mullin et al")).toEqual({
      caption: "Cabrera Velasquez v. Mullin et al",
      types: [{ code: "HC", label: "Habeas corpus" }],
    });
    expect(splitCaseTypePrefix("(PC)Cavazos v. Reyna")).toEqual({
      caption: "Cavazos v. Reyna",
      types: [{ code: "PC", label: "Prisoner civil rights" }],
    });
    expect(splitCaseTypePrefix("(SS) Stevens v. Commissioner of Social Security")).toEqual({
      caption: "Stevens v. Commissioner of Social Security",
      types: [{ code: "SS", label: "Social security" }],
    });
    expect(splitCaseTypePrefix("(PS) Nguyen v. ITAY SNDF")).toEqual({
      caption: "Nguyen v. ITAY SNDF",
      types: [{ code: "PS", label: "Pro se" }],
    });
  });

  it("reads more than one confirmed prefix and leaves an unknown code in the title", () => {
    expect(splitCaseTypePrefix("(SS)(PS) Stevens v. Commissioner")).toEqual({
      caption: "Stevens v. Commissioner",
      types: [
        { code: "SS", label: "Social security" },
        { code: "PS", label: "Pro se" },
      ],
    });
    expect(splitCaseTypePrefix("(SC) Example v. Agency")).toEqual({
      caption: "(SC) Example v. Agency",
      types: [],
    });
    expect(splitCaseTypePrefix("(HC)(SC) Example v. Agency")).toEqual({
      caption: "(SC) Example v. Agency",
      types: [{ code: "HC", label: "Habeas corpus" }],
    });
  });

  it("does not touch a caption that does not start with a code", () => {
    expect(splitCaseTypePrefix("United States v. Olsen")).toEqual({
      caption: "United States v. Olsen",
      types: [],
    });
  });
});
