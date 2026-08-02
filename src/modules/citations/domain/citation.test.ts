import { describe, expect, it } from "vitest";
import { citationLookupKey, normalizeCitationInput, parseCitation } from "./citation";

describe("citation parsing", () => {
  it("normalizes reporter citations", () => {
    expect(normalizeCitationInput("  410   U.S.  113  ")).toBe("410 U.S. 113");
    expect(parseCitation("410 U.S. 113")).toMatchObject({ kind: "reporter", volume: "410", reporter: "U.S.", page: "113", lookupKey: "410us113" });
  });
  it("ignores pincites when constructing the case lookup key", () => {
    expect(parseCitation("347 U.S. 483, 495 (1954)")?.lookupKey).toBe("347us483");
  });
  it("recognizes common electronic citations", () => {
    expect(parseCitation("2026 WL 123456")?.kind).toBe("westlaw");
    expect(parseCitation("2026 U.S. LEXIS 765")?.kind).toBe("lexis");
  });
  it("creates punctuation-insensitive exact-match keys", () => {
    expect(citationLookupKey("123 F.3d 456")).toBe("123f3d456");
    expect(citationLookupKey("123 F. 3d 456")).toBe("123f3d456");
  });
  it("bounds oversized input", () => expect(normalizeCitationInput("x".repeat(500))).toHaveLength(180));
});
