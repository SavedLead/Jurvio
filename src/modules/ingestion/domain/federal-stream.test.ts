import { describe, expect, it } from "vitest";
import {
  decodeStreamCursor,
  encodeStreamCursor,
  isNonBankruptcyFederalJurisdiction,
  isRestrictedDocketText,
  nextBatchSize,
} from "./federal-stream";

describe("federal ingestion stream controls", () => {
  it("scales only clean validation cycles", () => {
    expect(nextBatchSize(100, 0, 0)).toBe(1_000);
    expect(nextBatchSize(1_000, 0, 0)).toBe(10_000);
    expect(nextBatchSize(10_000, 0, 0)).toBe(10_000);
    expect(nextBatchSize(100, 1, 0)).toBe(100);
    expect(nextBatchSize(1_000, 0, 1)).toBe(1_000);
  });

  it("round trips durable cursors", () => {
    const cursor = {
      version: 1 as const,
      windowStart: "2026-07-01T00:00:00.000Z",
      windowEnd: "2026-07-02T00:00:00.000Z",
      next: "https://www.courtlistener.com/api/rest/v4/dockets/?cursor=opaque",
      batchSize: 1_000,
      completedWindows: 4,
    };
    expect(decodeStreamCursor(encodeStreamCursor(cursor), cursor)).toEqual(cursor);
  });

  it("fails closed on malformed checkpoints", () => {
    expect(() => decodeStreamCursor("{}", {
      version: 1,
      windowStart: "2026-07-01T00:00:00.000Z",
      windowEnd: "2026-07-02T00:00:00.000Z",
      next: null,
      batchSize: 100,
      completedWindows: 0,
    })).toThrow(/malformed/);
  });

  it("keeps bankruptcy separate from district and appellate coverage", () => {
    expect(isNonBankruptcyFederalJurisdiction("Federal District")).toBe(true);
    expect(isNonBankruptcyFederalJurisdiction("Federal Appellate")).toBe(true);
    expect(isNonBankruptcyFederalJurisdiction("FD")).toBe(true);
    expect(isNonBankruptcyFederalJurisdiction("Federal Bankruptcy")).toBe(false);
    expect(isNonBankruptcyFederalJurisdiction("FB")).toBe(false);
    expect(isNonBankruptcyFederalJurisdiction(null)).toBe(false);
  });

  it("holds restricted docket text", () => {
    expect(isRestrictedDocketText("Complaint filed under seal")).toBe(true);
    expect(isRestrictedDocketText("United States v. Smith")).toBe(false);
  });
});
