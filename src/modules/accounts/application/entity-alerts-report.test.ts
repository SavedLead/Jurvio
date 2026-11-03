import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entityAlertsDryRunSql } from "./entity-alerts-report";

describe("entity alerts dry-run report", () => {
  it("matches the committed diag file and stays read-only", () => {
    const sql = entityAlertsDryRunSql();
    expect(readFileSync("scripts/diag/entity-alerts-dry-run.sql", "utf8")).toBe(sql);
    // The diagnose-sql-once checker refuses these words (comments stripped).
    const body = sql.replace(/--.*$/gm, "");
    expect(body).not.toMatch(/transaction_read_only|transaction_isolation|read\s+write|\b(insert|update|delete|truncate|alter|drop|create|grant|revoke|vacuum|copy|call|do)\b\s/i);
  });
});
