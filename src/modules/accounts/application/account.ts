import type { Sql } from "postgres";
import { effectivePlan, planLimits, type PlanDefinition, type PlanId } from "../domain/plans";

export interface AccountFollow {
  casePublicId: string;
  caption: string;
  docketNumber: string;
  courtName: string | null;
  followedAt: string;
}

export interface AccountSummary {
  userId: string;
  email: string;
  plan: PlanId;
  planDefinition: PlanDefinition;
  subscriptionStatus: string;
  followCount: number;
  follows: AccountFollow[];
  alertsUnsubscribed: boolean;
  waitlistPlans: PlanId[];
}

export async function userPlan(sql: Sql, userId: string): Promise<PlanId> {
  const [subscription] = await sql<{ plan: string; status: string }[]>`
    SELECT plan::text AS plan, status FROM account_subscription WHERE user_id = ${userId}`;
  return effectivePlan(subscription);
}

export async function loadAccount(sql: Sql, userId: string): Promise<AccountSummary | null> {
  const [user] = await sql<{ email: string; alertsUnsubscribedAt: string | null; plan: string | null; status: string | null }[]>`
    SELECT u.email, u.alerts_unsubscribed_at::text AS "alertsUnsubscribedAt", s.plan::text AS plan, s.status
    FROM app_user u LEFT JOIN account_subscription s ON s.user_id = u.id
    WHERE u.id = ${userId}`;
  if (!user) return null;
  const follows = await sql<AccountFollow[]>`
    SELECT c.public_id AS "casePublicId", c.caption, c.docket_number AS "docketNumber",
      court.name AS "courtName", f.created_at::text AS "followedAt"
    FROM case_follow f
    JOIN legal_case c ON c.id = f.case_id
    LEFT JOIN court ON court.id = c.court_id
    WHERE f.user_id = ${userId}
    ORDER BY f.created_at DESC
    LIMIT 1000`;
  const waitlist = await sql<{ plan: PlanId }[]>`SELECT plan::text AS plan FROM plan_waitlist WHERE user_id = ${userId} ORDER BY plan`;
  const plan = effectivePlan(user.plan ? { plan: user.plan, status: user.status ?? "active" } : null);
  return {
    userId,
    email: user.email,
    plan,
    planDefinition: planLimits(plan),
    subscriptionStatus: user.status ?? "active",
    followCount: follows.length,
    follows,
    alertsUnsubscribed: Boolean(user.alertsUnsubscribedAt),
    waitlistPlans: waitlist.map((row) => row.plan),
  };
}
