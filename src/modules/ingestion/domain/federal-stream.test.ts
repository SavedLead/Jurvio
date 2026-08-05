import { describe, expect, it } from "vitest";
import {
  decodeStreamCursor,
  encodeStreamCursor,
  evaluateFederalPublicationCandidate,
  isFederalJurisdiction,
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
  hasReadableContent: true,
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

  it("recognizes verified bankruptcy courts in complete federal coverage", () => {
    expect(isFederalJurisdiction("Federal District")).toBe(true);
    expect(isFederalJurisdiction("Federal Appellate")).toBe(true);
    expect(isFederalJurisdiction("Federal Bankruptcy")).toBe(true);
    expect(isFederalJurisdiction("State")).toBe(false);
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

  it("publishes an official-source case with no CourtListener linkage", () => {
    // Verified court/docket/metadata/provenance/url/timestamp/checksum/readable
    // content, but sourced from a non-CourtListener official provider with no
    // canonical CourtListener docket id. CourtListener is not a publication gate.
    expect(evaluateFederalPublicationCandidate({
      ...publishable,
      sourceProviderCode: "pacer",
      sourceRecordId: "district-court-native-id",
      sourceUri: "https://ecf.nysd.uscourts.gov/cgi-bin/DktRpt.pl?123456",
      canonicalIdentifier: null,
      canonicalIdentifierCount: 0,
    })).toEqual({
      eligible: true,
      restricted: false,
      reasons: [],
    });
  });

  it("accepts any syntactically valid http(s) source url", () => {
    expect(evaluateFederalPublicationCandidate({
      ...publishable,
      sourceUri: "http://courts.example.gov/opinions/2026/456",
    }).eligible).toBe(true);
    expect(evaluateFederalPublicationCandidate({
      ...publishable,
      sourceProviderCode: "govinfo",
      sourceUri: "https://www.govinfo.gov/app/details/USCOURTS-nysd-1_26-cr-00001",
    }).eligible).toBe(true);
  });

  it("no longer gates on CourtListener provider, identity, or docket-id count", () => {
    const decision = evaluateFederalPublicationCandidate({
      ...publishable,
      sourceProviderCode: "cap",
      sourceRecordId: "999",
      canonicalIdentifier: "123",
      canonicalIdentifierCount: 3,
    });
    expect(decision.reasons).not.toContain("unsupported_source_provider");
    expect(decision.reasons).not.toContain("source_identifier_mismatch");
    expect(decision.reasons).not.toContain("ambiguous_canonical_identifier");
    expect(decision.reasons).not.toContain("invalid_source_uri");
    expect(decision.eligible).toBe(true);
  });

  it.each([
    ["missing stable identity", { caption: "  ", docketNumber: "  " }, "missing_stable_identity"],
    ["unverified federal court", { courtJurisdiction: "State" }, "unverified_federal_court"],
    ["uncertain court", { courtProviderId: null }, "missing_court_provider_identity"],
    ["unverified court record", { courtVerification: "not_verified" }, "unverified_court_record"],
    ["missing source artifact", { sourceArtifactId: null }, "missing_source_artifact"],
    ["missing source url", { sourceUri: null }, "missing_source_url"],
    ["malformed source url", { sourceUri: "not-a-url" }, "missing_source_url"],
    ["non-http source url", { sourceUri: "ftp://example.gov/doc" }, "missing_source_url"],
    ["incomplete source", { sourceContentHash: null }, "invalid_source_checksum"],
    ["malformed checksum", { sourceContentHash: "xyz" }, "invalid_source_checksum"],
    ["missing timestamp", { sourceRetrievedAt: null }, "missing_retrieval_timestamp"],
    ["unparseable timestamp", { sourceRetrievedAt: "not-a-date" }, "missing_retrieval_timestamp"],
    ["empty shell", { hasReadableContent: false }, "missing_readable_content"],
    ["ambiguous duplicate", { identityCollisionCount: 2 }, "duplicate_identity_collision"],
    ["unresolved rejection", { unresolvedRejections: 1 }, "unresolved_ingestion_rejection"],
    ["restricted matter", { restrictedText: "Sealed grand jury matter" }, "restricted_or_sensitive"],
  ])("quarantines %s", (_label, change, reason) => {
    const decision = evaluateFederalPublicationCandidate({ ...publishable, ...change });
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain(reason);
  });

  it("marks restricted matters as restricted for publication downgrade", () => {
    const decision = evaluateFederalPublicationCandidate({
      ...publishable,
      restrictedText: "Complaint filed under seal",
    });
    expect(decision.restricted).toBe(true);
    expect(decision.reasons).toContain("restricted_or_sensitive");
  });
});
