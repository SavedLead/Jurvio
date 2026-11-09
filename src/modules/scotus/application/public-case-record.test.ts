import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SCOTUS public case record", () => {
  const source = readFileSync("src/modules/scotus/application/public-case-record.ts", "utf8");

  it("reads stored counsel, filings, and orders and does not write alerts", () => {
    expect(source).toContain("FROM scotus_counsel");
    expect(source).toContain("FROM scotus_filing_link");
    expect(source).toContain("FROM scotus_order_list_item");
    expect(source).toContain("argued_on");
    expect(source).toContain(String.raw`\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\M`);
    expect(source).not.toMatch(/INSERT\s+INTO/i);
    expect(source).not.toMatch(/UPDATE\s+/i);
    expect(source).not.toMatch(/docket_entry|entity_alert|case_follow/);
  });
});
