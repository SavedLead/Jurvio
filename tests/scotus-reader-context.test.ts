import { describe, expect, it } from "vitest";
import { distinguishReportersNote, inlineLegalTerms } from "@/modules/legal-context/domain/legal-context";

describe("Supreme Court reader context", () => {
  it("offers plain-language help for recurring Supreme Court terms", () => {
    const terms = new Set(inlineLegalTerms.map(({ slug }) => slug));
    expect(terms).toContain("per-curiam");
    expect(terms).toContain("writ-of-certiorari");
    expect(terms).toContain("petitioner-and-respondent");
  });

  it("visually separates an official Reporter’s Note without dropping text", () => {
    const html = "<p>Court opinion. Reporter’s Note</p><p>A citation correction.</p>";
    const result = distinguishReportersNote(html);
    expect(result).toContain("<p>Court opinion. </p>");
    expect(result).toContain('class="reportersNote"');
    expect(result).toContain("not part of the Court’s opinion");
    expect(result).toContain("<p>A citation correction.</p>");
  });

  it("leaves opinions without a Reporter’s Note unchanged", () => {
    const html = "<p>Court opinion only.</p>";
    expect(distinguishReportersNote(html)).toBe(html);
  });
});
