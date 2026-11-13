import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCHEDULED_JOBS } from "../../../../scripts/scheduler-jobs";
import { CASE_REFRESH_MINUTES, GROUP_CASE_LIMIT, GROUP_REFRESH_MINUTES, REFRESH_BATCH } from "./followed-item-priority";

describe("followed item priority lane", () => {
  const source = readFileSync("src/modules/ingestion/application/followed-item-priority.ts", "utf8");
  const job = SCHEDULED_JOBS.find((entry) => entry.name === "followed-item-priority");

  it("checks followed cases ahead of the group list and stays on the ingestion lane", () => {
    expect(CASE_REFRESH_MINUTES).toBe(15);
    expect(GROUP_REFRESH_MINUTES).toBe(30);
    expect(GROUP_CASE_LIMIT).toBe(25);
    expect(REFRESH_BATCH).toBe(6);
    expect(job?.lane).toBe("core");
    expect(job?.command).toEqual(["jobs/run-followed-item-priority.mjs", "--limit=6"]);
    expect(job?.intervalMs).toBe(5 * 60_000);
    expect(source).toContain("stopOnRateLimit: true");
    expect(source).toContain("newestEntriesFirst: true");
    expect(source).toContain("skipPdfs: true");
    expect(source).toContain("sealed|under seal|grand jury");
    expect(source).not.toContain("legal_case.updated_at = now()");
  });

  it("queues a new case follow without waiting for the next rebuild", () => {
    const follows = readFileSync("src/modules/accounts/application/follows.ts", "utf8");
    expect(follows).toContain("queueFollowedCase");
  });
});
