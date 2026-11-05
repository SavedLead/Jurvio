import type { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_DAYS, SIGNED_IN_HINT_COOKIE } from "../domain/tokens";

/** Sets (or clears) the non-HttpOnly "signed in" hint to match the session cookie on the request. */
export function setSignedInHintFromRequest(request: Pick<NextRequest, "cookies">, response: NextResponse): boolean {
  const signedIn = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  response.cookies.set(SIGNED_IN_HINT_COOKIE, signedIn ? "1" : "", {
    httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: signedIn ? SESSION_TTL_DAYS * 24 * 60 * 60 : 0,
  });
  return signedIn;
}
