import { describe, expect, it } from "vitest";
import { SITEMAP_CASE_PAGE_SIZE, SITEMAP_PAGE_SIZE, sitemapPageBounds } from "./sitemaps";

describe("sitemap page bounds", () => {
  it("keeps an expanded case page under the sitemap URL limit", () => {
    expect(SITEMAP_CASE_PAGE_SIZE * 5).toBeLessThanOrEqual(50_000);
    expect(SITEMAP_PAGE_SIZE).toBeLessThanOrEqual(50_000);
  });

  it("returns an inclusive start and an exclusive next start", () => {
    expect(sitemapPageBounds(["a", "m", "z"], 1)).toEqual({ start: "a", end: "m" });
    expect(sitemapPageBounds(["a", "m", "z"], 2)).toEqual({ start: "m", end: "z" });
    expect(sitemapPageBounds(["a", "m", "z"], 3)).toEqual({ start: "z", end: null });
    expect(sitemapPageBounds(["a"], 2)).toBeNull();
    expect(sitemapPageBounds(["a"], 0)).toBeNull();
  });
});
