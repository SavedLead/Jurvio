import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("scripts/diag/alert-subscribers.sql", "utf8");

describe("alert subscriber report", () => {
  it("selects counts and names, not addresses", () => {
    const statements = sql.split(";").map((part) => part.replace(/--.*$/gm, "").trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement.slice(0, 6).toUpperCase()).toBe("SELECT");
      const projection = statement.split(/\bfrom\b/i)[0] ?? "";
      expect(projection.toLowerCase()).not.toContain("email");
    }
  });
});
