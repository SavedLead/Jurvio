import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { verifySignIn } from "@/modules/accounts/application/sign-in";
import { completeSignInIntent } from "@/modules/accounts/application/sign-in-intent";
import { absoluteUrl } from "@/modules/accounts/http/config";
import { isSameOriginRequest, noStore, readBody, setSessionCookies } from "@/modules/accounts/http/request";

export const dynamic = "force-dynamic";

// The email link opens /signin/verify, which POSTs the token here. Consuming
// only on POST keeps mail scanners that prefetch links from burning the token.
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return noStore(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  const body = await readBody(request);
  const sql = db();
  const verified = await verifySignIn(sql, body.token).catch((error) => {
    console.error(JSON.stringify({ signin: "verify_failed", error: error instanceof Error ? error.message : "error" }));
    return null;
  });
  if (!verified) return noStore(NextResponse.redirect(absoluteUrl("/signin?error=expired", request.nextUrl.origin), 303));
  const destination = await completeSignInIntent(sql, verified).catch(() => verified.redirectPath);
  const response = NextResponse.redirect(absoluteUrl(destination, request.nextUrl.origin), 303);
  setSessionCookies(response, verified.sessionToken);
  return noStore(response);
}
