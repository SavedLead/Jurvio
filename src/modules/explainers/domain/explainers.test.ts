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
    expect(explainerGlossary()).toHaveLength(11);
    expect(getExplainer("summary-judgment")?.term).toBe("Summary judgment");
  });
});
