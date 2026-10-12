import { describe, expect, it } from "vitest";
import {
  compareFederalCourtPriority,
  decodeStreamCursor,
  encodeStreamCursor,
  evaluateFederalPublicationCandidate,
  federalCourtServiceRank,
  isFederalJurisdiction,
  isNonBankruptcyFederalJurisdiction,
  isRestrictedDocketText,
  orderFederalCourtsByPriority,
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
  providerScopedIdentifier: "123",
  sourceRecordResolvesIdentity: true,
  courtCaseLinkageVerified: true,
};

describe("federal ingestion stream controls", () => {
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

  it("decodes legacy checkpoints regardless of the retired batchSize value", () => {
    const fallback = {
      version: 1 as const,
      windowStart: "2026-07-01T00:00:00.000Z",
      windowEnd: "2026-07-02T00:00:00.000Z",
      next: null,
      batchSize: 100,
      completedWindows: 0,
    };
    // A checkpoint written by the old throttle at the top batch step still decodes;
    // the value is retained verbatim but no longer limits how much a cycle processes.
    expect(
      decodeStreamCursor(
        JSON.stringify({ ...fallback, batchSize: 10_000, completedWindows: 7 }),
        fallback,
      ),
    ).toMatchObject({ batchSize: 10_000, completedWindows: 7 });
    // A checkpoint missing the legacy field entirely is tolerated and defaulted.
    const { batchSize, ...withoutBatch } = fallback;
    void batchSize;
    expect(decodeStreamCursor(JSON.stringify(withoutBatch), fallback).batchSize).toBe(100);
  });

  it("ranks courts SCOTUS -> circuits -> districts -> other", () => {
    expect(federalCourtServiceRank({ providerCourtId: "scotus", jurisdiction: "F" })).toBe(0);
    expect(federalCourtServiceRank({ providerCourtId: "ca9", jurisdiction: "F" })).toBe(1);
    expect(
      federalCourtServiceRank({ providerCourtId: "ca9", jurisdiction: "Federal Appellate" }),
    ).toBe(1);
    expect(
      federalCourtServiceRank({ providerCourtId: "nysd", jurisdiction: "Federal District" }),
    ).toBe(2);
    expect(federalCourtServiceRank({ providerCourtId: "nysd", jurisdiction: "FD" })).toBe(2);
    expect(federalCourtServiceRank({ providerCourtId: "nyeb", jurisdiction: "State" })).toBe(3);
  });

  it("orders circuits ahead of districts and districts busiest-first", () => {
    const ordered = orderFederalCourtsByPriority([
      { providerCourtId: "txsd", jurisdiction: "Federal District", recentEventVolume: 40 },
      { providerCourtId: "scotus", jurisdiction: "F", recentEventVolume: 1 },
      { providerCourtId: "cand", jurisdiction: "Federal District", recentEventVolume: 900 },
      { providerCourtId: "ca9", jurisdiction: "Federal Appellate", recentEventVolume: 5 },
      { providerCourtId: "nysd", jurisdiction: "Federal District", recentEventVolume: 900 },
    ]);
    expect(ordered.map((court) => court.providerCourtId)).toEqual([
      "scotus", // SCOTUS first
      "ca9", // then the circuit
      "cand", // districts busiest-first; tie broken by provider id
      "nysd",
      "txsd",
    ]);
  });

  it("does not mutate the input array when ordering courts", () => {
    const input = [
      { providerCourtId: "txsd", jurisdiction: "Federal District", recentEventVolume: 1 },
      { providerCourtId: "ca9", jurisdiction: "Federal Appellate", recentEventVolume: 1 },
    ];
    const snapshot = input.map((court) => court.providerCourtId);
    orderFederalCourtsByPriority(input);
    expect(input.map((court) => court.providerCourtId)).toEqual(snapshot);
    expect(compareFederalCourtPriority(input[0]!, input[1]!)).toBeGreaterThan(0);
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

  it("recognizes specialized (FS) and bankruptcy-appellate (FBP) federal jurisdictions", () => {
    // Tax Court, Court of Federal Claims, CIT, and the historical specialized courts are
    // coded 'FS'; bankruptcy appellate panels 'FBP'. They are federal jurisdiction classes;
    // actual publication still requires the court to be registry-verified.
    expect(isFederalJurisdiction("FS")).toBe(true);
    expect(isFederalJurisdiction("fbp")).toBe(true);
    expect(isFederalJurisdiction("Federal Special")).toBe(true);
    expect(isFederalJurisdiction("SA")).toBe(false);
    expect(isFederalJurisdiction("State Appellate")).toBe(false);
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

  it("publishes a docket-less record with a validated alternative identity", () => {
    // No docket number, but a provider-scoped id that resolves to the retrieved source
    // record and a verified court/case linkage, plus a caption. This is a stable identity.
    const decision = evaluateFederalPublicationCandidate({
      ...publishable,
      docketNumber: "   ",
      providerScopedIdentifier: "cl-opinion-556677",
      sourceRecordResolvesIdentity: true,
      courtCaseLinkageVerified: true,
    });
    expect(decision.reasons).not.toContain("missing_stable_identity");
    expect(decision.eligible).toBe(true);
  });

  it.each([
    [
      "caption alone is not sufficient without a resolvable alternative identity",
      { docketNumber: "  ", providerScopedIdentifier: null, sourceRecordResolvesIdentity: false, courtCaseLinkageVerified: false },
    ],
    [
      "docket-less with an id that does not resolve to the source record",
      { docketNumber: "  ", providerScopedIdentifier: "cl-opinion-1", sourceRecordResolvesIdentity: false, courtCaseLinkageVerified: true },
    ],
    [
      "docket-less with an unverified court/case linkage",
      { docketNumber: "  ", providerScopedIdentifier: "cl-opinion-1", sourceRecordResolvesIdentity: true, courtCaseLinkageVerified: false },
    ],
  ])("holds a docket-less record when %s", (_label, change) => {
    const decision = evaluateFederalPublicationCandidate({ ...publishable, ...change });
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain("missing_stable_identity");
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
