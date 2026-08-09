import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { INTERNAL_SESSION_COOKIE } from "@/modules/identity/cloudflare-access";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(INTERNAL_SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await db()`DELETE FROM internal_session WHERE token_hash = ${tokenHash}`;
  }

  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(INTERNAL_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
