import { describe, expect, it } from "vitest";
import {
  appointingParty, appointmentPhrase, classifyAppellateDisposition, medianDays, parsePanelSurnames, percentOf, plainDuration,
} from "./lower-court-analytics";

describe("appointing party", () => {
  it("normalizes FJC party values", () => {
    expect(appointingParty("Republican")).toBe("republican");
    expect(appointingParty("Democratic")).toBe("democratic");
    expect(appointingParty("None (reassignment)")).toBe("none");
    expect(appointingParty("Whig")).toBe("other");
    expect(appointingParty("")).toBe("unknown");
  });
  it("never uses ideology words", () => {
    for (const party of ["Republican", "Democratic", "Whig", "None (assignment)", null]) {
      const phrase = appointmentPhrase("Barack Obama", party);
      expect(phrase).not.toMatch(/liberal|conservative/i);
    }
    expect(appointmentPhrase("George W. Bush", "Republican")).toBe("Appointed by President George W. Bush, a Republican president");
  });
});

describe("panel names", () => {
  it("reads common reporter formats", () => {
    expect(parsePanelSurnames("Before SMITH, JONES, and BROWN, Circuit Judges.")).toEqual(["smith", "jones", "brown"]);
    expect(parsePanelSurnames("Wilkinson, Niemeyer, Thacker")).toEqual(["wilkinson", "niemeyer", "thacker"]);
    expect(parsePanelSurnames("Before: KATZMANN, Chief Judge, LIVINGSTON and Jed S. Rakoff, District Judge, sitting by designation.")).toEqual(["katzmann", "livingston", "rakoff"]);
    expect(parsePanelSurnames("")).toEqual([]);
  });
});

describe("appellate disposition", () => {
  it("classifies by fixed rules", () => {
    expect(classifyAppellateDisposition("AFFIRMED.")).toBe("affirmed");
    expect(classifyAppellateDisposition("Reversed and remanded")).toBe("reversed");
    expect(classifyAppellateDisposition("VACATED and REMANDED")).toBe("vacated");
    expect(classifyAppellateDisposition("Affirmed in part, reversed in part")).toBe("mixed");
    expect(classifyAppellateDisposition("Appeal dismissed")).toBe("dismissed");
    expect(classifyAppellateDisposition(null)).toBe("other");
  });
});

describe("numbers", () => {
  it("median, percent, duration", () => {
    expect(medianDays([10, 30, 20])).toBe(20);
    expect(medianDays([10, 20])).toBe(15);
    expect(medianDays([])).toBeNull();
    expect(percentOf(1, 3)).toBe(33.3);
    expect(percentOf(1, 0)).toBeNull();
    expect(plainDuration(45)).toBe("45 days");
    expect(plainDuration(335)).toBe("about 11 months");
    expect(plainDuration(1000)).toBe("about 2.7 years");
  });
});
