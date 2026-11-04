import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { getSignupsDashboard, isOutsideEmail } from "@/modules/internal/application/get-signups-dashboard";

describe("internal sign-ups page wiring", () => {
  it("classifies internal and test addresses as not outside", () => {
    expect(isOutsideEmail("a@jurvio.com")).toBe(false);
    expect(isOutsideEmail("x@example.org")).toBe(false);
    expect(isOutsideEmail("t+cleanyourname@gmail.com")).toBe(false);
    expect(isOutsideEmail("person@gmail.com")).toBe(true);
  });
  it("is linked from the internal nav and home and guarded by internal auth", () => {
    expect(readFileSync("src/app/internal/layout.tsx", "utf8")).toContain('href: "/internal/signups"');
    expect(readFileSync("src/app/internal/page.tsx", "utf8")).toContain('href: "/internal/signups"');
    const page = readFileSync("src/app/internal/signups/page.tsx", "utf8");
    expect(page).toContain("requireInternalPrincipal");
    expect(page).toContain("index: false");
  });
});

const databaseUrl = process.env.DATABASE_URL;
const hasPsql = spawnSync("psql", ["--version"]).status === 0;

describe.skipIf(!databaseUrl || !hasPsql)("getSignupsDashboard against Postgres", () => {
  it("counts accounts, waitlists, follows, paid plans and lists the latest entries", { timeout: 240_000 }, async () => {
    const admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const name = `signups_it_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
      const [u1] = await sql`INSERT INTO app_user (email, email_verified_at, created_at) VALUES ('person@gmail.com', now(), now() - interval '2 hours') RETURNING id`;
      const [u2] = await sql`INSERT INTO app_user (email, created_at) VALUES ('qa@jurvio.com', now() - interval '3 days') RETURNING id`;
      await sql`INSERT INTO app_user (email, created_at) VALUES ('old@example.com', now() - interval '30 days')`;
      await sql`INSERT INTO lead_waitlist (email, source, plan) VALUES ('lead@gmail.com', 'plan', 'pro')`;
      await sql`INSERT INTO lead_waitlist (email, source, plan, converted_at) VALUES ('lead2@example.com', 'plan', 'pro', now())`;
      await sql`INSERT INTO lead_waitlist (email, source) VALUES ('s@gmail.com', 'signin')`;
      await sql`INSERT INTO plan_waitlist (user_id, plan) VALUES (${u1!.id}, 'pro')`;
      await sql`INSERT INTO account_subscription (user_id, plan) VALUES (${u1!.id}, 'pro'), (${u2!.id}, 'free')`;
      const d = await getSignupsDashboard(sql);
      expect(d.accounts).toMatchObject({ total: 3, verified: 1, outside: 1, last24h: 1, last7d: 2 });
      expect(d.leadWaitlist).toEqual([
        expect.objectContaining({ source: "plan", plan: "pro", total: 2, outside: 1, converted: 1 }),
        expect.objectContaining({ source: "signin", plan: null, total: 1, outside: 1, converted: 0 }),
      ]);
      expect(d.planWaitlist).toEqual([expect.objectContaining({ plan: "pro", total: 1 })]);
      expect(d.caseFollows.total).toBe(0);
      expect(d.paidSubscriptions).toEqual([{ plan: "pro", status: "active", total: 1 }]);
      expect(d.recent).toHaveLength(6);
      expect(d.recent.at(-1)!.email).toBe("old@example.com");
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
      await admin.end();
    }
  });
});
