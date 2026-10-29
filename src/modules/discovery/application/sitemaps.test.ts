import { describe, expect, it } from "vitest";
import { SITEMAP_CASE_PAGE_SIZE, SITEMAP_PAGE_SIZE, sitemapBoundarySql, sitemapPageBounds } from "./sitemaps";

describe("sitemap keyset pages", () => {
  it("builds page boundaries with row_number instead of OFFSET", () => {
    const sql = sitemapBoundarySql("SELECT legal_case.public_id FROM legal_case", SITEMAP_PAGE_SIZE);
    expect(sql).toContain("row_number() OVER (ORDER BY candidate.public_id)");
    expect(sql).toContain(`ordinal % ${SITEMAP_PAGE_SIZE} = 0`);
    expect(sql.toLowerCase()).not.toContain("offset");
  });

  it("keeps an expanded case page under the sitemap URL limit", () => {
    expect(SITEMAP_CASE_PAGE_SIZE * 5).toBeLessThanOrEqual(50_000);
  });

  it("returns an inclusive start and an exclusive next start", () => {
    expect(sitemapPageBounds(["a", "m", "z"], 1)).toEqual({ start: "a", end: "m" });
    expect(sitemapPageBounds(["a", "m", "z"], 2)).toEqual({ start: "m", end: "z" });
    expect(sitemapPageBounds(["a", "m", "z"], 3)).toEqual({ start: "z", end: null });
    expect(sitemapPageBounds(["a"], 2)).toBeNull();
    expect(sitemapPageBounds(["a"], 0)).toBeNull();
  });
});
