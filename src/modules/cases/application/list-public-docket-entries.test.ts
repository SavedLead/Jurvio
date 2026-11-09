import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { docketPageWindow } from "./list-public-case-sections";

describe("public docket listing", () => {
  const source = readFileSync("src/modules/cases/application/list-public-case-sections.ts", "utf8");

  it("shows stored lines on a published case and hides only sealed material", () => {
    expect(source).toContain("legal_case.publication = 'published'");
    expect(source).toContain(String.raw`\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\M`);
    expect(source).toContain("withheld.reason_code");
    expect(source).not.toMatch(/displayable", "docket_entry"/);
    expect(source).not.toMatch(/INSERT\s+INTO/i);
    expect(source).not.toMatch(/UPDATE\s+docket_entry/i);
    expect(source).not.toMatch(/entity_alert|case_follow|last_alerted/);
  });

  it("pages newest-first with a bounded offset", () => {
    expect(source).toContain("ORDER BY entry.filed_on DESC NULLS LAST");
    expect(source).toContain("docket_entry_case_filed_idx");
    expect(docketPageWindow(1)).toEqual({ page: 1, limit: 50, offset: 0 });
    expect(docketPageWindow(3)).toEqual({ page: 3, limit: 50, offset: 100 });
    expect(docketPageWindow(Number.NaN).page).toBe(1);
    expect(docketPageWindow(1_000_000).offset).toBeLessThanOrEqual(200_000);
  });
});
