import { describe, expect, it } from "vitest";
import { justiceSlugs, slugifyName } from "./justice-slug";

describe("justice slugs", () => {
  it("folds names to URL slugs", () => {
    expect(slugifyName("John Glover Roberts, Jr.")).toBe("john-glover-roberts-jr");
    expect(slugifyName("Sandra Day O’Connor")).toBe("sandra-day-oconnor");
  });

  it("adds the SCDB service-start year only to repeated names", () => {
    const slugs = justiceSlugs([
      { scdbJusticeId: 45, displayName: "John Marshall Harlan", serviceStart: "1877-12-10" },
      { scdbJusticeId: 91, displayName: "John Marshall Harlan", serviceStart: "1955-03-28" },
      { scdbJusticeId: 118, displayName: "Ketanji Brown Jackson", serviceStart: "2022-06-30" },
    ]);
    expect([...slugs.values()]).toEqual(["john-marshall-harlan-1877", "john-marshall-harlan-1955", "ketanji-brown-jackson"]);
    expect(new Set(slugs.values()).size).toBe(3);
  });
});

import { lineupRole, percent } from "./justice-lineup";

describe("lineup roles", () => {
  it("reads majority, concurrence, dissent and authorship from SCDB codes", () => {
    expect(lineupRole({ side: "majority", vote: 1, opinion: 2, wroteMajorityOpinion: true })).toBe("Wrote the Court’s opinion");
    expect(lineupRole({ side: "majority", vote: 1, opinion: 1, wroteMajorityOpinion: false })).toBe("Joined the majority");
    expect(lineupRole({ side: "majority", vote: 4, opinion: 2, wroteMajorityOpinion: false })).toBe("Agreed with the result only and wrote a concurrence");
    expect(lineupRole({ side: "dissent", vote: 2, opinion: 2, wroteMajorityOpinion: false })).toBe("Dissented and wrote a dissent");
    expect(lineupRole({ side: "not recorded", vote: null, opinion: null, wroteMajorityOpinion: false })).toBe("Vote not recorded by SCDB");
    expect(percent(0.6923)).toBe("69%");
    expect(percent(null)).toBe("—");
  });
});

import { shortName } from "./justice-lineup";

describe("short names", () => {
  it("drops suffixes", () => {
    expect(shortName("John Glover Roberts, Jr.")).toBe("Roberts");
    expect(shortName("Samuel A. Alito, Jr.")).toBe("Alito");
    expect(shortName("Ketanji Brown Jackson")).toBe("Jackson");
  });
});
