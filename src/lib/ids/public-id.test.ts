import { describe, expect, it } from "vitest";
import { createPublicId, isPublicId } from "./public-id";

describe("public IDs", () => {
  it("creates type-prefixed opaque IDs", () => {
    const value = createPublicId("case");
    expect(isPublicId("case", value)).toBe(true);
    expect(value).not.toMatch(/\d{6,}/);
  });

  it("rejects a different object prefix", () => {
    expect(isPublicId("document", createPublicId("case"))).toBe(false);
  });

  it("does not repeat across a practical sample", () => {
    const sample = new Set(Array.from({ length: 10_000 }, () => createPublicId("document")));
    expect(sample.size).toBe(10_000);
  });
});
