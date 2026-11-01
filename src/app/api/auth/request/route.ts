import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requestSignIn } from "@/modules/accounts/application/sign-in";
import { absoluteUrl, signInDeps } from "@/modules/accounts/http/config";
import { clientIp, isSameOriginRequest, noStore, readBody, wantsJson } from "@/modules/accounts/http/request";

export const dynamic = "force-dynamic";

const HTTP_STATUS = { sent: 200, logged: 200, invalid: 400, rate_limited: 429, unavailable: 503 } as const;

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return noStore(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  const body = await readBody(request);
  let status: keyof typeof HTTP_STATUS;
  try {
    status = await requestSignIn(db(), {
      email: body.email,
      ip: clientIp(request),
      redirectPath: body.next,
      followCasePublicId: body.follow,
    }, signInDeps());
  } catch (error) {
    console.error(JSON.stringify({ signin: "request_failed", error: error instanceof Error ? error.message : "error" }));
    status = "unavailable";
  }
  if (wantsJson(request)) return noStore(NextResponse.json({ status }, { status: HTTP_STATUS[status] }));
  const target = new URLSearchParams();
  if (status === "sent" || status === "logged") target.set("sent", "1");
  else target.set("error", status);
  if (typeof body.next === "string" && body.next) target.set("next", body.next.slice(0, 300));
  if (typeof body.follow === "string" && body.follow) target.set("follow", body.follow.slice(0, 80));
  return noStore(NextResponse.redirect(absoluteUrl(`/signin?${target}`, request.nextUrl.origin), 303));
}
