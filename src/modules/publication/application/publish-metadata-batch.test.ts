import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("metadata batch publish", () => {
  const source = readFileSync("src/modules/publication/application/publish-metadata-batch.ts", "utf8");

  it("publishes a caption and docket without rewriting alert timestamps", () => {
    expect(source).toContain("publication = 'published'");
    expect(source).toContain("metadata_batch_without_opinion_text");
    expect(source).not.toMatch(/updated_at/);
    expect(source).not.toMatch(/UPDATE\s+docket_entry/i);
    expect(source).not.toMatch(/case_follow/);
    expect(source).not.toMatch(/last_alerted/);
  });

  it("keeps sealed captions off the batch and does not require a checksum", () => {
    expect(source).toContain(String.raw`\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\M`);
    expect(source).toContain("<> 'scotus'");
    expect(source).toContain("docket_entry");
    expect(source).not.toMatch(/checksum|source_uri|content_hash/);
  });
});