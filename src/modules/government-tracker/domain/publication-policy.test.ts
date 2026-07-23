import { describe, expect, it } from "vitest";
import { allegationNotice, isGovernmentLeadPublic } from "./publication-policy";

describe("government source-lead publication", () => {
  const reviewed = {
    reviewStatus: "published" as const,
    reviewedAt: "2026-07-22T12:00:00Z",
    publishedAt: "2026-07-22T13:00:00Z",
    sourceUrl: "https://www.justice.gov/example",
    attributedSummary: "According to the Department of Justice release, the complaint alleges conduct.",
  };

  it("requires a completed review and explicit publication", () => {
    expect(isGovernmentLeadPublic(reviewed)).toBe(true);
    expect(isGovernmentLeadPublic({ ...reviewed, reviewStatus: "reviewed" })).toBe(false);
    expect(isGovernmentLeadPublic({ ...reviewed, reviewedAt: null })).toBe(false);
  });

  it("requires a secure source and attributed text", () => {
    expect(isGovernmentLeadPublic({ ...reviewed, sourceUrl: "http://example.com" })).toBe(false);
    expect(isGovernmentLeadPublic({ ...reviewed, attributedSummary: " " })).toBe(false);
  });

  it("states that allegations are not findings", () => {
    expect(allegationNotice("the SEC")).toContain("Allegations are not findings");
  });
});
