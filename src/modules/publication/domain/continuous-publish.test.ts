import { describe, expect, it } from "vitest";
import { continuousPublishBucket, continuousPublishEnabled, orderContinuousCases } from "./continuous-publish";

describe("continuous publish flag", () => {
  it("stays off unless explicitly enabled and not paused", () => {
    expect(continuousPublishEnabled({})).toBe(false);
    expect(continuousPublishEnabled({ CONTINUOUS_PUBLISH: "0" })).toBe(false);
    expect(continuousPublishEnabled({ CONTINUOUS_PUBLISH: "1" })).toBe(true);
    expect(continuousPublishEnabled({ CONTINUOUS_PUBLISH: "1", JURVIO_PAUSE_CONTINUOUS_PUBLISH: "1" })).toBe(false);
  });
});

describe("continuous publish order", () => {
  const now = new Date("2026-11-09T12:00:00Z");

  it("puts opinion-backed and well-described cases ahead of new filings and thin old cases", () => {
    expect(continuousPublishBucket({ filedOn: "2026-10-01", hasOpinionText: false, signalCount: 0, hasName: true, now })).toBe("recent");
    expect(continuousPublishBucket({ filedOn: "1994-01-01", hasOpinionText: false, signalCount: 0, hasName: false, now })).toBe("pre2000_thin");
    expect(continuousPublishBucket({ filedOn: "2012-01-01", hasOpinionText: true, signalCount: 0, hasName: true, now })).toBe("substantial");
    const ordered = orderContinuousCases([
      { id: "old", bucket: "pre2000_thin" as const, filedOn: "1994-01-01" },
      { id: "new", bucket: "recent" as const, filedOn: "2026-10-01" },
      { id: "thick", bucket: "substantial" as const, filedOn: "2012-01-01" },
    ]);
    expect(ordered.map((row) => row.id)).toEqual(["thick", "new", "old"]);
  });
});
