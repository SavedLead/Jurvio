import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailMessage, EmailProvider } from "@/modules/accounts/infrastructure/email";
import { runAlertDigests } from "@/modules/accounts/application/alerts";
import { followCase } from "@/modules/accounts/application/follows";
import { createFixtures } from "@/modules/accounts/application/test-fixtures";
import { planScotusReclassification, RECLASSIFY_UPDATE_SQL } from "./reclassify-scotus-entries";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("SCOTUS line reclassification (stored data)", () => {
  const sql = postgres(databaseUrl ?? "postgres://unused", { max: 1, onnotice: () => {} });
  let fx: Awaited<ReturnType<typeof createFixtures>>;
  beforeAll(async () => { fx = await createFixtures(sql); });
  afterAll(async () => { await fx?.cleanup(); await sql.end(); });

  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

  async function apply(changes: ReturnType<typeof planScotusReclassification>["changes"]) {
    return sql.begin(async (tx) => {
      await tx`CREATE TEMP TABLE incoming (id uuid PRIMARY KEY, entry_type text NOT NULL, importance text NOT NULL) ON COMMIT DROP`;
      for (const change of changes) await tx`INSERT INTO incoming VALUES (${change.id}, ${change.toType}, ${change.toImportance})`;
      const [row] = await tx.unsafe<{ lines: number; cases: number }[]>(RECLASSIFY_UPDATE_SQL);
      return row!;
    });
  }

  it("retypes stored lines without sending alerts, leaves timestamps alone, and is idempotent", async () => {
    const email = `reclassify-${fx.tag}@example.test`;
    const userId = await fx.createUser(email);
    await sql`INSERT INTO account_subscription (user_id, plan, status) VALUES (${userId}, 'pro', 'active')
      ON CONFLICT (user_id) DO UPDATE SET plan = 'pro', status = 'active'`;
    const legalCase = await fx.createCase({ docketNumber: `26A9${fx.tag.slice(0, 3).replace(/\D/g, "1")}`, caption: `RECLASSIFY ${fx.tag} V. ACME` });
    expect((await followCase(sql, userId, legalCase.publicId)).status).toBe("followed");
    await sql`UPDATE case_follow SET last_alerted_entry_created_at = now() - interval '2 hours', created_at = now() - interval '2 hours' WHERE user_id = ${userId}`;
    const responseId = await fx.addDocketEntry(legalCase.id, "Response to application from respondent Moshe Bain, et al. filed.", { createdAt: ago(30) });
    await sql`UPDATE docket_entry SET entry_type = 'docket_activity', importance = 'routine' WHERE id = ${responseId}`;

    const sent: EmailMessage[] = [];
    const provider: EmailProvider = { name: "fake-reclassify", send: async (message) => { sent.push(message); return { ok: true, providerMessageId: "r1" }; } };
    const deps = { provider, siteUrl: "https://jurvio.com", postalAddress: "Jurvio, 1 Main St, New York, NY" };
    await runAlertDigests(sql, deps);
    expect(sent.filter((message) => message.to === email)).toHaveLength(1);
    const [before] = await sql<{ createdAt: Date; updatedAt: Date }[]>`SELECT created_at AS "createdAt", updated_at AS "updatedAt" FROM docket_entry WHERE id = ${responseId}`;

    const rows = await sql<{ id: string; caseId: string; docketNumber: string; entryType: string; importance: string; description: string }[]>`
      SELECT e.id, e.case_id AS "caseId", c.docket_number AS "docketNumber", coalesce(e.entry_type, '') AS "entryType", e.importance, e.description
      FROM docket_entry e JOIN legal_case c ON c.id = e.case_id WHERE c.id = ${legalCase.id}`;
    const plan = planScotusReclassification(rows);
    expect(plan.changes).toHaveLength(1);
    expect(await apply(plan.changes)).toEqual({ label: "updated lines", lines: 1, cases: 1 });

    const [after] = await sql<{ entryType: string; createdAt: Date; updatedAt: Date }[]>`SELECT entry_type AS "entryType", created_at AS "createdAt", updated_at AS "updatedAt" FROM docket_entry WHERE id = ${responseId}`;
    expect(after!.entryType).toBe("application_response_filed");
    expect(after!.createdAt.getTime()).toBe(before!.createdAt.getTime());
    expect(after!.updatedAt.getTime()).toBe(before!.updatedAt.getTime());

    // Pro is due on every tick, yet a retyped line is not "new": no second email.
    sent.length = 0;
    await runAlertDigests(sql, deps);
    expect(sent.filter((message) => message.to === email)).toHaveLength(0);

    // Running again changes nothing.
    expect(await apply(plan.changes)).toEqual({ label: "updated lines", lines: 0, cases: 0 });
  });
});
