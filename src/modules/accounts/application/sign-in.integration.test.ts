import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import type { EmailMessage, EmailProvider } from "../infrastructure/email";
import { getSessionUser, requestSignIn, revokeSession, verifySignIn } from "./sign-in";
import { loadAccount } from "./account";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("passwordless sign-in", () => {
  const sql = postgres(databaseUrl ?? "postgres://unused", { max: 1, onnotice: () => {} });
  const emails: string[] = [];
  const freshEmail = () => { const email = `signin-${randomUUID()}@example.test`; emails.push(email); return email; };
  const ip = () => `ip-${randomUUID()}`;
  afterAll(async () => {
    if (!databaseUrl) return;
    await sql`DELETE FROM app_user WHERE email = ANY(${emails})`;
    await sql`DELETE FROM auth_login_token WHERE email = ANY(${emails})`;
    await sql.end();
  });

  it("logs the link in development, then verifies it once into a session", async () => {
    const email = freshEmail();
    const lines: string[] = [];
    const status = await requestSignIn(sql, { email: email.toUpperCase(), ip: ip(), redirectPath: "/case/jv-x" },
      { provider: null, siteUrl: "https://jurvio.com", production: false, log: (line) => lines.push(line) });
    expect(status).toBe("logged");
    const token = new URL(lines[0]!.split(": ").at(-1)!).searchParams.get("token")!;
    expect(lines[0]).toContain("https://jurvio.com/signin/verify?token=");
    const [stored] = await sql<{ tokenHash: string }[]>`SELECT token_hash AS "tokenHash" FROM auth_login_token WHERE email = ${email}`;
    expect(stored!.tokenHash).not.toContain(token);

    const verified = await verifySignIn(sql, token);
    expect(verified).toMatchObject({ email, redirectPath: "/case/jv-x" });
    expect(await verifySignIn(sql, token)).toBeNull(); // single use
    const user = await getSessionUser(sql, verified!.sessionToken);
    expect(user).toEqual({ userId: verified!.userId, email });
    const account = await loadAccount(sql, verified!.userId);
    expect(account).toMatchObject({ email, plan: "free", followCount: 0 });
    await revokeSession(sql, verified!.sessionToken);
    expect(await getSessionUser(sql, verified!.sessionToken)).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const email = freshEmail();
    const lines: string[] = [];
    await requestSignIn(sql, { email, ip: ip() }, { provider: null, siteUrl: "https://jurvio.com", production: false, log: (l) => lines.push(l) });
    const token = new URL(lines[0]!.split(": ").at(-1)!).searchParams.get("token")!;
    await sql`UPDATE auth_login_token SET expires_at = now() - interval '1 minute' WHERE email = ${email}`;
    expect(await verifySignIn(sql, token)).toBeNull();
  });

  it("is unavailable in production without an email provider", async () => {
    const email = freshEmail();
    expect(await requestSignIn(sql, { email, ip: ip() }, { provider: null, siteUrl: "https://jurvio.com", production: true })).toBe("unavailable");
    const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM auth_login_token WHERE email = ${email}`;
    expect(count!.n).toBe(0);
  });

  it("sends through the provider and records an email event", async () => {
    const email = freshEmail();
    const sent: EmailMessage[] = [];
    const provider: EmailProvider = { name: "fake", send: async (message) => { sent.push(message); return { ok: true, providerMessageId: "m1" }; } };
    expect(await requestSignIn(sql, { email, ip: ip() }, { provider, siteUrl: "https://jurvio.com", production: true })).toBe("sent");
    expect(sent[0]!.to).toBe(email);
    expect(sent[0]!.text).toContain("https://jurvio.com/signin/verify?token=");
    const [event] = await sql<{ status: string; kind: string }[]>`
      SELECT status, kind FROM email_event WHERE provider = 'fake' AND provider_message_id = 'm1' ORDER BY created_at DESC LIMIT 1`;
    expect(event).toEqual({ status: "sent", kind: "signin_link" });
  });

  it("rate limits per email and per IP", async () => {
    const email = freshEmail();
    const deps = { provider: null, siteUrl: "https://jurvio.com", production: false, log: () => {} };
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await requestSignIn(sql, { email, ip: ip() }, deps));
    expect(results.slice(0, 5).every((r) => r === "logged")).toBe(true);
    expect(results[5]).toBe("rate_limited");
    const sharedIp = ip();
    const ipResults = [];
    for (let i = 0; i < 21; i++) ipResults.push(await requestSignIn(sql, { email: freshEmail(), ip: sharedIp }, deps));
    expect(ipResults[19]).toBe("logged");
    expect(ipResults[20]).toBe("rate_limited");
  });

  it("rejects invalid emails", async () => {
    expect(await requestSignIn(sql, { email: "not-an-email", ip: ip() }, { provider: null, siteUrl: "https://jurvio.com", production: false })).toBe("invalid");
  });
});
