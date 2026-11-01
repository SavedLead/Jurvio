import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { billingConfig } from "../infrastructure/stripe";
import { userPlan } from "./account";
import { applyStripeEvent, joinWaitlist } from "./billing";
import { createFixtures } from "./test-fixtures";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("billing projection and waitlist", () => {
  const sql = postgres(databaseUrl ?? "postgres://unused", { max: 1, onnotice: () => {} });
  let fx: Awaited<ReturnType<typeof createFixtures>>;
  const eventIds: string[] = [];
  beforeAll(async () => { fx = await createFixtures(sql); });
  afterAll(async () => {
    await sql`DELETE FROM stripe_webhook_event WHERE id = ANY(${eventIds})`;
    await fx?.cleanup();
    await sql.end();
  });
  const config = billingConfig({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_PRICE_PLUS: "price_plus", STRIPE_PRICE_PRO: "price_pro" });
  const event = (type: string, object: Record<string, unknown>) => {
    const id = `evt_${randomUUID()}`;
    eventIds.push(id);
    return { id, type, data: { object } };
  };

  it("projects checkout + subscription events into the plan, once", async () => {
    const userId = await fx.createUser();
    const customer = `cus_${randomUUID()}`;
    expect(await applyStripeEvent(sql, event("checkout.session.completed", { client_reference_id: userId, customer }), config)).toBe(true);
    const updated = event("customer.subscription.updated", {
      id: `sub_${randomUUID()}`, customer, status: "active", current_period_end: 1_900_000_000, items: { data: [{ price: { id: "price_pro" } }] },
    });
    expect(await applyStripeEvent(sql, updated, config)).toBe(true);
    expect(await applyStripeEvent(sql, updated, config)).toBe(false);
    expect(await userPlan(sql, userId)).toBe("pro");
    await applyStripeEvent(sql, event("customer.subscription.deleted", { id: "sub_x", customer, status: "canceled", items: { data: [{ price: { id: "price_pro" } }] } }), config);
    expect(await userPlan(sql, userId)).toBe("free");
  });

  it("records waitlist interest once per plan", async () => {
    const userId = await fx.createUser();
    await joinWaitlist(sql, userId, "plus");
    await joinWaitlist(sql, userId, "plus");
    await joinWaitlist(sql, userId, "free");
    const rows = await sql<{ plan: string }[]>`SELECT plan::text AS plan FROM plan_waitlist WHERE user_id = ${userId}`;
    expect(rows.map((row) => row.plan)).toEqual(["plus"]);
  });
});
