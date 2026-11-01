import type { Sql } from "postgres";

/**
 * Subscriber-only case records (David, 2026-11-01): cases in the
 * search-exclusion set (sealed-style captions such as "In re: Sealed Case",
 * or a case with any court-restricted docket event) are court-released public
 * records, but they are shown only to signed-in customers on an active paid
 * plan. Everyone else (anonymous visitors, Free accounts, crawlers) gets a
 * generic "Available to subscribers" gate and never sees the case in listings,
 * sitemaps, citations or news. Docket entries the court marked sealed or
 * restricted stay hidden from everyone, subscribers included.
 */
export const SUBSCRIBER_PLANS = ["plus", "pro", "team"] as const;
/** Stricter than plan entitlement: a past-due or canceled plan does not open restricted records. */
const SUBSCRIBER_STATUSES = new Set(["active", "trialing"]);

export function hasSubscriberAccess(subscription: { plan: string; status: string } | null | undefined): boolean {
  if (!subscription) return false;
  return (SUBSCRIBER_PLANS as readonly string[]).includes(subscription.plan) && SUBSCRIBER_STATUSES.has(subscription.status);
}

export async function userHasSubscriberAccess(sql: Sql, userId: string): Promise<boolean> {
  const [subscription] = await sql<{ plan: string; status: string }[]>`
    SELECT plan::text AS plan, status FROM account_subscription WHERE user_id = ${userId}`;
  return hasSubscriberAccess(subscription);
}
