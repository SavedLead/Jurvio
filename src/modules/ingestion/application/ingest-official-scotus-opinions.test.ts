import { describe, expect, it } from "vitest";
import {
  normalizeOfficialScotusIngestionOptions,
  selectOfficialScotusBatch,
} from "./ingest-official-scotus-opinions";

describe("official Supreme Court ingestion limits", () => {
  it("accepts a bounded deterministic batch", () => {
    expect(normalizeOfficialScotusIngestionOptions({ termYear: "24", limit: 25, resume: true })).toEqual({ termYear: "24", limit: 25, resume: true });
  });
  it("rejects unbounded or malformed selection", () => {
    expect(() => normalizeOfficialScotusIngestionOptions({ termYear: "2024", limit: 25, resume: false })).toThrow(/two-digit/);
    expect(() => normalizeOfficialScotusIngestionOptions({ termYear: "24", limit: 101, resume: false })).toThrow(/between 1 and 100/);
  });
  it("accepts the fetch-stage clamp ceiling of 100", () => {
    // The enriched lane fans an over-large `--limit` (e.g. the scheduler's 300) down
    // to 100 before calling this normaliser. 100 must stay a valid batch size, or the
    // clamp would still trip this guard and crash-loop the lane on startup as before.
    expect(normalizeOfficialScotusIngestionOptions({ termYear: "25", limit: 100, resume: true }))
      .toEqual({ termYear: "25", limit: 100, resume: true });
  });
});

describe("official Supreme Court ingestion checkpoint selection", () => {
  const records = [
    { sourceRecordId: "25:1:first.pdf" },
    { sourceRecordId: "25:9:second.pdf" },
    { sourceRecordId: "25:10:third.pdf" },
  ];

  it("resumes by index position rather than unsafe lexical comparison", () => {
    expect(selectOfficialScotusBatch(records, 2, "25:9:second.pdf")).toEqual([
      { sourceRecordId: "25:10:third.pdf" },
    ]);
  });

  it("fails closed when the official index no longer contains the checkpoint", () => {
    expect(() => selectOfficialScotusBatch(records, 2, "25:missing.pdf"))
      .toThrow(/checkpoint is not present/);
  });
});
