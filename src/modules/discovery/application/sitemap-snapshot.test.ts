import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  emptySitemapUrlset,
  fallbackSitemapIndex,
  sitemapBodyOrFallback,
  sitemapIndexXml,
} from "./sitemap-snapshot";

describe("stored sitemaps", () => {
  it("serves a stored document and falls back when it is missing", () => {
    expect(sitemapBodyOrFallback("<?xml version=\"1.0\"?><sitemapindex></sitemapindex>", "fallback")).toContain("sitemapindex");
    expect(sitemapBodyOrFallback(null, "fallback")).toBe("fallback");
    expect(sitemapBodyOrFallback("", "fallback")).toBe("fallback");
  });

  it("falls back to a valid index that only names the static file", () => {
    const xml = fallbackSitemapIndex("https://jurvio.com");
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml).toContain("https://jurvio.com/sitemaps/static.xml");
    expect(xml).not.toContain("/sitemaps/cases/");
    expect(emptySitemapUrlset()).toContain("<urlset");
  });

  it("builds an index from stored page counts", () => {
    const xml = sitemapIndexXml("https://jurvio.com", [{ kind: "cases", count: 2 }, { kind: "parties", count: 1 }]);
    expect(xml).toContain("https://jurvio.com/sitemaps/cases/1");
    expect(xml).toContain("https://jurvio.com/sitemaps/cases/2");
    expect(xml).toContain("https://jurvio.com/sitemaps/directory/parties/1");
  });

  it("does not number the corpus while reading a stored page", async () => {
    const source = await readFile("src/modules/discovery/application/sitemap-snapshot.ts", "utf8");
    const reader = source.slice(source.indexOf("export async function readSitemapDocument"), source.indexOf("async function upsertPage"));
    expect(reader.toLowerCase()).not.toContain("row_number");
    expect(reader.toLowerCase()).not.toContain("count(*)");
    expect(source.toLowerCase()).not.toContain("row_number");
    expect(source).toContain("public_id >");
  });
});
