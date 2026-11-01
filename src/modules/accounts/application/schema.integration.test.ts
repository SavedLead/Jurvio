import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("customer accounts schema (0153)", () => {
  it("enforces lowercase unique emails, hashed tokens and plan enum", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const email = `schema-${randomUUID()}@example.test`;
    try {
      const [user] = await sql<{ id: string; unsubscribeToken: string }[]>`
        INSERT INTO app_user (email) VALUES (${email}) RETURNING id, unsubscribe_token AS "unsubscribeToken"`;
      expect(user!.unsubscribeToken).toMatch(/^[0-9a-f]{48}$/);
      await expect(sql`INSERT INTO app_user (email) VALUES (${email})`).rejects.toThrow();
      await expect(sql`INSERT INTO app_user (email) VALUES (${email.toUpperCase()})`).rejects.toThrow();
      await expect(sql`INSERT INTO auth_session (token_hash, user_id, expires_at) VALUES ('raw-token', ${user!.id}, now())`).rejects.toThrow();
      await expect(sql`INSERT INTO auth_login_token (token_hash, email, expires_at, redirect_path) VALUES (${"a".repeat(64)}, ${email}, now(), '//evil.example')`).rejects.toThrow();
      await sql`INSERT INTO account_subscription (user_id) VALUES (${user!.id})`;
      const [sub] = await sql<{ plan: string }[]>`SELECT plan::text AS plan FROM account_subscription WHERE user_id = ${user!.id}`;
      expect(sub!.plan).toBe("free");
      await expect(sql`UPDATE account_subscription SET plan = 'gold' WHERE user_id = ${user!.id}`).rejects.toThrow();
      await expect(sql`INSERT INTO plan_waitlist (user_id, plan) VALUES (${user!.id}, 'free')`).rejects.toThrow();
    } finally {
      await sql`DELETE FROM app_user WHERE email = ${email}`;
      await sql.end();
    }
  });
});
