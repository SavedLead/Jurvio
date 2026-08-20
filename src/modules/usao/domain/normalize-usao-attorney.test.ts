import { describe, expect, it } from "vitest";
import { attorneyProfileCompleteness, cleanUsaoAttorneyName, normalizeUsaoAttorneyName } from "./normalize-usao-attorney";

describe("USAO attorney identity normalization", () => {
  it("removes prosecutor titles without damaging the name", () => {
    expect(cleanUsaoAttorneyName("Assistant U.S. Attorney Jane Q. Public")).toBe("Jane Q. Public");
    expect(normalizeUsaoAttorneyName("Assistant U.S. Attorney Jane Q. Public")).toBe("jane q public");
  });

  it("normalizes punctuation and suffixes", () => {
    expect(normalizeUsaoAttorneyName("John O’Neil, Jr.")).toBe("john oneil");
  });

  it("rejects non-person fragments", () => {
    expect(normalizeUsaoAttorneyName("Vacant")).toBeNull();
  });

  it("scores only sourced profile fields", () => {
    expect(attorneyProfileCompleteness({ title: "AUSA", officialProfileUrl: "https://www.justice.gov/x" })).toBe(40);
  });
});
