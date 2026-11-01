import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailMessage, EmailProvider } from "../infrastructure/email";
import { runAlertDigests, unsubscribeByToken } from "./alerts";
import { followCase } from "./follows";
import { createFixtures } from "./test-fixtures";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("followed-case alert digests", () => {
  const sql = postgres(databaseUrl ?? "postgres://unused", { max: 1, onnotice: () => {} });
  let fx: Awaited<ReturnType<typeof createFixtures>>;
  beforeAll(async () => { fx = await createFixtures(sql); });
  afterAll(async () => { await fx?.cleanup(); await sql.end(); });

  const capture = () => {
    const sent: EmailMessage[] = [];
    const provider: EmailProvider = { name: "fake-alerts", send: async (message) => { sent.push(message); return { ok: true, providerMessageId: "a1" }; } };
    return { sent, provider };
  };
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const deps = (provider: EmailProvider) => ({ provider, siteUrl: "https://jurvio.com", postalAddress: "Jurvio, 1 Main St, New York, NY" });

  it("is a no-op without a provider or postal address", async () => {
    expect((await runAlertDigests(sql, { provider: null, siteUrl: "https://jurvio.com", postalAddress: "x" })).status).toBe("skipped");
    expect((await runAlertDigests(sql, { provider: capture().provider, siteUrl: "https://jurvio.com", postalAddress: "" })).status).toBe("skipped");
  });

  it("sends new visible entries once, at the plan cadence, and honors unsubscribe", async () => {
    const email = `alerts-${fx.tag}@example.test`;
    const userId = await fx.createUser(email);
    const legalCase = await fx.createCase({ caption: `ALERTS ${fx.tag} V. ACME` });
    expect((await followCase(sql, userId, legalCase.publicId)).status).toBe("followed");
    await sql`UPDATE case_follow SET last_alerted_entry_created_at = now() - interval '2 hours', created_at = now() - interval '2 hours' WHERE user_id = ${userId}`;
    await fx.addDocketEntry(legalCase.id, "Before follow", { createdAt: ago(180) });
    await fx.addDocketEntry(legalCase.id, "Motion to dismiss filed", { createdAt: ago(30) });
    await fx.addDocketEntry(legalCase.id, "Hidden entry", { createdAt: ago(30), displayable: false });
    await fx.addDocketEntry(legalCase.id, "Old backfilled entry", { createdAt: ago(30), filedOn: "2001-01-01" });
    await fx.addDocketEntry(legalCase.id, "Still settling", { createdAt: ago(0) });

    const first = capture();
    await runAlertDigests(sql, deps(first.provider));
    const mine = first.sent.filter((message) => message.to === email);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.text).toContain("Motion to dismiss filed");
    for (const hidden of ["Before follow", "Hidden entry", "Old backfilled entry", "Still settling"]) expect(mine[0]!.text).not.toContain(hidden);
    expect(mine[0]!.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mine[0]!.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/jurvio\.com\/api\/alerts\/unsubscribe\?token=[0-9a-f]{48}>$/);
    const [user] = await sql<{ lastDigestAt: Date | null; token: string }[]>`SELECT last_digest_at AS "lastDigestAt", unsubscribe_token AS token FROM app_user WHERE id = ${userId}`;
    expect(user!.lastDigestAt).not.toBeNull();

    // Free = daily: a new entry right after a digest waits for tomorrow.
    await fx.addDocketEntry(legalCase.id, "Opposition filed", { createdAt: ago(5) });
    const second = capture();
    await runAlertDigests(sql, deps(second.provider));
    expect(second.sent.filter((message) => message.to === email)).toHaveLength(0);

    // Pro = instant: due on the next tick, and only the new entry is sent.
    await sql`INSERT INTO account_subscription (user_id, plan, status) VALUES (${userId}, 'pro', 'active')
      ON CONFLICT (user_id) DO UPDATE SET plan = 'pro', status = 'active'`;
    await sql`UPDATE app_user SET last_digest_at = now() - interval '11 minutes' WHERE id = ${userId}`;
    const third = capture();
    await runAlertDigests(sql, deps(third.provider));
    const thirdMine = third.sent.filter((message) => message.to === email);
    expect(thirdMine).toHaveLength(1);
    expect(thirdMine[0]!.text).toContain("Opposition filed");
    expect(thirdMine[0]!.text).not.toContain("Motion to dismiss filed");

    // Unsubscribed users get nothing.
    expect(await unsubscribeByToken(sql, user!.token)).toBe(true);
    await fx.addDocketEntry(legalCase.id, "Reply filed", { createdAt: ago(5) });
    await sql`UPDATE app_user SET last_digest_at = now() - interval '1 day' WHERE id = ${userId}`;
    const fourth = capture();
    await runAlertDigests(sql, deps(fourth.provider));
    expect(fourth.sent.filter((message) => message.to === email)).toHaveLength(0);
    expect(await unsubscribeByToken(sql, "not-a-token")).toBe(false);
  });

  it("never alerts on a followed case that later becomes sealed", async () => {
    const email = `alerts-sealed-${fx.tag}@example.test`;
    const userId = await fx.createUser(email);
    const legalCase = await fx.createCase();
    await followCase(sql, userId, legalCase.publicId);
    await sql`UPDATE case_follow SET last_alerted_entry_created_at = now() - interval '1 hour' WHERE user_id = ${userId}`;
    await sql`UPDATE legal_case SET caption = 'UNDER SEAL V. MATTER' WHERE id = ${legalCase.id}`;
    await fx.addDocketEntry(legalCase.id, "Sealed order", { createdAt: ago(20) });
    const run = capture();
    await runAlertDigests(sql, deps(run.provider));
    expect(run.sent.filter((message) => message.to === email)).toHaveLength(0);
    const [follow] = await sql<{ advanced: boolean }[]>`
      SELECT last_alerted_entry_created_at > now() - interval '30 minutes' AS advanced FROM case_follow WHERE user_id = ${userId}`;
    expect(follow!.advanced).toBe(true);
  });
});
