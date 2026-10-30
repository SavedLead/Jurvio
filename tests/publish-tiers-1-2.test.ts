import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

// Tier 1 + Tier 2 release (David Rosenberg, 2026-10-30: "Publish only Tiers 1 and 2 for now").

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const workflowText = read(".github/workflows/publish-tiers-1-2-once.yml");
const candidates = read("scripts/ops/tiers-1-2-candidates.sql");
const publish = read("scripts/ops/publish-tiers-1-2.sql");
const unpublish = read("scripts/ops/unpublish-tiers-1-2.sql");

type Step = { name?: string; run?: string; env?: Record<string, string>; uses?: string };
const workflow = load(workflowText) as {
  on: Record<string, { inputs: Record<string, { required?: boolean; default?: string; options?: string[] }> }>;
  jobs: Record<string, { "runs-on": string[]; steps: Step[] }>;
};

describe("publish-tiers-1-2-once workflow", () => {
  it("is dispatch-only, self-hosted, and gates every mode on its own keyword first", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    const inputs = workflow.on.workflow_dispatch!.inputs;
    expect(inputs.confirm?.required).toBe(true);
    expect(inputs.mode?.options).toEqual(["dry_run", "publish", "unpublish"]);
    expect(inputs.mode?.default).toBe("dry_run");
    expect(inputs.expected_t1?.default).toBe("18465");
    expect(inputs.expected_t2?.default).toBe("52110");
    const job = workflow.jobs.release!;
    expect(job["runs-on"]).toContain("self-hosted");
    expect(job["runs-on"]).toContain("builder");
    const gate = job.steps[0]!;
    expect(gate.env?.CONFIRM).toContain("inputs.confirm");
    expect(gate.run).toContain("dry_run) want=DRY_RUN_TIERS_1_2");
    expect(gate.run).toContain("publish) want=PUBLISH_TIERS_1_2");
    expect(gate.run).toContain("unpublish) want=UNPUBLISH_TIERS_1_2");
    expect(gate.run).toMatch(/"\$CONFIRM" != "\$want"[\s\S]*exit 1/);
  });

  it("fixes the tolerance at 2% and never touches env flags or the federal metadata switch", () => {
    expect(workflowText).toContain("-v tolerance=0.02");
    expect(workflowText).not.toMatch(/JURVIO_PUBLISH_FEDERAL_METADATA|\.env\.production|enable-federal-metadata/);
    expect(workflowText).not.toMatch(/docker compose|restart/);
  });
});

describe("tier 1 + 2 SQL", () => {
  it("selects only drafts in tier 1 or tier 2 and publishes only gate=ok rows", () => {
    expect(candidates).toContain("WHERE lc.publication = 'draft'");
    expect(candidates).toContain("lc.filed_on >= current_date - 90");
    expect(publish).toContain("WHERE gate = 'ok' AND tier IN (1, 2)");
    expect(publish).not.toMatch(/tier\s*(=|IN)\s*\(?\s*[34]/);
  });

  it("excludes sealed, restricted and soft-held cases", () => {
    for (const gate of [
      "sealed_or_sensitive",
      "case_conflict_or_review",
      "court_unverified",
      "other_federal_hold",
      "prior_non_displayable_decision",
      "publication_review_block",
      "scotus_duplicate_of_published",
    ]) expect(candidates).toContain(`'${gate}'`);
    expect(candidates).toContain("restricted_or_sensitive");
  });

  it("aborts before writing when a tier is off by more than the tolerance, and ledgers before publishing", () => {
    const abort = publish.indexOf("TOLERANCE_ABORT");
    const stage = publish.indexOf("INSERT INTO publication_tier_release");
    const flip = publish.indexOf("SET publication = 'published'");
    expect(abort).toBeGreaterThan(0);
    expect(stage).toBeGreaterThan(abort);
    expect(flip).toBeGreaterThan(stage);
    expect(publish).toContain("\\if :do_apply");
    expect(publish).toContain("COMMIT;");
  });

  it("unpublish restores the prior state and deletes only this release's decisions", () => {
    expect(unpublish).toContain("SET publication = batch.prior_publication");
    expect(unpublish).toContain("pd.rule_version = 'publication-tiers-v1'");
  });
});

const databaseUrl = process.env.DATABASE_URL;
const hasPsql = spawnSync("psql", ["--version"]).status === 0;

describe.skipIf(!databaseUrl || !hasPsql)("tier 1 + 2 release against Postgres", () => {
  it("publishes exactly the gated tier 1/2 fixture cases, aborts on tolerance, and reverts", { timeout: 240_000 }, async () => {
    const admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const name = `tiers_it_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const dbUrl = url.toString();
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
    const psql = (file: string, vars: Record<string, string>) =>
      spawnSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-q", ...Object.entries(vars).flatMap(([k, v]) => ["-v", `${k}=${v}`]), "-f", file], {
        encoding: "utf8",
      });
    try {
      execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" });
      expect(psql("tests/fixtures/publish-tiers-1-2-seed.sql", {}).status).toBe(0);
      // The main script \i's the candidates file from /tmp, as on the database box.
      execFileSync("cp", ["scripts/ops/tiers-1-2-candidates.sql", "/tmp/tiers-1-2-candidates.sql"]);
      const base = { tolerance: "0.02", batch_size: "1", sleep_s: "0" };

      const dry = psql("scripts/ops/publish-tiers-1-2.sql", { ...base, run_id: "it-dry", apply: "false", expected_t1: "2", expected_t2: "2" });
      expect(dry.status, dry.stderr).toBe(0);
      expect((await sql`SELECT count(*)::int AS n FROM legal_case WHERE publication = 'published'`)[0]!.n).toBe(1);

      const off = psql("scripts/ops/publish-tiers-1-2.sql", { ...base, run_id: "it-off", apply: "true", expected_t1: "3", expected_t2: "2" });
      expect(off.status).not.toBe(0);
      expect(off.stderr).toContain("TOLERANCE_ABORT");
      expect((await sql`SELECT count(*)::int AS n FROM publication_tier_release`)[0]!.n).toBe(0);

      const run = psql("scripts/ops/publish-tiers-1-2.sql", { ...base, run_id: "it-run", apply: "true", expected_t1: "2", expected_t2: "2" });
      expect(run.status, run.stderr).toBe(0);
      const published = await sql<{ public_id: string }[]>`
        SELECT lc.public_id FROM legal_case lc
        JOIN publication_current pc ON pc.object_type = 'legal_case' AND pc.object_id = lc.id AND pc.displayable
        WHERE lc.publication = 'published' AND lc.public_id <> 'scotus-live' ORDER BY 1`;
      expect(published.map((row) => row.public_id)).toEqual(["t1-ca2-cited", "t1-scotus-ok", "t2-ok", "t2-text-hold"]);
      const ledger = await sql<{ tier: number; n: number }[]>`
        SELECT tier, count(*)::int AS n FROM publication_tier_release WHERE run_id = 'it-run' AND state = 'published' GROUP BY 1 ORDER BY 1`;
      expect(ledger).toEqual([{ tier: 1, n: 2 }, { tier: 2, n: 2 }]);

      const undo = psql("scripts/ops/unpublish-tiers-1-2.sql", { run_id: "it-run", batch_size: "3", sleep_s: "0" });
      expect(undo.status, undo.stderr).toBe(0);
      expect((await sql`SELECT count(*)::int AS n FROM legal_case WHERE publication = 'published'`)[0]!.n).toBe(1);
      expect((await sql`SELECT count(*)::int AS n FROM publication_decision WHERE rule_version = 'publication-tiers-v1'`)[0]!.n).toBe(0);
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  });
});
