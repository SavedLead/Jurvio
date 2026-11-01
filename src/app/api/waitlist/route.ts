import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { joinWaitlist } from "@/modules/accounts/application/billing";
import { getSessionUser } from "@/modules/accounts/application/sign-in";
import { isPlanId } from "@/modules/accounts/domain/plans";
import { SESSION_COOKIE } from "@/modules/accounts/domain/tokens";
import { absoluteUrl } from "@/modules/accounts/http/config";
import { isSameOriginRequest, noStore, readBody, wantsJson } from "@/modules/accounts/http/request";

export const dynamic = "force-dynamic";

// "Coming soon / join waitlist" on /pricing while checkout is disabled.
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return noStore(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  const body = await readBody(request);
  const plan = body.plan;
  if (!isPlanId(plan) || plan === "free") return noStore(NextResponse.json({ error: "invalid_plan" }, { status: 400 }));
  const sql = db();
  const user = await getSessionUser(sql, request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    if (wantsJson(request)) return noStore(NextResponse.json({ error: "signin_required" }, { status: 401 }));
    return noStore(NextResponse.redirect(absoluteUrl(`/signin?next=${encodeURIComponent("/pricing")}`, request.nextUrl.origin), 303));
  }
  await joinWaitlist(sql, user.userId, plan);
  if (wantsJson(request)) return noStore(NextResponse.json({ ok: true, plan }));
  return noStore(NextResponse.redirect(absoluteUrl(`/pricing?joined=${plan}`, request.nextUrl.origin), 303));
}
