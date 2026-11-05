import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/modules/accounts/domain/tokens";
import { noStore } from "@/modules/accounts/http/request";
import { setSignedInHintFromRequest } from "@/modules/accounts/http/signed-in-hint";

export const dynamic = "force-dynamic";

// Edge-cached pages can reach a signed-in browser that has a session cookie but
// no hint cookie (sessions from before the hint existed). The header asks here
// once per tab session, and this response sets the hint directly. It checks
// cookie presence only (no DB read) and reveals nothing about the session.
export function GET(request: NextRequest) {
  const signedIn = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ signedIn });
  setSignedInHintFromRequest(request, response);
  return noStore(response);
}
