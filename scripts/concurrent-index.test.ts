import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  concurrentIndexNames,
  formatBlockingSessions,
  sessionsBlockingIndexBuild,
} from "./concurrent-index.mjs";
import { splitMigrationChunks } from "./migration-chunks.js";

describe("concurrent index builds", () => {
  it("keeps the docket entry index in its own committed chunk", async () => {
    const source = await readFile("db/migrations/0205_catchup_date_correction_index.sql", "utf8");
    const chunks = splitMigrationChunks(source);
    const indexChunk = chunks.find((chunk) => concurrentIndexNames(chunk).length > 0);
    expect(indexChunk).toBeDefined();
    expect(concurrentIndexNames(indexChunk!)).toEqual(["docket_entry_case_provider_entry_idx"]);
    const executable = indexChunk!.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    expect(executable).toMatch(/^CREATE INDEX CONCURRENTLY IF NOT EXISTS docket_entry_case_provider_entry_idx/m);
    expect(executable).not.toMatch(/\bBEGIN\b/i);
    expect(executable).not.toMatch(/DROP INDEX/i);
  });

  it("reports a leftover dump or index build and does not treat idle sessions as blockers", () => {
    const activity = [
      { pid: 10, application_name: "pg_dump", state: "active", query_age: "00:40:00", query: "COPY public.docket_entry" },
      { pid: 11, application_name: "psql", state: "active", query: "CREATE INDEX CONCURRENTLY docket_entry_case_provider_entry_idx ON docket_entry (case_id)" },
      { pid: 12, application_name: "jurvio", state: "idle", query: "UPDATE legal_case SET publication = 'published'" },
      { pid: 13, application_name: "jurvio", state: "active", query: "SELECT 1" },
    ];
    const blockers = sessionsBlockingIndexBuild(activity, "docket_entry_case_provider_entry_idx");
    expect(blockers.map((row) => row.pid)).toEqual([10, 11]);
    expect(formatBlockingSessions("docket_entry_case_provider_entry_idx", blockers)).toContain("pid=10");
    expect(formatBlockingSessions("docket_entry_case_provider_entry_idx", blockers)).toContain("Do not terminate");
  });
});
