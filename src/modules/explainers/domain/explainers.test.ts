import { describe, expect, it } from "vitest";
import { explainerGlossary, getExplainer, legalExplainers } from "./explainers";

describe("legal explainers", () => {
  it("has unique stable slugs and valid related references", () => {
    const slugs = legalExplainers.map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const item of legalExplainers) {
      expect(item.sources.length).toBeGreaterThan(0);
      expect(item.related.every((slug) => slugs.includes(slug))).toBe(true);
    }
  });

  it("exposes a compact reusable glossary", () => {
    expect(explainerGlossary()).toHaveLength(18);
    expect(getExplainer("summary-judgment")?.term).toBe("Summary judgment");
    expect(getExplainer("emergency-docket")?.aliases).toContain("shadow docket");
  });

  it("keeps every plain-language entry substantive and source-backed", () => {
    for (const item of legalExplainers) {
      expect(item.oneLine.length).toBeGreaterThan(35);
      expect(item.plainEnglish.length).toBeGreaterThan(80);
      expect(item.commonMistake.length).toBeGreaterThan(50);
      expect(item.whatHappensNext).toHaveLength(3);
      expect(item.sources.every((source) => source.url.startsWith("https://"))).toBe(true);
    }
  });
});
