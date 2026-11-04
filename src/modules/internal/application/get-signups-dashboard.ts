import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

/** Addresses that are ours or test fixtures; excluded from "outside people". */
export const INTERNAL_EMAIL_PATTERNS = ["%@jurvio.com", "%example%", "%cleanyourname%"] as const;

export function isOutsideEmail(email: string): boolean {
  const e = email.toLowerCase();
  return !(e.endsWith("@jurvio.com") || e.includes("example") || e.includes("cleanyourname"));
}

export interface SignupsDashboard {
  accounts: { total: number; verified: number; outside: number; last24h: number; last7d: number; first: string | null; last: string | null };
  leadWaitlist: Array<{ source: string; plan: string | null; total: number; outside: number; converted: number; first: string | null; last: string | null }>;
  planWaitlist: Array<{ plan: string; total: number; first: string | null; last: string | null }>;
  caseFollows: { total: number; users: number; first: string | null; last: string | null };
  paidSubscriptions: Array<{ plan: string; status: string; total: number }>;
  recent: Array<{ kind: "account" | "waitlist"; email: string; source: string; plan: string | null; verified: boolean | null; createdAt: string }>;
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

export async function getSignupsDashboard(sql: Sql): Promise<SignupsDashboard> {
  const outside = sql`(email NOT LIKE '%@jurvio.com' AND email NOT LIKE '%example%' AND email NOT LIKE '%cleanyourname%')`;
  const [accounts, leads, plans, follows, paid, recent] = await Promise.all([
    sql`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS verified,
          count(*) FILTER (WHERE ${outside})::int AS outside,
          count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS last24h,
          count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS last7d,
          min(created_at) AS first, max(created_at) AS last
        FROM app_user`,
    sql`SELECT source, plan::text AS plan, count(*)::int AS total,
          count(*) FILTER (WHERE ${outside})::int AS outside,
          count(*) FILTER (WHERE converted_at IS NOT NULL)::int AS converted,
          min(created_at) AS first, max(created_at) AS last
        FROM lead_waitlist GROUP BY source, plan ORDER BY source, plan NULLS FIRST`,
    sql`SELECT plan::text AS plan, count(*)::int AS total, min(created_at) AS first, max(created_at) AS last
        FROM plan_waitlist GROUP BY plan ORDER BY plan`,
    sql`SELECT count(*)::int AS total, count(DISTINCT user_id)::int AS users, min(created_at) AS first, max(created_at) AS last FROM case_follow`,
    sql`SELECT plan::text AS plan, status, count(*)::int AS total
        FROM account_subscription WHERE plan <> 'free' GROUP BY plan, status ORDER BY plan, status`,
    sql`SELECT * FROM (
          SELECT 'account' AS kind, u.email, 'account' AS source, s.plan::text AS plan,
                 (u.email_verified_at IS NOT NULL) AS verified, u.created_at
          FROM app_user u LEFT JOIN account_subscription s ON s.user_id = u.id
          UNION ALL
          SELECT 'waitlist', email, source, plan::text, NULL, created_at FROM lead_waitlist
        ) r ORDER BY created_at DESC LIMIT 50`,
  ]);
  const a = accounts[0]!;
  return {
    accounts: { total: a.total, verified: a.verified, outside: a.outside, last24h: a.last24h, last7d: a.last7d, first: iso(a.first), last: iso(a.last) },
    leadWaitlist: leads.map((r) => ({ source: r.source, plan: r.plan, total: r.total, outside: r.outside, converted: r.converted, first: iso(r.first), last: iso(r.last) })),
    planWaitlist: plans.map((r) => ({ plan: r.plan, total: r.total, first: iso(r.first), last: iso(r.last) })),
    caseFollows: { total: follows[0]!.total, users: follows[0]!.users, first: iso(follows[0]!.first), last: iso(follows[0]!.last) },
    paidSubscriptions: paid.map((r) => ({ plan: r.plan, status: r.status, total: r.total })),
    recent: recent.map((r) => ({ kind: r.kind, email: r.email, source: r.source, plan: r.plan, verified: r.verified, createdAt: iso(r.created_at)! })),
  };
}
