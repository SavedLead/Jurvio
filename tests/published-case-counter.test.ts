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
    expect(migration).toContain("case_count = GREATEST(0, stats.case_count + EXCLUDED.published_delta)");
    expect(migration).toContain("legal_case_is_public(id, publication)");
    expect(migration).toContain("decision.displayable");
    expect(migration).toContain("FOREACH court IN ARRAY courts LOOP");
    expect(migration).not.toContain("SET TRANSACTION");
    expect(migration).toContain("INTO delta_at_count, counted");
    expect(migration).not.toContain("legal_case.updated_at");
    expect(migration).not.toContain("ACCESS EXCLUSIVE");
  });

  it("writes a counter row only for a court whose publication or court changed", () => {
    const fn = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION sync_court_published_count"),
      migration.indexOf("CREATE TRIGGER court_published_count_insert"),
    );
    const updateBranch = fn.slice(fn.indexOf("ELSE"), fn.lastIndexOf("END IF"));
    const filter = "n.publication IS DISTINCT FROM o.publication\n         OR n.court_id IS DISTINCT FROM o.court_id";
    expect(updateBranch).toContain("RETURN NULL");
    expect(updateBranch.indexOf(filter)).toBeLessThan(updateBranch.indexOf("apply_court_published_deltas"));
    expect(updateBranch).toContain("HAVING sum(change) <> 0");
    expect(updateBranch).toContain("legal_case_is_public");
    const decision = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION sync_published_count_on_decision"),
      migration.indexOf("DROP TRIGGER IF EXISTS court_published_count_insert"),
    );
    expect(decision.indexOf("GROUP BY c.court_id")).toBeLessThan(decision.indexOf("apply_court_published_deltas"));
    expect(decision).toContain("d.displayable");
    expect(decision).toContain("HAVING sum(");
    const apply = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION apply_court_published_deltas"),
      migration.indexOf("CREATE OR REPLACE FUNCTION sync_court_published_count"),
    );
    expect(apply.indexOf("d.delta <> 0")).toBeLessThan(apply.indexOf("INSERT INTO court_public_stats"));
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
