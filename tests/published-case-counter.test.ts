import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("db/migrations/0206_published_case_counter.sql", "utf8");
const refresh = readFileSync("src/modules/directory/application/public-directory-stats.ts", "utf8");
const listing = readFileSync("src/modules/cases/application/list-public-cases.ts", "utf8");
const coverage = readFileSync("src/modules/trust/application/get-coverage-snapshot.ts", "utf8");

describe("published case counter", () => {
  it("moves the count in the publication statement and seeds one court at a time", () => {
    const updateTrigger = migration.slice(migration.indexOf("CREATE TRIGGER court_published_count_update"));
    expect(updateTrigger.startsWith("CREATE TRIGGER court_published_count_update")).toBe(true);
    expect(updateTrigger).toContain("AFTER UPDATE ON legal_case");
    expect(updateTrigger.slice(0, updateTrigger.indexOf("EXECUTE FUNCTION"))).not.toContain("OF ");
    expect(migration).toContain("FOR EACH STATEMENT");
    expect(migration).toContain("published_delta = stats.published_delta + EXCLUDED.published_delta");
    expect(migration).toContain("case_count = GREATEST(0, stats.case_count - removed.n)");
    expect(migration).toContain("FOREACH court IN ARRAY courts LOOP");
    expect(migration).toContain("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    expect(migration).not.toContain("legal_case.updated_at");
    expect(migration).not.toContain("ACCESS EXCLUSIVE");
  });

  it("does not let the directory refresh recount the published total", () => {
    const courtBatch = refresh.slice(refresh.indexOf("async function upsertCourtBatch"), refresh.indexOf("async function nextJudgeIds"));
    expect(courtBatch).not.toContain("case_count = EXCLUDED.case_count");
    expect(courtBatch).not.toContain("count(*)::int AS case_count");
    expect(listing).toContain("running");
    expect(listing).toContain("court_public_stats.case_count");
    expect(coverage).toContain("court_public_stats");
    expect(coverage).toContain("publishedCasesFromFamilies");
  });
});
