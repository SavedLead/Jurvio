import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyCell, HISTORY_APPLICATION_COLUMNS, HISTORY_EVENT_COLUMNS, historyLoadSql, historyRowsFromPage, textArrayLiteral } from "./emergency-history";

const fixture = (name: string) => readFileSync(join(process.cwd(), "src/modules/scotus/fixtures/emergency", name), "utf8");

describe("COPY encoding", () => {
  it("escapes text format specials and nulls", () => {
    expect(copyCell(null)).toBe("\\N");
    expect(copyCell(true)).toBe("t");
    expect(copyCell("a\tb\nc\\d")).toBe("a\\tb\\nc\\\\d");
    expect(textArrayLiteral(["Kagan", 'O"Brien'])).toBe('{"Kagan","O\\"Brien"}');
  });
});

describe("historyRowsFromPage", () => {
  it("builds one application row and its docket lines from a public docket page", () => {
    const rows = historyRowsFromPage(fixture("24a904.html"), "24A904", "2026-11-04");
    expect(rows).not.toBeNull();
    const cells = rows!.application.split("\t");
    expect(cells).toHaveLength(HISTORY_APPLICATION_COLUMNS.length);
    expect(cells[0]).toBe("24A904");
    expect(cells[HISTORY_APPLICATION_COLUMNS.indexOf("source_url")]).toBe("https://www.supremecourt.gov/docket/docketfiles/html/public/24a904.html");
    expect(rows!.events.length).toBeGreaterThan(0);
    for (const line of rows!.events) expect(line.split("\t")).toHaveLength(HISTORY_EVENT_COLUMNS.length);
  });

  it("skips a page whose caption trips the sealed filter", () => {
    const html = fixture("24a904.html").replace(/<title>[\s\S]*?<\/title>/i, "<title>Sealed</title>")
      .replace(/(Title:[\s\S]{0,200}?>)\s*([^<]+)/i, "$1 In re Grand Jury Subpoena, Applicant");
    const rows = historyRowsFromPage(html, "24A904", "2026-11-04");
    if (rows) expect(rows.application).not.toMatch(/Grand Jury/i);
  });
});

describe("historyLoadSql", () => {
  it("never overwrites live rows and counts before commit", () => {
    const sql = historyLoadSql("", "");
    expect(sql).toContain("WHERE scotus_application.source_lane = 'history'");
    expect(sql.indexOf("SELECT 'loaded'")).toBeLessThan(sql.indexOf("COMMIT;"));
    expect(sql).toContain("ON CONFLICT (url) DO NOTHING");
    expect(sql).not.toMatch(/\/rss\//);
  });
});
