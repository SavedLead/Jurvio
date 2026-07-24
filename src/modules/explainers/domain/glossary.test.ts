import { describe, expect, it } from "vitest";
import { glossaryDomains, glossaryJurisdictions, glossaryStages, glossaryTerms, popularGlossaryTerms, procedureTracks } from "./glossary";

describe("legal glossary", () => {
  it("provides broad, structured coverage", () => {
    expect(glossaryTerms.length).toBeGreaterThanOrEqual(180);
    expect(new Set(glossaryTerms.map((item) => `${item.jurisdiction}:${item.term}`)).size).toBe(glossaryTerms.length);
    expect(glossaryTerms.every((item) => glossaryStages.includes(item.stage))).toBe(true);
    expect(glossaryTerms.every((item) => item.domains.length > 0)).toBe(true);
    expect(glossaryTerms.every((item) => glossaryJurisdictions.some(({ id }) => id === item.jurisdiction))).toBe(true);
    expect(glossaryTerms.every((item) => item.domains.every((domain) => glossaryDomains.some(({ id }) => id === domain)))).toBe(true);
  });

  it("keeps popularity ranking deterministic", () => {
    const popular = popularGlossaryTerms();
    expect(popular).toHaveLength(24);
    expect(popular.every((item, index) => index === 0 || popular[index - 1]!.popularity >= item.popularity)).toBe(true);
  });

  it("covers courts and additional legal forums", () => {
    expect(procedureTracks.map((track) => track.id)).toEqual([
      "federal", "state", "scotus", "criminal", "administrative", "bankruptcy", "family", "arbitration",
    ]);
    expect(procedureTracks.every((track) => track.steps.length >= 6)).toBe(true);
  });
});
