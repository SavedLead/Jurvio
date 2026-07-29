import { describe, expect, it } from "vitest";
import { analyticsAllowedOnPath, analyticsPathTemplate } from "./analytics-policy";

describe("PostHog privacy policy", () => {
  it.each([
    "/internal/analytics", "/login", "/auth/callback", "/account",
    "/settings/profile", "/billing", "/correction/request", "/privacy-request/new",
  ])("excludes sensitive route %s", (path) => {
    expect(analyticsAllowedOnPath(path)).toBe(false);
  });

  it("allows public legal research routes", () => {
    expect(analyticsAllowedOnPath("/case/jv-abc12345/documents/jd-def67890")).toBe(true);
  });

  it("templates public identifiers before capture", () => {
    expect(analyticsPathTemplate("/case/jv-abc12345/documents/jd-def67890")).toBe(
      "/case/:caseId/documents/:documentId",
    );
  });
});
