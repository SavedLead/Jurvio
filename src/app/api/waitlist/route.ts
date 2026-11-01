import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { joinWaitlist } from "@/modules/accounts/application/billing";
import { getSessionUser } from "@/modules/accounts/application/sign-in";
import { captureLead, LEAD_SUCCESS_MESSAGE } from "@/modules/accounts/application/waitlist";
import { isPlanId } from "@/modules/accounts/domain/plans";
import { SESSION_COOKIE } from "@/modules/accounts/domain/tokens";
import { absoluteUrl } from "@/modules/accounts/http/config";
import { clientIp, isSameOriginRequest, noStore, readBody, wantsJson } from "@/modules/accounts/http/request";

export const dynamic = "force-dynamic";

// "Coming soon / join waitlist" on /pricing while checkout is disabled.
// Signed-in visitors join by account; signed-out visitors join by email
// (no sign-in needed), and the email lead converts when they sign in later.
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return noStore(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  const body = await readBody(request);
  const plan = body.plan;
  // The shared /pricing#join form posts every plan here; "free" means sign up,
  // so re-post it (307 keeps method and body) to the sign-in request route.
  if (plan === "free" && body.email !== undefined) {
    return noStore(NextResponse.redirect(absoluteUrl("/api/auth/request", request.nextUrl.origin), 307));
  }
  if (!isPlanId(plan) || plan === "free") return noStore(NextResponse.json({ error: "invalid_plan" }, { status: 400 }));
  const sql = db();
  const user = await getSessionUser(sql, request.cookies.get(SESSION_COOKIE)?.value);
  if (user) {
    await joinWaitlist(sql, user.userId, plan);
    if (wantsJson(request)) return noStore(NextResponse.json({ ok: true, plan }));
    return noStore(NextResponse.redirect(absoluteUrl(`/pricing?joined=${plan}`, request.nextUrl.origin), 303));
  }
  if (body.email === undefined) {
    if (wantsJson(request)) return noStore(NextResponse.json({ error: "email_required" }, { status: 400 }));
    return noStore(NextResponse.redirect(absoluteUrl(`/pricing?waitlist_error=invalid#plan-${plan}`, request.nextUrl.origin), 303));
  }
  const status = await captureLead(sql, { email: body.email, ip: clientIp(request), source: "plan", plan, honeypot: body.company });
  if (wantsJson(request)) {
    if (status === "joined") return noStore(NextResponse.json({ ok: true, plan, status: "waitlisted", message: LEAD_SUCCESS_MESSAGE }));
    return noStore(NextResponse.json({ error: status }, { status: status === "rate_limited" ? 429 : 400 }));
  }
  const query = status === "joined" ? `joined=${plan}` : `waitlist_error=${status}`;
  return noStore(NextResponse.redirect(absoluteUrl(`/pricing?${query}#plan-${plan}`, request.nextUrl.origin), 303));
}
