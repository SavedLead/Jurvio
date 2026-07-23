import { describe, expect, it } from "vitest";
import { analyticsPathTemplate, privacySafeSearchDimensions } from "./record-demand-event";

describe("privacy-safe demand dimensions", () => {
  it("removes public IDs and entity slugs from recorded paths", () => {
    expect(analyticsPathTemplate("/case/jv-abc12345/documents/jv-ignored?ref=email")).toBe(
      "/case/:caseId/documents/jv-ignored",
    );
    expect(analyticsPathTemplate("/case/jv-abc12345/documents/jd-def67890")).toBe(
      "/case/:caseId/documents/:documentId",
    );
    expect(analyticsPathTemplate("/person/jane-public-profile/cases")).toBe(
      "/person/:entityId/cases",
    );
  });

  it("describes query shape without retaining query text or a reversible hash", () => {
    const dimensions = privacySafeSearchDimensions("24-cv-12345 AND retaliation");
    expect(dimensions).toEqual({
      queryLengthBucket: "medium",
      queryTokenBucket: "3-6",
      hasBooleanSyntax: true,
      hasCitationShape: false,
      hasDocketShape: false,
    });
    expect(JSON.stringify(dimensions)).not.toContain("retaliation");
    expect(dimensions).not.toHaveProperty("queryHash");
  });
});
