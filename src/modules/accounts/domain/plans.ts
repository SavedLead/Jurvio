// Single source of truth for customer plans: prices, follow limits and alert
// cadence (David Rosenberg, 2026-11-01). Product configuration, not
// authorization logic: code asks `planLimits(plan)` instead of comparing plan
// names. Changing a price here does not change anything in Stripe; the Stripe
// price ids come from env (STRIPE_PRICE_PLUS / _PRO / _TEAM).

export const PLAN_IDS = ["free", "plus", "pro", "team"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type AlertCadence = "daily" | "hourly" | "instant";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** Monthly price in whole US dollars. */
  monthlyPriceUsd: number;
  /** Seats included. */
  seats: number;
  /** Maximum followed cases for the account. */
  followLimit: number;
  alertCadence: AlertCadence;
  /** Entity/topic monitors (Pro and above; not built in Phase 1). */
  monitors: boolean;
  /** Offered for self-serve sign-up now. Team is "later". */
  available: boolean;
  tagline: string;
  features: readonly string[];
}

export const PLANS: Readonly<Record<PlanId, PlanDefinition>> = {
  free: {
    id: "free", name: "Free", monthlyPriceUsd: 0, seats: 1, followLimit: 3, alertCadence: "daily",
    monitors: false, available: true,
    tagline: "Follow a few cases and get a daily digest.",
    features: ["Follow up to 3 cases", "Daily email digest of new docket activity", "All public case pages, free forever"],
  },
  plus: {
    id: "plus", name: "Plus", monthlyPriceUsd: 19, seats: 1, followLimit: 50, alertCadence: "hourly",
    monitors: false, available: true,
    tagline: "For journalists, researchers and close followers.",
    features: ["Follow up to 50 cases", "Hourly email alerts", "Everything in Free"],
  },
  pro: {
    id: "pro", name: "Pro", monthlyPriceUsd: 59, seats: 1, followLimit: 500, alertCadence: "instant",
    monitors: true, available: true,
    tagline: "For attorneys and professionals who need it fast.",
    features: ["Follow up to 500 cases", "Instant alerts", "Monitors for parties, firms and topics (coming soon)", "Everything in Plus"],
  },
  team: {
    // Follow limit for Team is provisional (5 seats x Pro's 500) until Team ships.
    id: "team", name: "Team", monthlyPriceUsd: 199, seats: 5, followLimit: 2500, alertCadence: "instant",
    monitors: true, available: false,
    tagline: "For firms and newsrooms. Five seats.",
    features: ["5 seats", "Shared follows and monitors", "Instant alerts", "Everything in Pro"],
  },
};

/** Minimum time between digests for each cadence. Instant runs on the 10-minute job tick. */
export const CADENCE_INTERVAL_MS: Readonly<Record<AlertCadence, number>> = {
  daily: 24 * 60 * 60_000,
  hourly: 60 * 60_000,
  instant: 10 * 60_000,
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/** Paid-plan statuses that still grant the plan. Anything else falls back to Free. */
const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

/** The plan a user is entitled to right now, from their subscription row (or none). */
export function effectivePlan(subscription: { plan: string; status: string } | null | undefined): PlanId {
  if (!subscription || !isPlanId(subscription.plan)) return "free";
  if (subscription.plan === "free") return "free";
  return ENTITLED_STATUSES.has(subscription.status) ? subscription.plan : "free";
}

export function planLimits(plan: PlanId): PlanDefinition {
  return PLANS[plan];
}

/** The cheapest available plan that allows more follows than `plan`, for upgrade prompts. */
export function nextPlanUp(plan: PlanId): PlanDefinition | null {
  const current = PLANS[plan].followLimit;
  return PLAN_IDS.map((id) => PLANS[id]).find((candidate) => candidate.available && candidate.followLimit > current) ?? null;
}

export function formatMonthlyPrice(plan: PlanDefinition): string {
  return plan.monthlyPriceUsd === 0 ? "$0" : `$${plan.monthlyPriceUsd}/mo`;
}
