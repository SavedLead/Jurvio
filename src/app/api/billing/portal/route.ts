import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { getSessionUser } from "@/modules/accounts/application/sign-in";
import { SESSION_COOKIE } from "@/modules/accounts/domain/tokens";
import { absoluteUrl, siteUrl } from "@/modules/accounts/http/config";
import { isSameOriginRequest, noStore } from "@/modules/accounts/http/request";
import { billingConfig, createPortalSession } from "@/modules/accounts/infrastructure/stripe";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const config = billingConfig();
  if (!config.enabled) return noStore(NextResponse.json({ error: "billing_disabled" }, { status: 404 }));
  if (!isSameOriginRequest(request)) return noStore(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  const sql = db();
  const user = await getSessionUser(sql, request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return noStore(NextResponse.redirect(absoluteUrl("/signin?next=/account", request.nextUrl.origin), 303));
  const [subscription] = await sql<{ customerId: string | null }[]>`
    SELECT stripe_customer_id AS "customerId" FROM account_subscription WHERE user_id = ${user.userId}`;
  if (!subscription?.customerId) return noStore(NextResponse.redirect(absoluteUrl("/pricing", request.nextUrl.origin), 303));
  try {
    const url = await createPortalSession({ secretKey: config.secretKey!, customerId: subscription.customerId, returnUrl: new URL("/account", siteUrl()).toString() });
    return noStore(NextResponse.redirect(url, 303));
  } catch {
    return noStore(NextResponse.redirect(absoluteUrl("/account?error=portal", request.nextUrl.origin), 303));
  }
}
