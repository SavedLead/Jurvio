import { describe, expect, it } from "vitest";
import { CourtFetchHttpError, httpStatusOf, isZeroVsBaseline } from "./court-fetch-log";
import { sourceHealth } from "./court-source-matrix";
import { catalogRows, CIRCUIT_CODES } from "../domain/court-sources";

describe("court fetch health", () => {
  it("keeps the HTTP status of failed fetches", () => {
    expect(httpStatusOf(new CourtFetchHttpError("https://x.test", 404))).toBe(404);
    expect(httpStatusOf(new Error("coa_feed:ca6: https://x returned HTTP 503"))).toBe(503);
    expect(httpStatusOf(new Error("ECONNRESET"))).toBeNull();
  });

  it("flags zero items only against a baseline of 5 or more", () => {
    expect(isZeroVsBaseline(true, 0, 12)).toBe(true);
    expect(isZeroVsBaseline(true, 0, 4.9)).toBe(false);
    expect(isZeroVsBaseline(true, 3, 12)).toBe(false);
    expect(isZeroVsBaseline(false, 0, 12)).toBe(false);
    expect(isZeroVsBaseline(true, 0, null)).toBe(false);
  });

  it("gives each matrix cell one health word", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    const base = { enabled: true, lastSuccessAt: "2026-11-01T11:00:00Z", lastAttemptAt: "2026-11-01T11:00:00Z", consecutiveFailures: 0, zeroVsBaseline: false };
    expect(sourceHealth(base, now)).toBe("ok");
    expect(sourceHealth({ ...base, enabled: false }, now)).toBe("off");
    expect(sourceHealth({ ...base, lastAttemptAt: null }, now)).toBe("never");
    expect(sourceHealth({ ...base, consecutiveFailures: 3 }, now)).toBe("failing");
    expect(sourceHealth({ ...base, zeroVsBaseline: true }, now)).toBe("zero_vs_baseline");
    expect(sourceHealth({ ...base, lastSuccessAt: "2026-10-30T00:00:00Z" }, now)).toBe("stale");
  });

  it("lists every circuit and a PACER-login row for every district", () => {
    const rows = catalogRows(["nyed", "akd"]);
    for (const court of CIRCUIT_CODES) {
      expect(rows.some((row) => row.courtCode === court && row.source === "appellate_official")).toBe(true);
    }
    const pacer = rows.filter((row) => row.source === "pacer_free_opinions");
    expect(pacer.map((row) => row.courtCode)).toEqual(["nyed", "akd"]);
    expect(pacer.every((row) => !row.enabled)).toBe(true);
    const govinfo = rows.filter((row) => row.source === "govinfo" && row.enabled);
    expect(govinfo.map((row) => row.courtCode).sort()).toEqual([...CIRCUIT_CODES, "nyed", "akd"].sort());
    const appellateRss = rows.filter((row) => row.source === "appellate_pacer_rss");
    expect(appellateRss).toHaveLength(13);
    expect(appellateRss.filter((row) => row.enabled).map((row) => row.courtCode).sort())
      .toEqual(["ca10", "ca11", "ca2", "ca4", "ca6", "cadc", "cafc"]);
    expect(catalogRows(["ded", "akd"]).filter((row) => row.source === "court_site").map((row) => row.courtCode)).toEqual(["ded"]);
  });
});
