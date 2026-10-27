// Milestone M4 (ADR 0077): config-driven entitlements for public accounts.
//
// Per Gate 7.5 (docs/18 §2) and Gate 7B (docs/16 §4-5), "prices and limits are configuration, not
// hard-coded policy" and Jurvio -- not the billing provider -- owns product access. This module is
// the single source of truth that maps an account `plan` to concrete capability limits. Changing a
// limit is a config change here, never a schema migration, and never alters case facts or rankings.
//
// The plan ladder and its headline values come straight from the approved pricing table
// (docs/18 §2): Free, Plus $29, Professional $99, Team $299.

export type AccountPlan = "free" | "plus" | "professional" | "team";

// Alert delivery frequencies, slowest to fastest. `immediate` is near-real-time and is a paid
// differentiator (docs/18 §3: "immediate or high-frequency alerts" is paid-only).
export type AlertCadence = "weekly" | "daily" | "immediate";

export interface Entitlements {
  plan: AccountPlan;
  /** Maximum number of active watches (followed cases/entities/saved searches). */
  maxWatches: number;
  /** Maximum number of stored saved searches. */
  maxSavedSearches: number;
  /** Delivery cadences this plan may choose from. Every plan includes at least a digest. */
  alertCadences: readonly AlertCadence[];
  /** Advanced / Boolean search filters (docs/16 §4). */
  advancedSearch: boolean;
  /** Report / export generation (docs/18 §3). */
  exports: boolean;
  /** Seats; >1 implies a shared Team workspace. */
  seats: number;
  /** Shared workspace (Team). */
  sharedWorkspaces: boolean;
}

// Directional defaults from docs/18 §2. These are tunable product configuration.
export const PLAN_ENTITLEMENTS: Readonly<Record<AccountPlan, Entitlements>> = {
  free: {
    plan: "free",
    maxWatches: 5,
    maxSavedSearches: 1,
    alertCadences: ["weekly"],
    advancedSearch: false,
    exports: false,
    seats: 1,
    sharedWorkspaces: false,
  },
  plus: {
    plan: "plus",
    maxWatches: 25,
    maxSavedSearches: 10,
    alertCadences: ["weekly", "daily"],
    advancedSearch: true,
    exports: false,
    seats: 1,
    sharedWorkspaces: false,
  },
  professional: {
    plan: "professional",
    maxWatches: 250,
    maxSavedSearches: 100,
    alertCadences: ["weekly", "daily", "immediate"],
    advancedSearch: true,
    exports: true,
    seats: 1,
    sharedWorkspaces: false,
  },
  team: {
    plan: "team",
    maxWatches: 1000,
    maxSavedSearches: 500,
    alertCadences: ["weekly", "daily", "immediate"],
    advancedSearch: true,
    exports: true,
    seats: 5,
    sharedWorkspaces: true,
  },
};

const PLANS: readonly AccountPlan[] = ["free", "plus", "professional", "team"];

/** True for any plan that requires a paid subscription (everything above Free). */
export function isPaidPlan(plan: AccountPlan): boolean {
  return plan !== "free";
}

/**
 * Resolve the entitlements for a plan. Falls back to Free for any unknown/missing value so a bad
 * stored plan can never accidentally grant more than the free tier (deny-by-default, docs/16 §3).
 */
export function resolveEntitlements(plan: string | null | undefined): Entitlements {
  if (plan && (PLANS as readonly string[]).includes(plan)) {
    return PLAN_ENTITLEMENTS[plan as AccountPlan];
  }
  return PLAN_ENTITLEMENTS.free;
}

/** Whether a plan may use a given delivery cadence. */
export function allowsCadence(ent: Entitlements, cadence: AlertCadence): boolean {
  return ent.alertCadences.includes(cadence);
}

/** Whether a principal currently below their watch cap may add another watch. */
export function canAddWatch(ent: Entitlements, currentWatchCount: number): boolean {
  return currentWatchCount < ent.maxWatches;
}
