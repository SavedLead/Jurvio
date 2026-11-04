import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export { isOutsideEmail } from "./outside";

export const PLANS = ["free", "plus", "pro", "team"] as const;
export const SOURCES = ["google", "bing", "x", "direct", "other"] as const;

export interface GrowthDashboard {
  accounts: { total: number; verified: number; outside: number; last24h: number; last7d: number; first: string | null; last: string | null };
  visitors: { today: number; d7: number; d30: number; bySource: Array<{ source: string; today: number; d7: number; d30: number }> };
  topLandingPages: Array<{ path: string; visitors: number }>;
  funnel: { visitors: number; signinRequests: number; verifiedAccounts: number; accountsWithFollow: number; waitlistEntries: number };
  plans: Array<{ plan: string; total: number; paying: number }>;
  leadWaitlist: Array<{ source: string; plan: string | null; total: number; outside: number; converted: number }>;
  planWaitlist: Array<{ plan: string; total: number }>;
  caseFollows: { total: number; users: number };
  trend: Array<{ day: string; visitors: number; signinRequests: number; accounts: number; waitlist: number }>;
  recent: Array<{
    kind: "account" | "waitlist"; email: string; plan: string | null; source: string | null; signupVia: string;
    landingPath: string | null; firstCasePublicId: string | null; firstCaseCaption: string | null; createdAt: string; lastSeenAt: string | null;
  }>;
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

/** All windows are Eastern days ("today" starts at midnight ET). Every query is index-backed on created/occurred time. */
export async function getGrowthDashboard(sql: Sql): Promise<GrowthDashboard> {
  const outside = sql`(email NOT LIKE '%@jurvio.com' AND email NOT LIKE '%example%' AND email NOT LIKE '%cleanyourname%')`;
  const today = sql`(date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York')`;
  const since30 = sql`(now() - interval '30 days')`;
  const [accounts, visitors, landing, funnel, plans, leads, planWait, follows, trend, recent] = await Promise.all([
    sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS verified,
          count(*) FILTER (WHERE ${outside})::int AS outside,
          count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS last24h,
          count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS last7d,
          min(created_at) AS first, max(created_at) AS last FROM app_user`,
    sql`SELECT source, count(*) FILTER (WHERE occurred_at >= ${today})::int AS today,
          count(*) FILTER (WHERE occurred_at >= now() - interval '7 days')::int AS d7, count(*)::int AS d30
        FROM visitor_first_touch WHERE occurred_at >= ${since30} GROUP BY source`,
    sql`SELECT landing_path AS path, count(*)::int AS visitors FROM visitor_first_touch
        WHERE occurred_at >= ${since30} GROUP BY landing_path ORDER BY 2 DESC, 1 LIMIT 10`,
    sql`SELECT
          (SELECT count(*)::int FROM visitor_first_touch WHERE occurred_at >= ${since30}) AS visitors,
          (SELECT count(*)::int FROM signin_request_event WHERE occurred_at >= ${since30}) AS "signinRequests",
          (SELECT count(*)::int FROM app_user WHERE created_at >= ${since30} AND email_verified_at IS NOT NULL) AS "verifiedAccounts",
          (SELECT count(*)::int FROM app_user u WHERE u.created_at >= ${since30} AND EXISTS (SELECT 1 FROM case_follow f WHERE f.user_id = u.id)) AS "accountsWithFollow",
          (SELECT count(*)::int FROM lead_waitlist WHERE created_at >= ${since30}) AS "waitlistEntries"`,
    sql`SELECT coalesce(s.plan::text, 'free') AS plan, count(*)::int AS total,
          count(*) FILTER (WHERE s.plan <> 'free' AND s.status IN ('active', 'trialing', 'past_due'))::int AS paying
        FROM app_user u LEFT JOIN account_subscription s ON s.user_id = u.id GROUP BY 1`,
    sql`SELECT source, plan::text AS plan, count(*)::int AS total, count(*) FILTER (WHERE ${outside})::int AS outside,
          count(*) FILTER (WHERE converted_at IS NOT NULL)::int AS converted
        FROM lead_waitlist GROUP BY source, plan ORDER BY source, plan NULLS FIRST`,
    sql`SELECT plan::text AS plan, count(*)::int AS total FROM plan_waitlist GROUP BY plan ORDER BY plan`,
    sql`SELECT count(*)::int AS total, count(DISTINCT user_id)::int AS users FROM case_follow`,
    sql`WITH days AS (
          SELECT generate_series((now() AT TIME ZONE 'America/New_York')::date - 29, (now() AT TIME ZONE 'America/New_York')::date, interval '1 day')::date AS day),
        ev AS (
          SELECT 'v' AS k, occurred_at AS at FROM visitor_first_touch WHERE occurred_at >= now() - interval '31 days'
          UNION ALL SELECT 's', occurred_at FROM signin_request_event WHERE occurred_at >= now() - interval '31 days'
          UNION ALL SELECT 'a', created_at FROM app_user WHERE created_at >= now() - interval '31 days'
          UNION ALL SELECT 'w', created_at FROM lead_waitlist WHERE created_at >= now() - interval '31 days'),
        c AS (SELECT (at AT TIME ZONE 'America/New_York')::date AS day, k, count(*)::int AS n FROM ev GROUP BY 1, 2)
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
          coalesce(sum(n) FILTER (WHERE k = 'v'), 0)::int AS visitors, coalesce(sum(n) FILTER (WHERE k = 's'), 0)::int AS "signinRequests",
          coalesce(sum(n) FILTER (WHERE k = 'a'), 0)::int AS accounts, coalesce(sum(n) FILTER (WHERE k = 'w'), 0)::int AS waitlist
        FROM days d LEFT JOIN c ON c.day = d.day GROUP BY d.day ORDER BY d.day`,
    sql`SELECT * FROM (
          SELECT 'account' AS kind, u.email, coalesce(s.plan::text, 'free') AS plan, a.source, 'sign-in' AS "signupVia",
            a.landing_path AS "landingPath", fc.public_id AS "firstCasePublicId", fc.caption AS "firstCaseCaption",
            u.created_at AS "createdAt", u.last_signed_in_at AS "lastSeenAt"
          FROM app_user u
          LEFT JOIN account_subscription s ON s.user_id = u.id
          LEFT JOIN signup_attribution a ON a.user_id = u.id
          LEFT JOIN LATERAL (SELECT c.public_id, c.caption FROM case_follow f JOIN legal_case c ON c.id = f.case_id
                             WHERE f.user_id = u.id ORDER BY f.created_at LIMIT 1) fc ON true
          UNION ALL
          SELECT 'waitlist', l.email, l.plan::text, l.attribution->>'source', 'waitlist: ' || l.source,
            l.attribution->>'landingPath', l.case_public_id, c.caption, l.created_at, l.last_seen_at
          FROM lead_waitlist l LEFT JOIN legal_case c ON c.public_id = l.case_public_id
        ) r ORDER BY "createdAt" DESC LIMIT 50`,
  ]);
  const a = accounts[0]!;
  const bySource = SOURCES.map((source) => {
    const row = visitors.find((v) => v.source === source);
    return { source, today: row?.today ?? 0, d7: row?.d7 ?? 0, d30: row?.d30 ?? 0 };
  });
  const other = bySource[4]!;
  for (const v of visitors) {
    if ((SOURCES as readonly string[]).includes(v.source)) continue;
    other.today += v.today; other.d7 += v.d7; other.d30 += v.d30;
  }
  const sum = (k: "today" | "d7" | "d30") => bySource.reduce((s, r) => s + r[k], 0);
  return {
    accounts: { total: a.total, verified: a.verified, outside: a.outside, last24h: a.last24h, last7d: a.last7d, first: iso(a.first), last: iso(a.last) },
    visitors: { today: sum("today"), d7: sum("d7"), d30: sum("d30"), bySource },
    topLandingPages: landing.map((r) => ({ path: r.path, visitors: r.visitors })),
    funnel: funnel[0] as unknown as GrowthDashboard["funnel"],
    plans: PLANS.map((plan) => { const r = plans.find((p) => p.plan === plan); return { plan, total: r?.total ?? 0, paying: r?.paying ?? 0 }; }),
    leadWaitlist: leads.map((r) => ({ source: r.source, plan: r.plan, total: r.total, outside: r.outside, converted: r.converted })),
    planWaitlist: planWait.map((r) => ({ plan: r.plan, total: r.total })),
    caseFollows: { total: follows[0]!.total, users: follows[0]!.users },
    trend: trend.map((r) => ({ day: r.day, visitors: r.visitors, signinRequests: r.signinRequests, accounts: r.accounts, waitlist: r.waitlist })),
    recent: recent.map((r) => ({ ...(r as unknown as GrowthDashboard["recent"][number]), createdAt: iso(r.createdAt)!, lastSeenAt: iso(r.lastSeenAt) })),
  };
}
