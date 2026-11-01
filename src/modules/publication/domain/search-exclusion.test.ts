import { describe, expect, it } from "vitest";
import { captionIsSearchExcluded, searchExcludedCaseSql } from "./search-exclusion";

describe("search exclusion rule", () => {
  it("matches sealed captions only as whole words", () => {
    expect(captionIsSearchExcluded("In re: Sealed Case, et al")).toBe(true);
    expect(captionIsSearchExcluded("United States v. Under Seal")).toBe(true);
    expect(captionIsSearchExcluded("Sealed v. Sealed")).toBe(true);
    expect(captionIsSearchExcluded("Smith v. Sealedair Corp.")).toBe(false);
    expect(captionIsSearchExcluded("Kumar v. Moss")).toBe(false);
  });

  it("builds SQL for a safe alias and checks restricted events", () => {
    const sql = searchExcludedCaseSql("legal_case");
    expect(sql).toContain("legal_case.caption ~* '\\m(sealed|under seal)\\M'");
    expect(sql).toContain("search_exclusion_event.restricted");
    expect(() => searchExcludedCaseSql("c; DROP")).toThrow();
  });
});
