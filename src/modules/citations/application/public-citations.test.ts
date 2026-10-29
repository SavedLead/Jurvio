import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("case citation counts", () => {
  it("does not group every citation identity to answer one case", async () => {
    const source = await readFile("src/modules/citations/application/public-citations.ts", "utf8");
    const counts = source.slice(source.indexOf("export async function caseCitationCounts"));
    expect(counts).not.toContain("unique_case_citation");
    expect(counts).toContain("own_unique_keys");
    expect(counts).toContain("case_citation_identity own ON own.case_id=cc.id");
    expect(counts).toContain("SELECT DISTINCT ref.document_id, ref.source_content_hash");
  });
});
