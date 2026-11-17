import { describe, expect, it } from "vitest";
import { ageMinutes, emptyRunIsStale, feedIsStale, inFederalCourtHours } from "./live-feed-health";

describe("live feed court hours", () => {
  it("counts a Tuesday afternoon in New York as court hours", () => {
    expect(inFederalCourtHours(new Date("2026-11-17T15:00:00Z"))).toBe(true);
  });

  it("ignores nights and weekends", () => {
    expect(inFederalCourtHours(new Date("2026-11-17T02:00:00Z"))).toBe(false);
    expect(inFederalCourtHours(new Date("2026-11-15T15:00:00Z"))).toBe(false);
  });

  it("treats a missing item as stale only during court hours", () => {
    expect(feedIsStale(null, 90, true)).toBe(true);
    expect(feedIsStale(null, 90, false)).toBe(false);
    expect(feedIsStale(30, 90, true)).toBe(false);
    expect(feedIsStale(120, 90, true)).toBe(true);
  });

  it("treats a clean poll that parsed nothing as stale during court hours", () => {
    expect(emptyRunIsStale(true, 7, 0)).toBe(true);
    expect(emptyRunIsStale(true, 1, 6)).toBe(false);
    expect(emptyRunIsStale(false, 7, 0)).toBe(false);
    expect(emptyRunIsStale(true, 0, 0)).toBe(false);
  });

  it("rounds an age in minutes", () => {
    const now = new Date("2026-11-17T15:00:00Z");
    expect(ageMinutes(new Date("2026-11-17T14:30:00Z"), now)).toBe(30);
    expect(ageMinutes(null, now)).toBeNull();
  });
});
