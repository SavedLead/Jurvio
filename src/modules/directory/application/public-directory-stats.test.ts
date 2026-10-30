import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { SCHEDULED_JOBS } from "../../../../scripts/scheduler-jobs";
import { isMissingTable, isStatementTimeout } from "./public-directory-stats";

describe("public directory stats refresher", () => {
  it("commits small throttled batches under its own lock", async () => {
    const source = await readFile("src/modules/directory/application/public-directory-stats.ts", "utf8");
    const script = await readFile("scripts/refresh-public-directory-stats.ts", "utf8");
    expect(source).toContain("set_config('statement_timeout'");
    expect(source).toContain("ANY(${ids}::uuid[])");
    expect(source).toContain("pauseMs");
    expect(script).toContain("pg_try_advisory_lock(hashtext('jurvio-public-directory-stats-v1'))");
    expect(script).toContain("max: 1");
  });

  it("runs every 30 minutes in the citations lane within its budget", () => {
    const job = SCHEDULED_JOBS.find((entry) => entry.name === "public-directory-stats");
    expect(job?.lane).toBe("citations");
    expect(job?.intervalMs).toBe(30 * 60_000);
    expect(job!.budgetMs).toBeLessThan(job!.intervalMs);
    expect(job?.command).toEqual(["jobs/refresh-public-directory-stats.mjs"]);
  });

  it("recognises timeouts and a missing table", () => {
    expect(isStatementTimeout({ code: "57014" })).toBe(true);
    expect(isStatementTimeout(new Error("canceling statement due to statement timeout"))).toBe(true);
    expect(isStatementTimeout(new Error("other"))).toBe(false);
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable({ code: "57014" })).toBe(false);
  });
});

describe("entity directory stats", () => {
  it("moves the cursor in the same transaction as the counts and reuses a fresh generation", async () => {
    const source = await readFile("src/modules/directory/application/public-directory-stats.ts", "utf8");
    expect(source).toContain("case_count = entity_public_stats.case_count + EXCLUDED.case_count");
    expect(source).toContain("UPDATE public_stats_generation SET building_cursor = ${last}");
    expect(source).toContain("ENTITY_REFRESH_EVERY_MS");
  });
});
