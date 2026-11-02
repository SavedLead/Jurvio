import { describe, expect, it } from "vitest";
import { stripReporterRunningHeads } from "./reporter-text";

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
