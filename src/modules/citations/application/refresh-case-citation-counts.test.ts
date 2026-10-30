import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("citation count refresh", () => {
  it("commits batches instead of one corpus-wide insert", async () => {
    const source = await readFile("src/modules/citations/application/refresh-case-citation-counts.ts", "utf8");
    const script = await readFile("scripts/refresh-case-citation-counts.ts", "utf8");
    expect(source).toContain("citationCounts: \"batch\"");
    expect(source).toContain("57014");
    expect(source).toContain("set_config('statement_timeout'");
    expect(source).not.toContain("citing_doc");
    expect(source).toContain("ANY(${ids}::uuid[])");
    expect(script).toContain("pg_try_advisory_lock(hashtext('jurvio-case-citation-counts-v1'))");
    expect(script).not.toContain("pg_advisory_lock(hashtext(");
    expect(script).not.toContain("1_200_000");
  });
});
