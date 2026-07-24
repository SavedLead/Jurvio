import { describe, expect, it } from "vitest";
import { glossaryStages, glossaryTerms, popularGlossaryTerms, procedureTracks } from "./glossary";

describe("legal glossary", () => {
  it("provides broad, structured coverage", () => {
    expect(glossaryTerms.length).toBeGreaterThanOrEqual(100);
    expect(new Set(glossaryTerms.map((item) => `${item.track}:${item.term}`)).size).toBe(glossaryTerms.length);
    expect(glossaryTerms.every((item) => glossaryStages.includes(item.stage))).toBe(true);
  });

  it("keeps popularity ranking deterministic", () => {
    const popular = popularGlossaryTerms();
    expect(popular).toHaveLength(24);
    expect(popular.every((item, index) => index === 0 || popular[index - 1]!.popularity >= item.popularity)).toBe(true);
  });

  it("separates federal, state, and Supreme Court procedure", () => {
    expect(procedureTracks.map((track) => track.id)).toEqual(["federal", "state", "scotus"]);
    expect(procedureTracks.every((track) => track.steps.length >= 6)).toBe(true);
  });
});
