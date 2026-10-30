import { describe, expect, it } from "vitest";
import {
  DURABLE_FEDERAL_CHUNK_ROOT,
  LEGACY_FEDERAL_CHUNK_ROOT,
  federalChunkCorpusIsReadable,
  resolveFederalChunkFile,
} from "./federal-chunk-path";

const legacy = `${LEGACY_FEDERAL_CHUNK_ROOT}/2026-09-30/opinions-2026-09-30-000010.jsonl.gz`;
const durable = `${DURABLE_FEDERAL_CHUNK_ROOT}/2026-09-30/opinions-2026-09-30-000010.jsonl.gz`;

describe("federal chunk paths", () => {
  it("keeps a recorded path that is still on disk", () => {
    expect(resolveFederalChunkFile(legacy, (path) => path === legacy)).toBe(legacy);
  });

  it("follows a legacy ledger path onto the artifacts volume", () => {
    expect(resolveFederalChunkFile(legacy, (path) => path === durable)).toBe(durable);
  });

  it("follows a durable ledger path back to the legacy directory", () => {
    expect(resolveFederalChunkFile(durable, (path) => path === legacy)).toBe(legacy);
  });

  it("returns null when neither copy exists", () => {
    expect(resolveFederalChunkFile(legacy, () => false)).toBeNull();
  });

  it("treats an empty queue as readable and a fully missing sample as not", () => {
    expect(federalChunkCorpusIsReadable([], () => false)).toBe(true);
    expect(federalChunkCorpusIsReadable([legacy], () => false)).toBe(false);
    expect(federalChunkCorpusIsReadable([legacy, durable], (path) => path === durable)).toBe(true);
  });
});
