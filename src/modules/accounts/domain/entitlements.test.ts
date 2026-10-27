import { describe, expect, it } from "vitest";
import {
  allowsCadence,
  canAddWatch,
  isPaidPlan,
  PLAN_ENTITLEMENTS,
  resolveEntitlements,
} from "./entitlements";

describe("resolveEntitlements", () => {
  it("returns the matching plan's entitlements", () => {
    expect(resolveEntitlements("professional")).toBe(PLAN_ENTITLEMENTS.professional);
  });

  it("falls back to free for unknown, null, or empty plans (deny-by-default)", () => {
    expect(resolveEntitlements("enterprise-unlaunched")).toBe(PLAN_ENTITLEMENTS.free);
    expect(resolveEntitlements(null)).toBe(PLAN_ENTITLEMENTS.free);
    expect(resolveEntitlements(undefined)).toBe(PLAN_ENTITLEMENTS.free);
    expect(resolveEntitlements("")).toBe(PLAN_ENTITLEMENTS.free);
  });
});

describe("plan ladder invariants", () => {
  it("never grants fewer watches as the plan tier rises", () => {
    const { free, plus, professional, team } = PLAN_ENTITLEMENTS;
    expect(free.maxWatches).toBeLessThan(plus.maxWatches);
    expect(plus.maxWatches).toBeLessThan(professional.maxWatches);
    expect(professional.maxWatches).toBeLessThanOrEqual(team.maxWatches);
  });

  it("reserves immediate alerts for professional and team (paid real-time)", () => {
    expect(allowsCadence(PLAN_ENTITLEMENTS.free, "immediate")).toBe(false);
    expect(allowsCadence(PLAN_ENTITLEMENTS.plus, "immediate")).toBe(false);
    expect(allowsCadence(PLAN_ENTITLEMENTS.professional, "immediate")).toBe(true);
    expect(allowsCadence(PLAN_ENTITLEMENTS.team, "immediate")).toBe(true);
  });

  it("gives every plan at least the weekly digest", () => {
    for (const ent of Object.values(PLAN_ENTITLEMENTS)) {
      expect(ent.alertCadences).toContain("weekly");
    }
  });

  it("only the team plan has shared workspaces and multiple seats", () => {
    expect(PLAN_ENTITLEMENTS.team.seats).toBeGreaterThan(1);
    expect(PLAN_ENTITLEMENTS.team.sharedWorkspaces).toBe(true);
    for (const plan of ["free", "plus", "professional"] as const) {
      expect(PLAN_ENTITLEMENTS[plan].seats).toBe(1);
      expect(PLAN_ENTITLEMENTS[plan].sharedWorkspaces).toBe(false);
    }
  });
});

describe("isPaidPlan", () => {
  it("is false only for free", () => {
    expect(isPaidPlan("free")).toBe(false);
    expect(isPaidPlan("plus")).toBe(true);
    expect(isPaidPlan("professional")).toBe(true);
    expect(isPaidPlan("team")).toBe(true);
  });
});

describe("canAddWatch", () => {
  it("blocks adding a watch once the cap is reached", () => {
    const free = PLAN_ENTITLEMENTS.free;
    expect(canAddWatch(free, free.maxWatches - 1)).toBe(true);
    expect(canAddWatch(free, free.maxWatches)).toBe(false);
    expect(canAddWatch(free, free.maxWatches + 1)).toBe(false);
  });
});
