import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/db/client";
import { applyStripeEvent, type StripeEvent } from "@/modules/accounts/application/billing";
import { notifySignupEvent } from "@/modules/accounts/application/signup-notify";
import { getEmailProvider } from "@/modules/accounts/infrastructure/email";
import { billingConfig, verifyStripeSignature } from "@/modules/accounts/infrastructure/stripe";

export const dynamic = "force-dynamic";

// Stripe webhook endpoint (https://jurvio.com/api/billing/webhook). 404 until
// STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set. Signature-verified and
// idempotent by event id (stripe_webhook_event).
export async function POST(request: NextRequest) {
  const config = billingConfig();
  if (!config.enabled || !config.webhookSecret) return NextResponse.json({ error: "billing_disabled" }, { status: 404 });
  const payload = await request.text();
  if (payload.length > 1_000_000 || !verifyStripeSignature(payload, request.headers.get("stripe-signature"), config.webhookSecret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }
  let event: StripeEvent;
  try { event = JSON.parse(payload) as StripeEvent; } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!event?.id || !event.type || !event.data?.object) return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  try {
    const sql = db();
    const applied = await applyStripeEvent(sql, event, config, (userId, previousPlan) => {
      after(() => notifySignupEvent(sql, userId, { provider: getEmailProvider() }, "plan_change", previousPlan));
    });
    return NextResponse.json({ received: true, duplicate: !applied });
  } catch {
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
