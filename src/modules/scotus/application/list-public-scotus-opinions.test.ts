import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/scotus/application/list-public-scotus-opinions.ts", "utf8");
const page = readFileSync("src/app/supreme-court/page.tsx", "utf8");

describe("supreme court discovery stays up when the corpus is busy", () => {
  it("reads the precomputed court total and a short statement limit", () => {
    expect(source).toContain("court_public_stats");
    expect(source).toContain("statement_timeout");
    expect(source).toContain("latestPublicationColumnSql");
    expect(source).not.toContain("count(DISTINCT published_case.id)");
    expect(source).toContain("return EMPTY_DISCOVERY");
  });

  it("renders the page when discovery throws", () => {
    expect(page).toContain("emptyDiscovery");
    expect(page).toContain("catch");
  });
});
