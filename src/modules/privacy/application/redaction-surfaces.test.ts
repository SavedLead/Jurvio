import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REDACTED_ROBOTS_CONTENT, robotsFor } from "@/lib/seo/indexing";

describe("redaction surfaces", () => {
  it("noindexes a redacted page and keeps an ordinary page indexable after launch", () => {
    expect(robotsFor(true, true)).toBe(REDACTED_ROBOTS_CONTENT);
    expect(REDACTED_ROBOTS_CONTENT).toBe("noindex, noarchive, nosnippet");
  });

  it("scrubs search results and drops redacted cases from the sitemap", () => {
    const search = readFileSync("src/modules/search/application/search-public-opinions.ts", "utf8");
    const sitemap = readFileSync("src/modules/discovery/application/sitemaps.ts", "utf8");
    const migration = readFileSync("db/migrations/0212_name_redactions.sql", "utf8");
    expect(search).toContain("redactSearchResults");
    expect(sitemap).toContain("redaction_hits");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF case_caption, title, body");
    expect(migration).not.toContain("requester@");
  });
});
