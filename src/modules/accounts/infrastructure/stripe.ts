// Stripe scaffolding (Checkout, Customer Portal, webhooks). Disabled unless
// STRIPE_SECRET_KEY is set; checkout for a plan also needs its price id
// (STRIPE_PRICE_PLUS / STRIPE_PRICE_PRO / STRIPE_PRICE_TEAM) and webhooks need
// STRIPE_WEBHOOK_SECRET. Nothing here runs until David configures Stripe.
// Stripe is billing authority; account_subscription is Jurvio's projection
// (docs/16 section 5). Never provision from the browser redirect.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlanId } from "../domain/plans";

export interface StripeEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_PLUS?: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_TEAM?: string;
}

export type PaidPlanId = Exclude<PlanId, "free">;

export interface BillingConfig {
  enabled: boolean;
  secretKey: string | null;
  webhookSecret: string | null;
  prices: Partial<Record<PaidPlanId, string>>;
}

export function billingConfig(source: StripeEnv = process.env as StripeEnv): BillingConfig {
  const secretKey = source.STRIPE_SECRET_KEY?.trim() || null;
  const prices: Partial<Record<PaidPlanId, string>> = {};
  if (source.STRIPE_PRICE_PLUS?.trim()) prices.plus = source.STRIPE_PRICE_PLUS.trim();
  if (source.STRIPE_PRICE_PRO?.trim()) prices.pro = source.STRIPE_PRICE_PRO.trim();
  if (source.STRIPE_PRICE_TEAM?.trim()) prices.team = source.STRIPE_PRICE_TEAM.trim();
  return { enabled: Boolean(secretKey), secretKey, webhookSecret: source.STRIPE_WEBHOOK_SECRET?.trim() || null, prices };
}

/** Checkout is offered for a plan only with a secret key, a webhook secret and that plan's price id. */
export function checkoutEnabled(config: BillingConfig, plan: PlanId): boolean {
  return plan !== "free" && config.enabled && Boolean(config.webhookSecret) && Boolean(config.prices[plan]);
}

export function planForPrice(config: BillingConfig, priceId: string | null | undefined): PaidPlanId | null {
  if (!priceId) return null;
  const match = (Object.entries(config.prices) as Array<[PaidPlanId, string]>).find(([, id]) => id === priceId);
  return match?.[0] ?? null;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

async function stripePost(secretKey: string, path: string, params: Record<string, string>, fetchImpl: FetchLike = fetch) {
  const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as { url?: string; error?: { message?: string } };
  if (!response.ok || !body.url) throw new Error(`stripe ${path} failed (${response.status})`);
  return body.url;
}

export function createCheckoutSession(input: {
  secretKey: string; priceId: string; userId: string; email: string; customerId?: string | null;
  successUrl: string; cancelUrl: string; fetchImpl?: FetchLike;
}): Promise<string> {
  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: input.userId,
    "metadata[user_id]": input.userId,
    "subscription_data[metadata][user_id]": input.userId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    allow_promotion_codes: "true",
  };
  if (input.customerId) params.customer = input.customerId;
  else params.customer_email = input.email;
  return stripePost(input.secretKey, "checkout/sessions", params, input.fetchImpl);
}

export function createPortalSession(input: { secretKey: string; customerId: string; returnUrl: string; fetchImpl?: FetchLike }): Promise<string> {
  return stripePost(input.secretKey, "billing_portal/sessions", { customer: input.customerId, return_url: input.returnUrl }, input.fetchImpl);
}

/** Verifies a Stripe-Signature header (v1 HMAC-SHA256 of "<t>.<payload>") within a tolerance window. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  if (!header) return false;
  const parts = header.split(",").map((part) => part.trim().split("=", 2) as [string, string]);
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex"));
  return signatures.some((signature) => {
    const actual = Buffer.from(signature);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
