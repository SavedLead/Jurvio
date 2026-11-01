import { describe, expect, it } from "vitest";
import {
  expandScotusTermYear,
  scotusTermFromDecisionDate,
  isSameScotusCase,
  normalizeScotusCaption,
  normalizeScotusIdentity,
} from "./publish-official-scotus-opinions";

describe("official SCOTUS publication identity", () => {
  it("normalizes punctuation and common versus forms", () => {
    expect(normalizeScotusIdentity("Smith v. Jones, Inc.")).toBe("smithvjonesinc");
    expect(isSameScotusCase("Smith v. Jones, Inc.", "Smith versus Jones Inc")).toBe(true);
  });

  it("removes official PDF revision suffixes without changing the caption", () => {
    expect(normalizeScotusCaption("Trump v. Barbara Revisions : 7/01/26")).toBe("Trump v. Barbara");
    expect(normalizeScotusCaption("Trump v. Slaughter Revision: 07/07/2026")).toBe("Trump v. Slaughter");
    expect(isSameScotusCase("Trump v. Barbara Revisions : 7/01/26", "Trump v. Barbara")).toBe(true);
  });

  it("does not approve merely similar captions", () => {
    expect(isSameScotusCase("Smith v. Jones", "Smith v. Jones Holdings")).toBe(false);
  });

  it("expands the official two-digit October Term deterministically", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    expect(expandScotusTermYear("25", undefined, now)).toBe(2025);
    expect(expandScotusTermYear("27", undefined, now)).toBe(2027);
    expect(expandScotusTermYear("65", undefined, now)).toBe(1965);
    expect(expandScotusTermYear("2025")).toBe(2025);
    expect(() => expandScotusTermYear("5")).toThrow("two- or four-digit year");
  });

  it("takes the century from the decision date (Miranda v. Arizona is 1965 Term, not 2065)", () => {
    expect(expandScotusTermYear("65", "1966-06-13")).toBe(1965);
    expect(expandScotusTermYear("25", "2026-06-30")).toBe(2025);
    expect(expandScotusTermYear("99", "2000-03-01")).toBe(1999);
    expect(expandScotusTermYear("00", "1999-12-01")).toBe(2000);
    expect(expandScotusTermYear("53", "1854-01-01")).toBe(1853);
    // A label that disagrees with the date by years falls back to the date's term.
    expect(expandScotusTermYear("10", "1966-06-13")).toBe(1965);
  });

  it("derives the October Term from a decision date", () => {
    expect(scotusTermFromDecisionDate("1966-06-13")).toBe(1965);
    expect(scotusTermFromDecisionDate("2025-10-06")).toBe(2025);
    expect(scotusTermFromDecisionDate(null)).toBeNull();
  });
});
