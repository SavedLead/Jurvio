import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { resubscribe } from "@/modules/accounts/application/alerts";
import { getSessionUser } from "@/modules/accounts/application/sign-in";
import { SESSION_COOKIE } from "@/modules/accounts/domain/tokens";
import { absoluteUrl } from "@/modules/accounts/http/config";
import { isSameOriginRequest, noStore } from "@/modules/accounts/http/request";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return noStore(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  const sql = db();
  const user = await getSessionUser(sql, request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return noStore(NextResponse.redirect(absoluteUrl("/signin?next=/account", request.nextUrl.origin), 303));
  await resubscribe(sql, user.userId);
  return noStore(NextResponse.redirect(absoluteUrl("/account", request.nextUrl.origin), 303));
}
