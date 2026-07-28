import { describe, expect, it } from "vitest";
import {
  expandScotusTermYear,
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
    expect(expandScotusTermYear("25")).toBe(2025);
    expect(() => expandScotusTermYear("2025")).toThrow("two-digit year");
  });
});
