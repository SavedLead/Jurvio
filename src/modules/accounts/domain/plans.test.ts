import { describe, expect, it } from "vitest";
import { CADENCE_INTERVAL_MS, PLANS, UNLIMITED, effectivePlan, formatLimit, formatMonthlyPrice, nextPlanUp } from "./plans";

describe("plans config", () => {
  it("has the decided prices, follow limits and cadences", () => {
    expect([PLANS.free, PLANS.plus, PLANS.pro, PLANS.team].map((plan) => [plan.monthlyPriceUsd, plan.followLimit, plan.alertCadence]))
      .toEqual([[0, 5, "daily"], [19, 50, "hourly"], [59, UNLIMITED, "instant"], [199, UNLIMITED, "instant"]]);
    expect([PLANS.free, PLANS.plus, PLANS.pro, PLANS.team].map((plan) => plan.entityFollowLimit)).toEqual([1, 10, UNLIMITED, UNLIMITED]);
    expect(formatLimit(PLANS.pro.followLimit)).toBe("unlimited");
    expect(formatLimit(PLANS.free.followLimit)).toBe("5");
    expect(PLANS.team.seats).toBe(5);
    expect(PLANS.team.available).toBe(false);
    expect(PLANS.pro.monitors).toBe(true);
    expect(formatMonthlyPrice(PLANS.plus)).toBe("$19/mo");
    expect(CADENCE_INTERVAL_MS.instant).toBe(600_000);
  });

  it("falls back to free unless a paid subscription is entitled", () => {
    expect(effectivePlan(null)).toBe("free");
    expect(effectivePlan({ plan: "pro", status: "active" })).toBe("pro");
    expect(effectivePlan({ plan: "plus", status: "past_due" })).toBe("plus");
    expect(effectivePlan({ plan: "pro", status: "canceled" })).toBe("free");
    expect(effectivePlan({ plan: "bogus", status: "active" })).toBe("free");
  });

  it("suggests the next available plan up", () => {
    expect(nextPlanUp("free")?.id).toBe("plus");
    expect(nextPlanUp("plus")?.id).toBe("pro");
    expect(nextPlanUp("pro")).toBeNull();
    expect(nextPlanUp("free", "entityFollowLimit")?.id).toBe("plus");
    expect(nextPlanUp("plus", "entityFollowLimit")?.id).toBe("pro");
  });
});
