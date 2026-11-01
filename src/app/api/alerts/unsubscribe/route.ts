import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { unsubscribeByToken } from "@/modules/accounts/application/alerts";
import { absoluteUrl } from "@/modules/accounts/http/config";
import { noStore, readBody, wantsJson } from "@/modules/accounts/http/request";

export const dynamic = "force-dynamic";

// Both the unsubscribe page form and RFC 8058 one-click (mail client POSTs
// "List-Unsubscribe=One-Click" to the URL carrying ?token=). The token is
// random and per user, so no session or Origin check is needed here.
export async function POST(request: NextRequest) {
  const body = await readBody(request);
  const token = request.nextUrl.searchParams.get("token") ?? body.token;
  const ok = await unsubscribeByToken(db(), token).catch(() => false);
  if (wantsJson(request) || body["List-Unsubscribe"] === "One-Click") {
    return noStore(NextResponse.json({ ok }, { status: ok ? 200 : 404 }));
  }
  return noStore(NextResponse.redirect(absoluteUrl(ok ? "/alerts/unsubscribe?done=1" : "/alerts/unsubscribe", request.nextUrl.origin), 303));
}
