// Single source of truth for customer plans: prices, follow limits and alert
// cadence (approved 2026-11-01). Product configuration, not
// authorization logic: code asks `planLimits(plan)` instead of comparing plan
// names. Changing a price here does not change anything in Stripe; the Stripe
// price ids come from env (STRIPE_PRICE_PLUS / _PRO / _TEAM).

export const PLAN_IDS = ["free", "plus", "pro", "team"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

// "instant" is an internal key only: it means the 10-minute alert tick, never
// literally instant delivery. Customer-facing copy must say "every 10 minutes".
export type AlertCadence = "daily" | "hourly" | "instant";

/**
 * "No limit". A large sentinel instead of Infinity so it survives JSON (API
 * responses). Show it with formatLimit(), never as a number.
 */
export const UNLIMITED = 1_000_000;

export function isUnlimited(limit: number): boolean {
  return limit >= UNLIMITED;
}

/** "5" or "unlimited". */
export function formatLimit(limit: number): string {
  return isUnlimited(limit) ? "unlimited" : limit.toLocaleString("en-US");
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** Monthly price in whole US dollars. */
  monthlyPriceUsd: number;
  /** Annual price in whole US dollars (null = no annual plan). Display only; Stripe is not wired for it. */
  annualPriceUsd: number | null;
  /** Supreme Court emergency docket Pro tools: response-deadline calendar, analytics and CSV export. */
  emergencyTools: boolean;
  /** Seats included. */
  seats: number;
  /** Maximum followed cases for the account (UNLIMITED = no limit). */
  followLimit: number;
  /** Maximum judge + topic + party follows combined (UNLIMITED = no limit). */
  entityFollowLimit: number;
  /** May pick "as soon as we see it" for judge/topic/party follows (otherwise daily only). */
  entityAsap: boolean;
  alertCadence: AlertCadence;
  /** Judge/topic/party follows beyond the free allowance are a selling point of this plan. */
  monitors: boolean;
  /** Offered for self-serve sign-up now. Team is "later". */
  available: boolean;
  tagline: string;
  features: readonly string[];
}

export const PLANS: Readonly<Record<PlanId, PlanDefinition>> = {
  free: {
    id: "free", name: "Free", monthlyPriceUsd: 0, annualPriceUsd: null, emergencyTools: false, seats: 1, followLimit: 5, entityFollowLimit: 1, entityAsap: true, alertCadence: "instant",
    monitors: false, available: true,
    tagline: "Follow a few cases and one judge, topic or party.",
    features: ["Follow up to 5 cases", "Follow 1 judge, topic, party or emergency-docket feed", "Daily email digest of new docket activity", "Emergency docket: follow up to 5 applications; feed emails on weekdays", "All public case pages, free forever"],
  },
  plus: {
    id: "plus", name: "Plus", monthlyPriceUsd: 19, annualPriceUsd: 190, emergencyTools: false, seats: 1, followLimit: 50, entityFollowLimit: 10, entityAsap: true, alertCadence: "hourly",
    monitors: false, available: true,
    tagline: "For journalists, researchers and close followers.",
    features: ["Follow up to 50 cases", "Follow up to 10 judges, topics, parties or emergency-docket feeds", "Hourly email alerts", "Everything in Free"],
  },
  pro: {
    id: "pro", name: "Pro", monthlyPriceUsd: 59, annualPriceUsd: 590, emergencyTools: true, seats: 1, followLimit: UNLIMITED, entityFollowLimit: UNLIMITED, entityAsap: true, alertCadence: "instant",
    monitors: true, available: true,
    tagline: "For attorneys and professionals who need it fast.",
    features: ["Unlimited case follows", "Unlimited judge, topic, party and emergency-docket alerts", "Email alerts every 10 minutes", "Emergency docket: response-deadline calendar, analytics and CSV export", "Everything in Plus"],
  },
  team: {
    id: "team", name: "Team", monthlyPriceUsd: 249, annualPriceUsd: null, emergencyTools: true, seats: 5, followLimit: UNLIMITED, entityFollowLimit: UNLIMITED, entityAsap: true, alertCadence: "instant",
    monitors: true, available: false,
    tagline: "For firms and newsrooms. Five seats.",
    features: ["5 seats", "Shared follows and alerts", "Email alerts every 10 minutes", "Everything in Pro"],
  },
};

/** Minimum time between digests for each cadence. "instant" runs on the 10-minute job tick. */
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
export function nextPlanUp(plan: PlanId, limit: "followLimit" | "entityFollowLimit" = "followLimit"): PlanDefinition | null {
  const current = PLANS[plan][limit];
  return PLAN_IDS.map((id) => PLANS[id]).find((candidate) => candidate.available && candidate[limit] > current) ?? null;
}

/** "or $190/yr" under a monthly price; null when there is no annual plan. */
export function formatAnnualPrice(plan: PlanDefinition): string | null {
  return plan.annualPriceUsd ? `$${plan.annualPriceUsd}/yr` : null;
}

export function formatMonthlyPrice(plan: PlanDefinition): string {
  return plan.monthlyPriceUsd === 0 ? "$0" : `$${plan.monthlyPriceUsd}/mo`;
}
