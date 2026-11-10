import { describe, expect, it } from "vitest";
import { continuousPublishBucket, continuousPublishEnabled, docketDisplayBackfillEnabled, metadataPublicationEnabled, nextPublishBatch, orderContinuousCases, pacedPublishLimit } from "./continuous-publish";

describe("continuous publish flag", () => {
  it("is on unless paused or explicitly disabled", () => {
    expect(continuousPublishEnabled({})).toBe(true);
    expect(continuousPublishEnabled({ CONTINUOUS_PUBLISH: "0" })).toBe(false);
    expect(continuousPublishEnabled({ JURVIO_PAUSE_CONTINUOUS_PUBLISH: "1" })).toBe(false);
  });

  it("keeps the full batch when pages are slow or a single probe fails", () => {
    expect(pacedPublishLimit(2000, 400, 0)).toBe(2000);
    expect(pacedPublishLimit(2000, 12_000, 5)).toBe(2000);
    expect(pacedPublishLimit(2000, null, 0)).toBe(2000);
  });
});

describe("adaptive publish batch", () => {
  const calm = { searchMs: 400, casePageMs: 500, slowQueries: 0, lockWaits: 0 };
  it("stays at the cap while the site answers, however slowly", () => {
    expect(nextPublishBatch(1000, calm)).toBe(5000);
    expect(nextPublishBatch(1000, { ...calm, searchMs: 12_000, casePageMs: 9000 })).toBe(5000);
    expect(nextPublishBatch(1000, { ...calm, searchMs: null, casePageMs: 400 }, 1)).toBe(5000);
  });
  it("stops only after probes have failed twice", () => {
    expect(nextPublishBatch(5000, { ...calm, searchMs: null, casePageMs: null }, 2)).toBe(0);
    expect(nextPublishBatch(5000, calm, 2)).toBe(0);
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
