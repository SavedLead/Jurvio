import { describe, expect, it } from "vitest";
import {
  EASTERN_TIME_ZONE,
  easternTimeZoneAbbrev,
  formatEasternDate,
  formatEasternDateTime,
  formatEasternTime,
} from "./eastern";

describe("eastern time helpers", () => {
  it("uses the America/New_York zone", () => {
    expect(EASTERN_TIME_ZONE).toBe("America/New_York");
  });

  it("shows a summer instant in Eastern time labeled ET", () => {
    // 2026-08-10 03:28:55 UTC = 2026-08-09 23:28 EDT (UTC-4)
    const out = formatEasternDateTime("2026-08-10T03:28:55Z");
    expect(out).toContain("ET");
    expect(out).not.toMatch(/\bE[DS]T\b/);
    expect(out).toContain("Aug 9, 2026");
    expect(out).toContain("11:28");
  });

  it("shows a winter instant in Eastern time labeled ET", () => {
    // 2026-01-15 12:00 UTC = 07:00 EST (UTC-5)
    const out = formatEasternDateTime("2026-01-15T12:00:00Z");
    expect(out).toContain("ET");
    expect(out).not.toMatch(/\bE[DS]T\b/);
    expect(out).toContain("Jan 15, 2026");
    expect(out).toContain("7:00");
  });

  it("formats time only in Eastern time labeled ET", () => {
    expect(formatEasternTime("2026-08-10T03:28:55Z")).toBe("11:28 PM ET");
    expect(formatEasternTime("2026-01-15T12:00:00Z")).toBe("7:00 AM ET");
  });

  it("renders the Eastern calendar day for an instant", () => {
    // 03:00 UTC on Aug 10 is 11 PM EDT on Aug 9 (UTC-4), so the Eastern day is Aug 9.
    expect(formatEasternDate("2026-08-10T03:00:00Z")).toBe("Aug 9, 2026");
    // 04:00 UTC on Aug 10 is exactly midnight EDT on Aug 10.
    expect(formatEasternDate("2026-08-10T04:00:00Z")).toBe("Aug 10, 2026");
  });

  it("reports the correct zone abbreviation for a given instant", () => {
    expect(easternTimeZoneAbbrev("2026-08-10T03:28:55Z")).toBe("EDT");
    expect(easternTimeZoneAbbrev("2026-01-15T12:00:00Z")).toBe("EST");
  });

  it("returns the fallback for null/invalid input", () => {
    expect(formatEasternDateTime(null)).toBe("Not available");
    expect(formatEasternDateTime(undefined, "—")).toBe("—");
    expect(formatEasternDate("not-a-date", "n/a")).toBe("n/a");
    expect(formatEasternTime(null, "n/a")).toBe("n/a");
  });
});
