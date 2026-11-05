import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { requestSignIn, verifySignIn } from "@/modules/accounts/application/sign-in";
import { captureLead } from "@/modules/accounts/application/waitlist";
import { attributionFromCookies, classifySource, isTrackablePublicPath, parseFirstTouch } from "@/modules/growth/attribution";
import { getGrowthDashboard, isOutsideEmail } from "@/modules/growth/get-growth-dashboard";

const ftCookie = (o: Record<string, unknown>) => `jv_ft=${encodeURIComponent(JSON.stringify(o))}`;

describe("growth attribution", () => {
  it("buckets referrers and utm tags into Google, Bing, X, direct and other", () => {
    expect(classifySource("google.com", null)).toBe("google");
    expect(classifySource("news.google.co.uk", null)).toBe("google");
    expect(classifySource("bing.com", null)).toBe("bing");
    expect(classifySource("t.co", null)).toBe("x");
    expect(classifySource("x.com", null)).toBe("x");
    expect(classifySource(null, null)).toBe("direct");
    expect(classifySource("jurvio.com", null)).toBe("direct");
    expect(classifySource(null, "twitter")).toBe("x");
    expect(classifySource("reddit.com", null)).toBe("other");
  });
  it("parses the first-touch cookie and the sign-in start page", () => {
    const cookie = `${ftCookie({ r: "www.google.com", l: "/case/jv-abc12345?x=1", us: "g", t: 1_700_000_000_000 })}; jv_lp=%2Fpricing`;
    expect(attributionFromCookies(cookie)).toMatchObject({ source: "google", referrerHost: "google.com", landingPath: "/case/jv-abc12345", signinFromPath: "/pricing" });
    expect(parseFirstTouch("not json")).toBeNull();
    expect(attributionFromCookies(null)).toBeNull();
  });
  it("never captures on auth, account, internal or API routes", () => {
    for (const p of ["/signin", "/signin/verify", "/account", "/api/auth/request", "/internal/signups", "/login"]) expect(isTrackablePublicPath(p)).toBe(false);
    for (const p of ["/", "/case/jv-abc12345", "/pricing", "/supreme-court/emergency"]) expect(isTrackablePublicPath(p)).toBe(true);
  });
  it("excludes internal and test addresses from outside people", () => {
    expect(isOutsideEmail("a@jurvio.com")).toBe(false);
    expect(isOutsideEmail("x@example.org")).toBe(false);
    expect(isOutsideEmail("t+cleanyourname@gmail.com")).toBe(false);
    expect(isOutsideEmail("person@gmail.com")).toBe(true);
  });
  it("is linked from the internal nav and home, guarded by internal auth, and mounted on public pages", () => {
    expect(readFileSync("src/app/internal/layout.tsx", "utf8")).toContain('href: "/internal/signups"');
    expect(readFileSync("src/app/internal/page.tsx", "utf8")).toContain('href: "/internal/signups"');
    const page = readFileSync("src/app/internal/signups/page.tsx", "utf8");
    expect(page).toContain("requireInternalPrincipal");
    expect(page).toContain("index: false");
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain("<FirstTouch />");
    expect(readFileSync("src/app/api/visit/route.ts", "utf8")).toContain('visitorClass !== "human"');
  });
});

const databaseUrl = process.env.DATABASE_URL;
const hasPsql = spawnSync("psql", ["--version"]).status === 0;

describe.skipIf(!databaseUrl || !hasPsql)("growth dashboard against Postgres", () => {
  it("saves attribution at sign-up and reports visitors, funnel, plans, trend and recent entries", { timeout: 240_000 }, async () => {
    const admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const name = `growth_it_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
      await sql`INSERT INTO visitor_first_touch (source, referrer_host, landing_path) VALUES
        ('google', 'google.com', '/pricing'), ('google', 'google.com', '/pricing'), ('direct', NULL, '/'), ('x', 't.co', '/case/jv-x'),
        ('bing', 'bing.com', '/old')`;
      await sql`UPDATE visitor_first_touch SET occurred_at = now() - interval '10 days' WHERE landing_path = '/old'`;
      await sql`INSERT INTO signin_request_event (outcome, source, signin_from_path) VALUES ('logged', 'google', '/pricing')`;

      const attribution = attributionFromCookies(`${ftCookie({ r: "google.com", l: "/pricing", t: Date.now() })}; jv_lp=%2Fpricing`);
      let link = "";
      const status = await requestSignIn(sql, { email: "person@gmail.com", ip: "1.2.3.4", attribution },
        { provider: null, siteUrl: "http://localhost", production: false, log: (line) => { link = line; } });
      expect(status).toBe("logged");
      const token = new URL(link.slice(link.indexOf("http"))).searchParams.get("token");
      const verified = await verifySignIn(sql, token);
      expect(verified).not.toBeNull();
      const [saved] = await sql`SELECT source, landing_path, signin_from_path FROM signup_attribution WHERE user_id = ${verified!.userId}`;
      expect(saved).toEqual({ source: "google", landing_path: "/pricing", signin_from_path: "/pricing" });

      await sql`INSERT INTO app_user (email, created_at) VALUES ('qa@jurvio.com', now() - interval '3 days')`;
      await sql`UPDATE account_subscription SET plan = 'pro' WHERE user_id = ${verified!.userId}`;
      expect(await captureLead(sql, { email: "lead@gmail.com", ip: "5.6.7.8", source: "plan", plan: "plus", attribution: { source: "x", landingPath: "/case/jv-x" } })).toBe("joined");

      const d = await getGrowthDashboard(sql);
      expect(d.visitors).toMatchObject({ today: 4, d7: 4, d30: 5 });
      expect(d.visitors.bySource.find((r) => r.source === "google")).toMatchObject({ today: 2, d30: 2 });
      expect(d.topLandingPages[0]).toEqual({ path: "/pricing", visitors: 2 });
      expect(d.funnel).toEqual({ visitors: 5, signinRequests: 1, verifiedAccounts: 1, accountsWithFollow: 0, waitlistEntries: 1 });
      expect(d.plans).toEqual([{ plan: "free", total: 1, paying: 0 }, { plan: "plus", total: 0, paying: 0 }, { plan: "pro", total: 1, paying: 1 }, { plan: "team", total: 0, paying: 0 }]);
      expect(d.accounts).toMatchObject({ total: 2, verified: 1, outside: 1, last24h: 1, last7d: 2 });
      expect(d.trend).toHaveLength(30);
      expect(d.trend.at(-1)).toMatchObject({ visitors: 4, signinRequests: 1, accounts: 1, waitlist: 1 });
      expect(d.recent.map((r) => [r.email, r.source, r.landingPath])).toEqual([
        ["lead@gmail.com", "x", "/case/jv-x"], ["person@gmail.com", "google", "/pricing"], ["qa@jurvio.com", null, null],
      ]);
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
      await admin.end();
    }
  });
});
