import { describe, expect, it } from "vitest";
import { classifySourceHealth, formatByteCount } from "./get-operations-dashboard";

const source = {
  code: "courtlistener", name: "CourtListener", baseUrl: "https://www.courtlistener.com",
  latestRunStatus: "completed", latestRunStartedAt: "2026-07-22T10:00:00.000Z",
  latestRunCompletedAt: "2026-07-22T10:01:00.000Z", latestArtifactAt: "2026-07-22T10:00:30.000Z",
  checkpointCount: 1,
};

describe("operations dashboard helpers", () => {
  it("formats storage without overstating precision", () => {
    expect(formatByteCount(0)).toBe("0 B");
    expect(formatByteCount(1_500)).toBe("1.50 KB");
    expect(formatByteCount(12_500_000)).toBe("12.5 MB");
  });

  it("makes failures more important than recency", () => {
    expect(classifySourceHealth({ ...source, latestRunStatus: "completed_with_errors" }).tone).toBe("danger");
  });

  it("classifies recent and stale sources deterministically", () => {
    expect(classifySourceHealth(source, Date.parse("2026-07-23T10:00:00.000Z")).label).toBe("Healthy");
    expect(classifySourceHealth(source, Date.parse("2026-08-01T10:00:00.000Z")).label).toBe("Stale");
  });
});
