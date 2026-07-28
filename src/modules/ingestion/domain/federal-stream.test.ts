import { describe, expect, it } from "vitest";
import {
  decodeStreamCursor,
  encodeStreamCursor,
  evaluateFederalPublicationCandidate,
  isNonBankruptcyFederalJurisdiction,
  isRestrictedDocketText,
  nextBatchSize,
  type FederalPublicationCandidate,
} from "./federal-stream";

const publishable: FederalPublicationCandidate = {
  caption: "United States v. Smith",
  docketNumber: "1:26-cr-00001",
  courtJurisdiction: "Federal District",
  courtProviderId: "nysd",
  courtVerification: "verified",
  sourceArtifactId: "artifact-1",
  sourceProviderCode: "courtlistener",
  sourceRecordId: "123",
  sourceUri: "https://www.courtlistener.com/api/rest/v4/dockets/123/",
  sourceContentHash: "a".repeat(64),
  sourceRetrievedAt: "2026-07-28T00:00:00.000Z",
  canonicalIdentifier: "123",
  canonicalIdentifierCount: 1,
  identityCollisionCount: 1,
  unresolvedRejections: 0,
  restrictedText: "United States v. Smith 1:26-cr-00001",
};

describe("federal ingestion stream controls", () => {
  it("requires a clean, explicit, single-stage promotion", () => {
    expect(nextBatchSize(100, 1_000, 0, 0, false)).toBe(100);
    expect(nextBatchSize(100, 1_000, 0, 0, true)).toBe(1_000);
    expect(nextBatchSize(1_000, 10_000, 0, 0, true)).toBe(10_000);
    expect(nextBatchSize(100, 1_000, 1, 0, true)).toBe(100);
    expect(nextBatchSize(1_000, 10_000, 0, 1, true)).toBe(1_000);
    expect(() => nextBatchSize(100, 10_000, 0, 0, true)).toThrow(/100 -> 1000/);
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
    expect(isNonBankruptcyFederalJurisdiction("Federal Bankruptcy")).toBe(false);
  });

  it("holds restricted docket text", () => {
    expect(isRestrictedDocketText("Complaint filed under seal")).toBe(true);
    expect(isRestrictedDocketText("United States v. Smith")).toBe(false);
  });

  it("publishes only a fully sourced, unambiguous candidate", () => {
    expect(evaluateFederalPublicationCandidate(publishable)).toEqual({
      eligible: true,
      restricted: false,
      reasons: [],
    });
  });

  it.each([
    ["uncertain court", { courtProviderId: null }, "missing_court_provider_identity"],
    ["incomplete source", { sourceContentHash: null }, "invalid_source_checksum"],
    ["contradictory identity", { sourceRecordId: "999" }, "source_identifier_mismatch"],
    ["ambiguous duplicate", { identityCollisionCount: 2 }, "duplicate_identity_collision"],
    ["restricted matter", { restrictedText: "Sealed grand jury matter" }, "restricted_or_sensitive"],
  ])("quarantines %s", (_label, change, reason) => {
    const decision = evaluateFederalPublicationCandidate({ ...publishable, ...change });
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain(reason);
  });
});
