import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("db/migrations/0206_published_case_counter.sql", "utf8");
const install = readFileSync("db/migrations/0207_published_case_counter_v2.sql", "utf8");
const seedJob = readFileSync("scripts/seed-published-case-counts.sh", "utf8");
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
    expect(migration).toContain("INTO delta_at_count, counted");
    expect(migration).not.toContain("SET TRANSACTION");
    expect(migration).not.toContain("CALL seed_court_published_counts");
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

  it("can be applied again without a second trigger, and the seed keeps live deltas once", () => {
    const creates = [...migration.matchAll(/CREATE TRIGGER ([a-z0-9_]+)/g)].map((match) => match[1]);
    expect(creates).toEqual([
      "court_published_count_insert",
      "court_published_count_delete",
      "court_published_count_update",
      "court_published_count_decision_insert",
      "court_published_count_decision_update",
      "court_published_count_decision_delete",
    ]);
    for (const name of creates) {
      const dropAt = migration.indexOf(`DROP TRIGGER IF EXISTS ${name} ON`);
      const createAt = migration.indexOf(`CREATE TRIGGER ${name}`);
      expect(dropAt).toBeGreaterThanOrEqual(0);
      expect(dropAt).toBeLessThan(createAt);
    }
    expect(migration).toContain("CREATE OR REPLACE FUNCTION legal_case_is_public");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION apply_court_published_deltas");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION sync_court_published_count");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION sync_published_count_on_decision");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION apply_published_count_seed");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION seed_next_published_count_court");
    expect(migration).toContain("DROP PROCEDURE IF EXISTS seed_court_published_counts");
    expect(migration).toContain("(counted - delta_at_count) + published_delta");
    expect(migration).not.toMatch(/case_count = stats\.case_count \+ counted/);
    expect(migration).not.toContain("statement_timeout', '0'");
  });

  it("installs the resumable seed without walking every court", () => {
    expect(install).toContain("CREATE OR REPLACE FUNCTION seed_next_published_count_court");
    expect(install).toContain("CREATE OR REPLACE FUNCTION legal_case_is_public");
    expect(install).toContain("CREATE OR REPLACE FUNCTION sync_court_published_count");
    expect(install).toContain("CREATE OR REPLACE FUNCTION sync_published_count_on_decision");
    expect(install).toContain("DROP TRIGGER IF EXISTS court_published_count_update ON legal_case");
    expect(install).toContain("ADD COLUMN IF NOT EXISTS published_base");
    expect(install).toContain("ADD COLUMN IF NOT EXISTS complete boolean NOT NULL DEFAULT false");
    expect(install).toContain("SET complete = true");
    expect(install.indexOf("IF NOT FOUND THEN")).toBeLessThan(install.indexOf("SELECT count(*)::int FROM legal_case"));
    expect(install).toContain("DROP PROCEDURE IF EXISTS seed_court_published_counts");
    expect(install).not.toContain("CALL ");
    expect(install).not.toContain("FOREACH");
    expect(install).not.toContain("SET TRANSACTION");
  });

  it("resumes the seed after a timeout without moving the checkpoint", () => {
    const light = readFileSync("db/migrations/0208_published_count_seed_light.sql", "utf8");
    const countFn = light.slice(
      light.indexOf("CREATE OR REPLACE FUNCTION seed_published_count_for_court"),
      light.indexOf("CREATE OR REPLACE FUNCTION seed_next_published_count_court"),
    );
    expect(countFn).toContain("c.publication = 'published'");
    expect(countFn).toContain("decision.displayable");
    expect(countFn).not.toContain("published_count_seed_cursor");
    expect(light).toContain("PERFORM seed_published_count_for_court(next_court)");
    expect(seedJob.indexOf("seed_published_count_for_court")).toBeLessThan(seedJob.indexOf("advance_cursor"));
    expect(seedJob).toContain("SET LOCAL statement_timeout = '${seconds}s'");
    expect(seedJob).toContain("SET LOCAL lock_timeout = '3s'");
    expect(seedJob).toContain("for seconds in 30 60 120");
    expect(seedJob).toContain("checkpoint not moved; court $target");
    expect(seedJob).toContain("re-dispatch retries this court");
    expect(seedJob).toContain('SEED_COURT_PAUSE_SECONDS:-3');
    expect(seedJob).toContain('sleep "$PAUSE"');
    expect(seedJob).not.toContain("seed_next_published_count_court");
    expect(seedJob).not.toContain("legal_case.updated_at");
    expect(seedJob).not.toContain("statement_timeout', '0'");
  });

  it("does not let the directory refresh recount the published total", () => {
    const courtBatch = refresh.slice(refresh.indexOf("async function upsertCourtBatch"), refresh.indexOf("async function nextJudgeIds"));
    const conflict = courtBatch.slice(courtBatch.indexOf("ON CONFLICT"));
    expect(courtBatch).not.toContain("case_count = EXCLUDED.case_count");
    expect(courtBatch).not.toContain("count(*)::int AS case_count");
    expect(conflict).not.toContain("case_count");
    expect(listing).toContain("running");
    expect(listing).toContain("court_public_stats.case_count");
    expect(coverage).toContain("court_public_stats");
    expect(coverage).toContain("publishedCasesFromFamilies");
  });
});
