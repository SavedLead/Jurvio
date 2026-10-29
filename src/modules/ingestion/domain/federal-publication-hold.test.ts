import { describe, expect, it } from "vitest";
import {
  federalHoldSuppressesCandidate,
  federalPublicationIncludesCourt,
} from "./federal-publication-hold";

describe("federal publication hold suppression", () => {
  it("keeps a missing-text hold in force until metadata publication is enabled", () => {
    expect(federalHoldSuppressesCandidate(["missing_readable_content"], false)).toBe(true);
    expect(federalHoldSuppressesCandidate(["missing_readable_content"], true)).toBe(false);
  });

  it("does not waive a hold that also failed another check", () => {
    expect(
      federalHoldSuppressesCandidate(
        ["unverified_court_record", "missing_readable_content"],
        true,
      ),
    ).toBe(true);
    expect(federalHoldSuppressesCandidate(["unverified_court_record"], true)).toBe(true);
  });

  it("leaves an empty reason list suppressed so a blank hold is not treated as metadata-only", () => {
    expect(federalHoldSuppressesCandidate([], true)).toBe(true);
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
