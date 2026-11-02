import { describe, expect, it } from "vitest";
import { briefExcerpt, isBlankish, joinLineBreakHyphens, stripReporterRunningHeads } from "./reporter-text";

describe("stripReporterRunningHeads", () => {
  it("removes U.S. Reports running heads mid-sentence", () => {
    expect(stripReporterRunningHeads("final determination. 260 RILEY v. BONDI Syllabus An order of removal"))
      .toBe("final determination. An order of removal");
    expect(stripReporterRunningHeads("the statute. Cite as: 604 U. S. 1 (2025) The Court"))
      .toBe("the statute. The Court");
  });
  it("leaves ordinary text and citations alone", () => {
    const text = "See Riley v. Bondi, 606 U. S. 259 (2025). The Court held that 8 U. S. C. § 1252 applies.";
    expect(stripReporterRunningHeads(text)).toBe(text);
  });
});

describe("summary helpers", () => {
  it("rejoins line-break hyphens but keeps real compounds", () => {
    expect(joinLineBreakHyphens("in withholding-only pro- ceedings automati- cally")).toBe("in withholding-only proceedings automatically");
    expect(joinLineBreakHyphens("pre- and post-trial")).toBe("pre- and post-trial");
  });
  it("cuts at a sentence boundary and flags truncation", () => {
    const text = "First sentence here. Second sentence follows. Third one is long enough to pass the limit.";
    expect(briefExcerpt(text, 50)).toEqual({ text: "First sentence here. Second sentence follows.", truncated: true });
    expect(briefExcerpt("Short.", 50)).toEqual({ text: "Short.", truncated: false });
  });
  it("treats a stray number as blank", () => {
    expect(isBlankish("1.")).toBe(true);
    expect(isBlankish("The ruling limits review.")).toBe(false);
  });
});
