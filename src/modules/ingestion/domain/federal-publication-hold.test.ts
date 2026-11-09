import { describe, expect, it } from "vitest";
import {
  federalHoldSuppressesCandidate,
  federalPublicationIncludesCourt,
  metadataHoldReopenSql,
  METADATA_REOPENABLE_REASONS,
} from "./federal-publication-hold";

describe("federal publication hold suppression", () => {
  it("keeps a missing-text hold in force until metadata publication is enabled", () => {
    expect(federalHoldSuppressesCandidate(["missing_readable_content"], false)).toBe(true);
    expect(federalHoldSuppressesCandidate(["missing_readable_content"], true)).toBe(false);
  });

  it("reopens a hold that is only missing text, source provenance, or an unverified court", () => {
    expect(federalHoldSuppressesCandidate(["unverified_court_record"], true)).toBe(false);
    expect(
      federalHoldSuppressesCandidate(
        ["unverified_court_record", "missing_readable_content", "missing_source_url", "invalid_source_checksum"],
        true,
      ),
    ).toBe(false);
    expect(federalHoldSuppressesCandidate(["missing_source_url"], false)).toBe(true);
  });

  it("does not waive a hold that also failed a seal, collision, or identity check", () => {
    expect(
      federalHoldSuppressesCandidate(
        ["unverified_court_record", "restricted_or_sensitive"],
        true,
      ),
    ).toBe(true);
    expect(federalHoldSuppressesCandidate(["duplicate_identity_collision"], true)).toBe(true);
    expect(federalHoldSuppressesCandidate(["missing_stable_identity"], true)).toBe(true);
  });

  it("leaves an empty reason list suppressed so a blank hold is not treated as metadata-only", () => {
    expect(federalHoldSuppressesCandidate([], true)).toBe(true);
  });

  it("builds the same reopen list the publisher SQL uses", () => {
    const sql = metadataHoldReopenSql();
    for (const reason of METADATA_REOPENABLE_REASONS) expect(sql).toContain(`'${reason}'`);
    expect(sql).toContain("cardinality(hold.reasons) > 0");
    expect(sql).not.toContain("restricted_or_sensitive");
  });
});

describe("federal publication court scope", () => {
  it("leaves SCOTUS to the official pipeline and keeps other courts", () => {
    expect(federalPublicationIncludesCourt("scotus")).toBe(false);
    expect(federalPublicationIncludesCourt("SCOTUS")).toBe(false);
    expect(federalPublicationIncludesCourt(" scotus ")).toBe(false);
    expect(federalPublicationIncludesCourt("nysd")).toBe(true);
    expect(federalPublicationIncludesCourt(null)).toBe(true);
  });
});
