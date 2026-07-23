import { describe, expect, it } from "vitest";
import { canIndexDirectoryProfile } from "./public-directory";

describe("public directory indexing gate", () => {
  it("requires both an explicit indexing decision and verified identity", () => {
    expect(canIndexDirectoryProfile({ indexable: true, verification: "verified" })).toBe(true);
    expect(canIndexDirectoryProfile({ indexable: false, verification: "verified" })).toBe(false);
    expect(canIndexDirectoryProfile({ indexable: true, verification: "not_verified" })).toBe(false);
  });
});
