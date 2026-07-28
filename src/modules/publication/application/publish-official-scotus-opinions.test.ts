import { describe, expect, it } from "vitest";
import { isSameScotusCase, normalizeScotusIdentity } from "./publish-official-scotus-opinions";

describe("official SCOTUS publication identity", () => {
  it("normalizes punctuation and common versus forms", () => {
    expect(normalizeScotusIdentity("Smith v. Jones, Inc.")).toBe("smithvjonesinc");
    expect(isSameScotusCase("Smith v. Jones, Inc.", "Smith versus Jones Inc")).toBe(true);
  });

  it("does not approve merely similar captions", () => {
    expect(isSameScotusCase("Smith v. Jones", "Smith v. Jones Holdings")).toBe(false);
  });
});
