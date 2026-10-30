import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { SCHEDULED_JOBS } from "../../../../scripts/scheduler-jobs";
import { publicCaseSearchReady, resetPublicCaseSearchReadyMemo } from "./public-case-search";

describe("public case search refresher", () => {
  it("is throttled, resumable and uses its own lock", async () => {
    const source = await readFile("src/modules/cases/application/public-case-search.ts", "utf8");
    const script = await readFile("scripts/refresh-public-case-search.ts", "utf8");
    expect(source).toContain("set_config('statement_timeout'");
    expect(source).toContain("SET sweep_cursor = ${cursor}");
    expect(source).toContain("IS DISTINCT FROM EXCLUDED.search_text");
    expect(script).toContain("pg_try_advisory_lock(hashtext('jurvio-public-case-search-v1'))");
    expect(script).toContain("max: 1");
  });

  it("runs every 15 minutes in the citations lane with a bounded batch count", () => {
    const job = SCHEDULED_JOBS.find((entry) => entry.name === "public-case-search");
    expect(job?.lane).toBe("citations");
    expect(job?.intervalMs).toBe(15 * 60_000);
    expect(job!.budgetMs).toBeLessThan(job!.intervalMs);
    expect(job?.command).toEqual(["jobs/refresh-public-case-search.mjs", "--max-batches=150"]);
  });

  it("treats a missing state table as not ready and memoizes the answer", async () => {
    resetPublicCaseSearchReadyMemo();
    let calls = 0;
    const missing = Object.assign(async () => { calls += 1; throw Object.assign(new Error("relation does not exist"), { code: "42P01" }); }, {});
    const sql = (() => missing()) as unknown as Parameters<typeof publicCaseSearchReady>[0];
    expect(await publicCaseSearchReady(sql, 1_000)).toBe(false);
    expect(await publicCaseSearchReady(sql, 2_000)).toBe(false);
    expect(calls).toBe(1);
    resetPublicCaseSearchReadyMemo();
  });
});
