import type { Sql } from "postgres";
import { isPlanId, type PlanId } from "../domain/plans";
import { planForPrice, type BillingConfig } from "../infrastructure/stripe";

export interface StripeEvent {
  id: string;
  type: string;
  livemode?: boolean;
  created?: number;
  data: { object: Record<string, unknown> };
}

const SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due", "canceled", "incomplete", "unpaid", "paused"]);

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * Applies one verified Stripe event to the entitlement projection, once.
 * Returns false when the event id was already processed (Stripe retries).
 */
export async function applyStripeEvent(sql: Sql, event: StripeEvent, config: BillingConfig): Promise<boolean> {
  const [inserted] = await sql<{ id: string }[]>`
    INSERT INTO stripe_webhook_event (id, type, livemode, payload)
    VALUES (${event.id}, ${event.type}, ${Boolean(event.livemode)}, ${sql.json(event as never)})
    ON CONFLICT (id) DO NOTHING RETURNING id`;
  if (!inserted) return false;
  const object = event.data.object;
  try {
    if (event.type === "checkout.session.completed") {
      const userId = text(object.client_reference_id) ?? text((object.metadata as Record<string, unknown> | undefined)?.user_id);
      const customerId = text(object.customer);
      if (userId && customerId) {
        await sql`
          INSERT INTO account_subscription (user_id, stripe_customer_id) VALUES (${userId}, ${customerId})
          ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, updated_at = now()`;
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      const customerId = text(object.customer);
      const metadataUser = text((object.metadata as Record<string, unknown> | undefined)?.user_id);
      const items = (object.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data ?? [];
      const priceId = text(items[0]?.price?.id);
      const status = event.type === "customer.subscription.deleted" ? "canceled" : text(object.status) ?? "incomplete";
      const plan: PlanId = planForPrice(config, priceId) ?? "free";
      const periodEnd = typeof object.current_period_end === "number" ? new Date(object.current_period_end * 1000) : null;
      const [owner] = await sql<{ userId: string }[]>`
        SELECT user_id AS "userId" FROM account_subscription WHERE stripe_customer_id = ${customerId}
        UNION ALL SELECT id FROM app_user WHERE id::text = ${metadataUser ?? ""}
        LIMIT 1`;
      if (owner && SUBSCRIPTION_STATUSES.has(status) && isPlanId(plan)) {
        await sql`
          INSERT INTO account_subscription (user_id, plan, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, cancel_at_period_end)
          VALUES (${owner.userId}, ${plan}::account_plan, ${status}, ${customerId}, ${text(object.id)}, ${priceId}, ${periodEnd}, ${Boolean(object.cancel_at_period_end)})
          ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status,
            stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, account_subscription.stripe_customer_id),
            stripe_subscription_id = EXCLUDED.stripe_subscription_id, stripe_price_id = EXCLUDED.stripe_price_id,
            current_period_end = EXCLUDED.current_period_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end, updated_at = now()`;
      }
    }
    await sql`UPDATE stripe_webhook_event SET processed_at = now() WHERE id = ${event.id}`;
  } catch (error) {
    await sql`UPDATE stripe_webhook_event SET error = ${error instanceof Error ? error.message.slice(0, 500) : "error"} WHERE id = ${event.id}`;
    throw error;
  }
  return true;
}

export async function joinWaitlist(sql: Sql, userId: string, plan: PlanId): Promise<void> {
  if (plan === "free") return;
  await sql`INSERT INTO plan_waitlist (user_id, plan) VALUES (${userId}, ${plan}::account_plan) ON CONFLICT DO NOTHING`;
}
