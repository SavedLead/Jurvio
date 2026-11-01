import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { revokeSession } from "@/modules/accounts/application/sign-in";
import { SESSION_COOKIE } from "@/modules/accounts/domain/tokens";
import { absoluteUrl } from "@/modules/accounts/http/config";
import { clearSessionCookies, isSameOriginRequest, noStore } from "@/modules/accounts/http/request";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return noStore(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  await revokeSession(db(), request.cookies.get(SESSION_COOKIE)?.value).catch(() => undefined);
  const response = NextResponse.redirect(absoluteUrl("/", request.nextUrl.origin), 303);
  clearSessionCookies(response);
  return noStore(response);
}
