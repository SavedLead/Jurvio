import { describe, expect, it } from "vitest";
import { courtListenerCallsForFollow, signalHasNewFiling } from "./follow-refresh";

describe("first-follow refresh", () => {
  it("spends no CourtListener call when the free feed already has the new line", () => {
    expect(courtListenerCallsForFollow({ freeFilled: true, changed: true, quotaRemaining: 80 })).toBe(0);
  });

  it("spends one call when the docket signal is unchanged and two when the line is missing", () => {
    expect(courtListenerCallsForFollow({ freeFilled: false, changed: false, quotaRemaining: 80 })).toBe(1);
    expect(courtListenerCallsForFollow({ freeFilled: false, changed: true, quotaRemaining: 80 })).toBe(2);
    expect(courtListenerCallsForFollow({ freeFilled: false, changed: true, quotaRemaining: 1 })).toBe(1);
    expect(courtListenerCallsForFollow({ freeFilled: false, changed: true, quotaRemaining: 0 })).toBe(0);
  });

  it("treats a newer date_modified or filing date as a change", () => {
    expect(signalHasNewFiling({
      dateModified: "2026-11-17T12:00:00Z",
      dateLastFiling: "2026-11-17",
      storedModified: "2026-11-16T12:00:00Z",
      storedLastFiling: "2026-11-16",
    })).toBe(true);
    expect(signalHasNewFiling({
      dateModified: "2026-11-16T12:00:00Z",
      dateLastFiling: "2026-11-16",
      storedModified: "2026-11-16T12:00:00Z",
      storedLastFiling: "2026-11-16",
    })).toBe(false);
  });
});
