import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("docket display backfill", () => {
  const source = readFileSync("src/modules/publication/application/backfill-docket-display.ts", "utf8");
  const script = readFileSync("scripts/run-docket-display-backfill.ts", "utf8");

  it("writes a display decision and does not touch alert timestamps", () => {
    expect(source).toContain("INSERT INTO publication_decision");
    expect(source).toContain("docket_display_backfill");
    expect(source).not.toMatch(/UPDATE\s+docket_entry/i);
    expect(source).not.toMatch(/UPDATE\s+legal_case/i);
    expect(source).not.toMatch(/UPDATE\s+case_follow/i);
    expect(source).not.toMatch(/last_alerted/);
    expect(source).not.toMatch(/entity_alert/);
    expect(source).toContain("alertsQueued: 0");
    expect(script).not.toMatch(/UPDATE\s+docket_entry/i);
  });

  it("leaves sealed text hidden", () => {
    expect(source).toContain(String.raw`\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\M`);
  });
});
