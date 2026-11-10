import { describe, expect, it } from "vitest";
import { calendarDateInZone, formatCalendarDate, formatEasternClock, utcCalendarDate } from "./calendar-date";

describe("calendar dates around the UTC midnight boundary", () => {
  // 11:48 PM ET on Nov 9, 2026 is 04:48 UTC on Nov 10, and 8:48 PM in California.
  const evening = "2026-11-10T04:48:00.000Z";

  it("keeps a date-only value on the recorded day", () => {
    expect(formatCalendarDate("2026-11-10")).toBe("Nov. 10, 2026");
    expect(formatCalendarDate("2026-11-10", "America/Los_Angeles")).toBe("Nov. 10, 2026");
    expect(formatCalendarDate("2026-11-09", "UTC")).toBe("Nov. 9, 2026");
    expect(formatCalendarDate("2025-11-24")).toBe("Nov. 24, 2025");
  });

  it("converts a timestamp in the court's zone instead of UTC", () => {
    expect(utcCalendarDate(evening)).toBe("2026-11-10");
    expect(calendarDateInZone(evening, "America/Los_Angeles")).toBe("2026-11-09");
    expect(calendarDateInZone(evening, "America/New_York")).toBe("2026-11-09");
    expect(formatCalendarDate(evening, "America/Los_Angeles")).toBe("Nov. 9, 2026");
    expect(formatCalendarDate(evening, "America/New_York")).toBe("Nov. 9, 2026");
  });

  it("treats exact UTC midnight as the previous day in Eastern and Pacific time", () => {
    const midnight = "2026-11-10T00:00:00.000Z";
    expect(utcCalendarDate(midnight)).toBe("2026-11-10");
    expect(calendarDateInZone(midnight, "America/New_York")).toBe("2026-11-09");
    expect(calendarDateInZone(midnight, "America/Los_Angeles")).toBe("2026-11-09");
    expect(formatCalendarDate(midnight, "America/New_York")).toBe("Nov. 9, 2026");
    // 05:00 UTC is midnight Eastern on Nov 10, still Nov 9 in California.
    expect(calendarDateInZone("2026-11-10T05:00:00.000Z", "America/New_York")).toBe("2026-11-10");
    expect(calendarDateInZone("2026-11-10T05:00:00.000Z", "America/Los_Angeles")).toBe("2026-11-09");
  });

  it("does not invent a date for an empty or unusable value", () => {
    expect(formatCalendarDate(null)).toBeNull();
    expect(formatCalendarDate("not-a-date")).toBeNull();
    expect(calendarDateInZone("2026-11-10", "America/New_York")).toBeNull();
  });

  it("labels a clock time ET", () => {
    expect(formatEasternClock(evening)).toBe("11:48 PM ET");
    expect(formatEasternClock("2026-11-10T05:30:00.000Z")).toBe("12:30 AM ET");
  });
});
