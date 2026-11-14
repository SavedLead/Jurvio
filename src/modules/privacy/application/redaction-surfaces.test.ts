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
    const directory = readFileSync("src/modules/directory/application/public-directory.ts", "utf8");
    const documents = readFileSync("src/modules/cases/application/list-public-case-sections.ts", "utf8");
    expect(search).toContain("redactSearchResults");
    expect(search).toContain("redactFacetLabels");
    expect(directory).toContain("redactPublicText");
    expect(documents).toContain("redactRows");
    expect(sitemap).toContain("redaction_hits");
    expect(sitemap).toContain("name_redactions");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF case_caption, title, body");
    expect(migration).not.toContain("requester@");
    const workflow = readFileSync(".github/workflows/redaction-admin-once.yml", "utf8");
    const admin = readFileSync("scripts/redaction-admin.ts", "utf8");
    expect(workflow).toContain("secrets.REDACTION_NAMES");
    expect(workflow).toContain("::add-mask::");
    expect(workflow).not.toContain("inputs.names");
    expect(workflow).not.toContain("echo \"$REDACTION_NAMES\"");
    expect(workflow).not.toContain("echo \"$NAMES\"");
    expect(admin).toContain("caseIds");
    expect(admin).toContain("documentIds");
    expect(admin).toContain("scrubRedactionLog");
    expect(admin).toContain("opinion-text");
    expect(admin).toContain("SET LOCAL enable_seqscan = off");
    expect(admin).not.toContain("d.title ILIKE");
    expect(admin).not.toContain("urls: paths");
    expect(admin).not.toContain("console.log(names");
    expect(admin).not.toContain("console.log(JSON.stringify(names");
  });
});
