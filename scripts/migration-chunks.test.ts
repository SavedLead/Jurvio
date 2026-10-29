import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { splitMigrationChunks } from "./migration-chunks.js";

describe("splitMigrationChunks", () => {
  it("keeps a migration without a commit marker as one chunk", () => {
    const source = "-- comment\nCREATE TABLE example (id int);\n";
    expect(splitMigrationChunks(source)).toEqual(["-- comment\nCREATE TABLE example (id int);"]);
  });

  it("commits each side of a concurrent index separately", () => {
    const source = `
CREATE TABLE example (id int);

-- @commit

CREATE INDEX CONCURRENTLY example_id_idx ON example (id);

-- @commit

ANALYZE example;
`;
    expect(splitMigrationChunks(source)).toEqual([
      "CREATE TABLE example (id int);",
      "CREATE INDEX CONCURRENTLY example_id_idx ON example (id);",
      "ANALYZE example;",
    ]);
  });

  it("runs the live projection index outside the search backfill transaction", async () => {
    const source = await readFile("db/migrations/0124_opinion_search_performance.sql", "utf8");
    const chunks = splitMigrationChunks(source);
    const indexChunk = chunks.find((chunk) => chunk.split("\n").some((line) => line.startsWith("CREATE INDEX CONCURRENTLY")));
    expect(indexChunk).toBeDefined();
    const executable = indexChunk!.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    expect(executable).not.toMatch(/insert into/i);
    expect(chunks.at(-1)).toMatch(/INSERT INTO opinion_search_meta/);
  });
});
