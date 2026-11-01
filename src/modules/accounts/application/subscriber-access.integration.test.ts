import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicCases } from "@/modules/cases/application/list-public-cases";
import { listPublicDocketEntries } from "@/modules/cases/application/list-public-case-sections";
import { getMachineCase } from "@/modules/discovery/application/get-machine-case";
import { resolveCaseAccess } from "./case-access";
import { hasSubscriberAccess, userHasSubscriberAccess } from "./subscriber-access";

const databaseUrl = process.env.DATABASE_URL;

describe("hasSubscriberAccess", () => {
  it("opens only active or trialing Plus / Pro / Team plans", () => {
    expect(hasSubscriberAccess(null)).toBe(false);
    expect(hasSubscriberAccess({ plan: "free", status: "active" })).toBe(false);
    expect(hasSubscriberAccess({ plan: "plus", status: "active" })).toBe(true);
    expect(hasSubscriberAccess({ plan: "pro", status: "trialing" })).toBe(true);
    expect(hasSubscriberAccess({ plan: "team", status: "active" })).toBe(true);
    expect(hasSubscriberAccess({ plan: "pro", status: "past_due" })).toBe(false);
    expect(hasSubscriberAccess({ plan: "plus", status: "canceled" })).toBe(false);
  });
});

// Everything runs in one transaction that is rolled back, so other test files
// sharing the database never see these published cases.
describe.skipIf(!databaseUrl)("subscriber-only (sealed-style) case records: anonymous / free / paid", () => {
  const root = postgres(databaseUrl ?? "postgres://unused", { max: 1, onnotice: () => {} });
  afterAll(async () => { if (databaseUrl) await root.end(); });

  it("gates the record and keeps it out of public listings and machine JSON", async () => {
    const rollback = new Error("rollback");
    await root.begin(async (tx) => {
      const sql = tx as unknown as typeof root;
      const tag = randomUUID().replaceAll("-", "").slice(0, 10);
      const [court] = await sql<{ id: string }[]>`
        INSERT INTO court (public_id, provider_court_id, name, jurisdiction, verification)
        VALUES (${`jc-sub${tag}`}, ${`sub${tag}`}, ${`Subscriber Test Circuit ${tag}`}, 'F', 'verified') RETURNING id`;
      async function createCase(suffix: string, caption: string) {
        const publicId = `jv-sb${tag.slice(0, 6)}${suffix}`;
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication, verification)
          VALUES (${publicId}, ${court!.id}, ${`26-${suffix}`}, ${caption}, 'published', 'verified') RETURNING id`;
        await sql`
          INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
          VALUES ('legal_case', ${row!.id}, true, true, true, false, false, 'test', 'test')`;
        return { id: row!.id, publicId };
      }
      const sealed = await createCase("s", "In re: Sealed Case");
      const open = await createCase("o", `Acme ${tag} v. Beta`);
      // A docket entry the court restricted: hidden from everyone, subscribers included.
      const [entry] = await sql<{ id: string }[]>`
        INSERT INTO docket_entry (public_id, case_id, provider_entry_id, entry_number, filed_on, description)
        VALUES (${`jd-sb${tag.slice(0, 7)}`}, ${sealed.id}, ${`sb-${tag}`}, '1', '2026-10-01', 'SEALED MOTION') RETURNING id`;
      await sql`
        INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
        VALUES ('docket_entry', ${entry!.id}, false, false, false, false, false, 'restricted', 'test')`;

      async function user(plan: string | null, status = "active") {
        const [row] = await sql<{ id: string }[]>`INSERT INTO app_user (email, email_verified_at) VALUES (${`sub-${randomBytes(6).toString("hex")}@example.test`}, now()) RETURNING id`;
        if (plan) await sql`INSERT INTO account_subscription (user_id, plan, status) VALUES (${row!.id}, ${plan}::account_plan, ${status})`;
        return row!.id;
      }
      const freeUser = await user("free");
      const paidUser = await user("pro");
      const lapsedUser = await user("plus", "canceled");
      expect(await userHasSubscriberAccess(sql, freeUser)).toBe(false);
      expect(await userHasSubscriberAccess(sql, paidUser)).toBe(true);
      expect(await userHasSubscriberAccess(sql, lapsedUser)).toBe(false);

      const sealedCase = await getPublicCase(sql, sealed.publicId);
      expect(sealedCase!.searchExcluded).toBe(true);
      const anonymous = async () => false;
      const asUser = (userId: string) => () => userHasSubscriberAccess(sql, userId);
      expect(await resolveCaseAccess(sealedCase, anonymous)).toEqual({ status: "gated" });
      expect(await resolveCaseAccess(sealedCase, asUser(freeUser))).toEqual({ status: "gated" });
      expect(await resolveCaseAccess(sealedCase, asUser(lapsedUser))).toEqual({ status: "gated" });
      expect(await resolveCaseAccess(sealedCase, asUser(paidUser))).toMatchObject({ status: "ok", subscriberOnly: true });
      // Ordinary cases never consult the viewer.
      let asked = false;
      expect(await resolveCaseAccess(await getPublicCase(sql, open.publicId), async () => { asked = true; return false; }))
        .toMatchObject({ status: "ok", subscriberOnly: false });
      expect(asked).toBe(false);

      const base = { page: 1, pageSize: 20, court: `jc-sub${tag}`, sort: "az" as const };
      expect((await listPublicCases(sql, base)).cases.map((c) => c.publicId)).toEqual([open.publicId]);
      expect((await listPublicCases(sql, { ...base, query: "Sealed" })).cases).toEqual([]);
      expect((await listPublicCases(sql, { ...base, includeSubscriberOnly: true })).cases.map((c) => c.publicId).sort())
        .toEqual([open.publicId, sealed.publicId].sort());
      expect(await getMachineCase(sql, sealed.publicId)).toBeNull();
      expect(await getMachineCase(sql, open.publicId)).not.toBeNull();
      expect(await listPublicDocketEntries(sql, sealed.publicId)).toEqual([]);
      throw rollback;
    }).catch((error) => { if (error !== rollback) throw error; });
  });
});
