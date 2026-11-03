import { randomUUID } from "node:crypto";
import { PLANS } from "../domain/plans";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createFixtures } from "./test-fixtures";
import { captureLead, convertLeads } from "./waitlist";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("no-sign-in lead waitlist", () => {
  const sql = postgres(databaseUrl ?? "postgres://unused", { max: 1, onnotice: () => {} });
  const fixtures = databaseUrl ? createFixtures(sql) : null;
  const emails: string[] = [];
  const freshEmail = () => { const email = `lead-${randomUUID()}@example.test`; emails.push(email); return email; };
  const ip = () => `ip-${randomUUID()}`;
  afterAll(async () => {
    if (!databaseUrl) return;
    await sql`DELETE FROM lead_waitlist WHERE email = ANY(${emails})`;
    await (await fixtures!).cleanup();
    await sql.end();
  });

  it("stores a case follow lead once (deduped) without signing in", async () => {
    const email = freshEmail();
    const address = ip();
    expect(await captureLead(sql, { email: ` ${email.toUpperCase()} `, ip: address, source: "case_follow", casePublicId: "jv-s53fb7vdoj" })).toBe("joined");
    expect(await captureLead(sql, { email, ip: address, source: "case_follow", casePublicId: "jv-s53fb7vdoj" })).toBe("joined");
    const rows = await sql<{ casePublicId: string; submissions: number; ipHash: string }[]>`
      SELECT case_public_id AS "casePublicId", submissions, ip_hash AS "ipHash" FROM lead_waitlist WHERE email = ${email}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ casePublicId: "jv-s53fb7vdoj", submissions: 2 });
    expect(rows[0]!.ipHash).not.toContain(address);
  });

  it("rejects bad input and drops honeypot submissions while answering success", async () => {
    expect(await captureLead(sql, { email: "not-an-email", ip: ip(), source: "signin" })).toBe("invalid");
    expect(await captureLead(sql, { email: freshEmail(), ip: ip(), source: "plan", plan: "gold" })).toBe("invalid");
    expect(await captureLead(sql, { email: freshEmail(), ip: ip(), source: "case_follow", casePublicId: "../x" })).toBe("invalid");
    const bot = freshEmail();
    expect(await captureLead(sql, { email: bot, ip: ip(), source: "signin", honeypot: "Acme LLC" })).toBe("joined");
    const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM lead_waitlist WHERE email = ${bot}`;
    expect(count!.n).toBe(0);
  });

  it("rate limits one address", async () => {
    const address = ip();
    const results: string[] = [];
    for (let i = 0; i < 32; i += 1) results.push(await captureLead(sql, { email: freshEmail(), ip: address, source: "signin" }));
    expect(results.slice(0, 30).every((status) => status === "joined")).toBe(true);
    expect(results.at(-1)).toBe("rate_limited");
  });

  it("converts waitlisted follows and plan interest on sign-up", async () => {
    const f = await fixtures!;
    const email = freshEmail();
    const followable = await f.createCase();
    const sealed = await f.createCase({ caption: "UNITED STATES V. SEALED DEFENDANT" });
    await captureLead(sql, { email, ip: ip(), source: "case_follow", casePublicId: followable.publicId });
    await captureLead(sql, { email, ip: ip(), source: "case_follow", casePublicId: sealed.publicId });
    await captureLead(sql, { email, ip: ip(), source: "plan", plan: "pro" });
    const userId = await f.createUser(email);

    const result = await convertLeads(sql, userId, email);
    expect(result).toEqual({ followed: [followable.publicId], plans: ["pro"] });
    const [follow] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM case_follow WHERE user_id = ${userId} AND case_id = ${followable.id}`;
    expect(follow!.n).toBe(1);
    const [waitlist] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM plan_waitlist WHERE user_id = ${userId} AND plan = 'pro'`;
    expect(waitlist!.n).toBe(1);
    const [open] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM lead_waitlist WHERE email = ${email} AND converted_at IS NULL`;
    expect(open!.n).toBe(0);
    expect(await convertLeads(sql, userId, email)).toEqual({ followed: [], plans: [] });
  });

  it("keeps the follow kinds ticked on the waitlist (citations, or both after a second submission)", async () => {
    const f = await fixtures!;
    const email = freshEmail();
    const oldCase = await f.createCase();
    const both = await f.createCase();
    await captureLead(sql, { email, ip: ip(), source: "case_follow", casePublicId: oldCase.publicId, followKindBits: 2 });
    await captureLead(sql, { email, ip: ip(), source: "case_follow", casePublicId: both.publicId, followKindBits: 1 });
    await captureLead(sql, { email, ip: ip(), source: "case_follow", casePublicId: both.publicId, followKindBits: 2 });
    const userId = await f.createUser(email);
    await convertLeads(sql, userId, email);
    const rows = await sql<{ caseId: string; activity: boolean; citations: boolean }[]>`
      SELECT case_id AS "caseId", activity, citations FROM case_follow WHERE user_id = ${userId}`;
    expect(rows.find((row) => row.caseId === oldCase.id)).toMatchObject({ activity: false, citations: true });
    expect(rows.find((row) => row.caseId === both.id)).toMatchObject({ activity: true, citations: true });
  });

  it("keeps follow leads over the plan limit for later", async () => {
    const f = await fixtures!;
    const email = freshEmail();
    const userId = await f.createUser(email);
    const cases = [];
    for (let i = 0; i <= PLANS.free.followLimit; i += 1) cases.push(await f.createCase());
    for (const c of cases) await captureLead(sql, { email, ip: ip(), source: "case_follow", casePublicId: c.publicId });
    const result = await convertLeads(sql, userId, email);
    expect(result.followed).toHaveLength(PLANS.free.followLimit);
    const [open] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM lead_waitlist WHERE email = ${email} AND converted_at IS NULL`;
    expect(open!.n).toBe(1);
  });
});
