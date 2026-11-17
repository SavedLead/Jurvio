import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeDraftCursor,
  encodeDraftCursor,
  isStatementTimeout,
  publishCycleShouldStop,
} from "./publish-metadata-batch";

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
    expect(source).toContain("federal_publication_hold");
    expect(source).toContain("metadataHoldReopenSql");
    expect(source).not.toMatch(/checksum|source_uri|content_hash/);
  });

  it("reads a fixed draft-index window and resumes from a saved cursor", () => {
    expect(source).toContain("legal_case_draft_created_idx");
    expect(source).toContain("metadata-publish-draft-window");
    expect(source).toContain("AS MATERIALIZED");
    expect(source).toContain("DRAFT_WINDOW_SIZE");
    expect(source).toContain("(c.created_at, c.id) >");
    expect(source).toContain("(c.created_at, c.id) <");
    expect(source).toContain("ORDER BY c.created_at DESC, c.id DESC");
    expect(source).not.toContain("for (const tier of");
  });

  it("stops the cycle on the first statement timeout and skips an overlapping pass", () => {
    expect(source).toContain("publishCycleShouldStop");
    expect(source).toContain("pg_try_advisory_lock");
    expect(source).toContain('"statement_timeout"');
    expect(source).not.toContain("timeouts += 1");
  });
});

describe("draft window cursor", () => {
  const cursor = {
    highCreatedAt: "2026-11-17T03:36:00.123Z",
    highId: "11111111-1111-4111-8111-111111111111",
    frontierCreatedAt: "2026-11-16T03:36:00.000Z",
    frontierId: "22222222-2222-4222-8222-222222222222",
  };

  it("round-trips the saved cursor and rejects a partial value", () => {
    expect(decodeDraftCursor(encodeDraftCursor(cursor))).toEqual(cursor);
    expect(decodeDraftCursor(null)).toBeNull();
    expect(decodeDraftCursor("2026-11-17T03:36:00.123Z|not-a-uuid|2026-11-16T03:36:00.000Z|22222222-2222-4222-8222-222222222222")).toBeNull();
  });

  it("stops after a timeout even when nothing was scanned", () => {
    expect(publishCycleShouldStop({ scanned: 0, heldByReason: { query_timeout: 1 } })).toBe(true);
    expect(publishCycleShouldStop({ scanned: 500, heldByReason: {} })).toBe(false);
    expect(publishCycleShouldStop({ scanned: 0, heldByReason: {} })).toBe(true);
    expect(isStatementTimeout(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }))).toBe(true);
    expect(isStatementTimeout(new Error("courtlistener provider is missing"))).toBe(false);
  });
});