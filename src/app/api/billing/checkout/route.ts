import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { getSessionUser } from "@/modules/accounts/application/sign-in";
import { isPlanId } from "@/modules/accounts/domain/plans";
import { SESSION_COOKIE } from "@/modules/accounts/domain/tokens";
import { absoluteUrl, siteUrl } from "@/modules/accounts/http/config";
import { isSameOriginRequest, noStore, readBody } from "@/modules/accounts/http/request";
import { billingConfig, checkoutEnabled, createCheckoutSession } from "@/modules/accounts/infrastructure/stripe";

export const dynamic = "force-dynamic";

// Disabled (404) until STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and the plan's
// STRIPE_PRICE_* are set. The plan is granted only by the verified webhook.
export async function POST(request: NextRequest) {
  const config = billingConfig();
  const body = await readBody(request);
  const plan = body.plan;
  if (!isPlanId(plan) || !checkoutEnabled(config, plan)) return noStore(NextResponse.json({ error: "billing_disabled" }, { status: 404 }));
  if (!isSameOriginRequest(request)) return noStore(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  const sql = db();
  const user = await getSessionUser(sql, request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return noStore(NextResponse.redirect(absoluteUrl("/signin?next=/pricing", request.nextUrl.origin), 303));
  const [subscription] = await sql<{ customerId: string | null }[]>`
    SELECT stripe_customer_id AS "customerId" FROM account_subscription WHERE user_id = ${user.userId}`;
  try {
    const url = await createCheckoutSession({
      secretKey: config.secretKey!,
      priceId: config.prices[plan as Exclude<typeof plan, "free">]!,
      userId: user.userId,
      email: user.email,
      customerId: subscription?.customerId,
      successUrl: new URL("/account?checkout=success", siteUrl()).toString(),
      cancelUrl: new URL("/pricing", siteUrl()).toString(),
    });
    return noStore(NextResponse.redirect(url, 303));
  } catch (error) {
    console.error(JSON.stringify({ billing: "checkout_failed", error: error instanceof Error ? error.message : "error" }));
    return noStore(NextResponse.redirect(absoluteUrl("/pricing?error=checkout", request.nextUrl.origin), 303));
  }
}
