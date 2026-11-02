import { describe, expect, it } from "vitest";
import { createPublicId, isPublicId, publicIdBody } from "./public-id";

function sequence(...values: string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error("sequence exhausted");
    return value;
  };
}

describe("public IDs", () => {
  it("creates type-prefixed opaque IDs", () => {
    const value = createPublicId("case");
    expect(isPublicId("case", value)).toBe(true);
    expect(value).not.toMatch(/\d{6,}/);
  });

  it("redraws a body with six or more digits in a row", () => {
    expect(publicIdBody(sequence("a123456bcdzz", "x12345y678qq"))).toBe("x12345y678");
    expect(publicIdBody(sequence("1234567890ab", "9876543210cd", "ab12cd34efgh"))).toBe("ab12cd34ef");
  });

  it("keeps a body whose digit runs are shorter than six", () => {
    expect(publicIdBody(sequence("12345a1234xyz"))).toBe("12345a1234");
  });

  it("gives up rather than returning a long digit run", () => {
    expect(() => publicIdBody(() => "0000000000")).toThrow(/long digit run/);
  });

  it("never emits a long digit run across a large sample", () => {
    for (let index = 0; index < 20_000; index += 1) {
      expect(createPublicId("case")).not.toMatch(/\d{6,}/);
    }
  });

  it("rejects a different object prefix", () => {
    expect(isPublicId("document", createPublicId("case"))).toBe(false);
  });

  it("does not repeat across a practical sample", () => {
    const sample = new Set(Array.from({ length: 10_000 }, () => createPublicId("document")));
    expect(sample.size).toBe(10_000);
  });
});
