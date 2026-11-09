import { describe, expect, it } from "vitest";
import { continuousPublishBucket, continuousPublishEnabled, docketDisplayBackfillEnabled, metadataPublicationEnabled, nextPublishBatch, orderContinuousCases, pacedPublishLimit } from "./continuous-publish";

describe("continuous publish flag", () => {
  it("is on unless paused or explicitly disabled", () => {
    expect(continuousPublishEnabled({})).toBe(true);
    expect(continuousPublishEnabled({ CONTINUOUS_PUBLISH: "0" })).toBe(false);
    expect(continuousPublishEnabled({ JURVIO_PAUSE_CONTINUOUS_PUBLISH: "1" })).toBe(false);
  });

  it("shrinks the batch when search slows and stops when search is badly degraded", () => {
    expect(pacedPublishLimit(2000, 400, 0)).toBe(2000);
    expect(pacedPublishLimit(2000, 3500, 0)).toBe(500);
    expect(pacedPublishLimit(2000, 7000, 0)).toBe(0);
    expect(pacedPublishLimit(2000, null, 0)).toBe(500);
  });
});

describe("adaptive publish batch", () => {
  const calm = { searchMs: 400, casePageMs: 500, slowQueries: 0, lockWaits: 0 };
  it("ramps while search and case pages stay under 1.5 seconds", () => {
    expect(nextPublishBatch(1000, calm)).toBe(1500);
    expect(nextPublishBatch(8000, calm)).toBe(10000);
  });
  it("quarters the batch at 3 seconds and stops at 6", () => {
    expect(nextPublishBatch(2000, { ...calm, searchMs: 3500 })).toBe(500);
    expect(nextPublishBatch(2000, { ...calm, casePageMs: 6200 })).toBe(0);
    expect(nextPublishBatch(2000, { ...calm, slowQueries: 3 })).toBe(0);
    expect(nextPublishBatch(2000, { ...calm, lockWaits: 3 })).toBe(0);
  });
});

describe("metadata publication", () => {
  it("is on unless paused or set to 0", () => {
    expect(metadataPublicationEnabled({})).toBe(true);
    expect(metadataPublicationEnabled({ JURVIO_PUBLISH_FEDERAL_METADATA_WITHOUT_OPINION_TEXT: "0" })).toBe(true);
    expect(metadataPublicationEnabled({ JURVIO_PAUSE_FEDERAL_METADATA: "1" })).toBe(false);
  });
});

describe("docket display backfill", () => {
  it("runs unless paused", () => {
    expect(docketDisplayBackfillEnabled({})).toBe(true);
    expect(docketDisplayBackfillEnabled({ JURVIO_PAUSE_DOCKET_DISPLAY_BACKFILL: "1" })).toBe(false);
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
