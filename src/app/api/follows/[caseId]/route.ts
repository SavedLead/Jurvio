import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { getSessionUser } from "@/modules/accounts/application/sign-in";
import { followCase, followState, unfollowCase } from "@/modules/accounts/application/follows";
import { SESSION_COOKIE, safeCasePublicId } from "@/modules/accounts/domain/tokens";
import { isSameOriginRequest, noStore } from "@/modules/accounts/http/request";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ caseId: string }> };

async function resolve(request: NextRequest, context: Context) {
  const caseId = safeCasePublicId((await context.params).caseId);
  const sql = db();
  const user = await getSessionUser(sql, request.cookies.get(SESSION_COOKIE)?.value);
  return { caseId, sql, user };
}

const json = (body: unknown, status = 200) => noStore(NextResponse.json(body, { status }));

// Follow state is loaded by the browser so case pages stay shared and cacheable.
export async function GET(request: NextRequest, context: Context) {
  const { caseId, sql, user } = await resolve(request, context);
  if (!caseId) return json({ error: "not_found" }, 404);
  if (!user) return json({ signedIn: false });
  return json({ signedIn: true, ...(await followState(sql, user.userId, caseId)) });
}

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);
  const { caseId, sql, user } = await resolve(request, context);
  if (!caseId) return json({ error: "not_found" }, 404);
  if (!user) return json({ signedIn: false, error: "signin_required" }, 401);
  const result = await followCase(sql, user.userId, caseId);
  if (result.status === "not_eligible") return json({ signedIn: true, error: "not_eligible" }, 404);
  if (result.status === "limit_reached") return json({ signedIn: true, error: "limit_reached", ...result.state }, 409);
  return json({ signedIn: true, ...result.state });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);
  const { caseId, sql, user } = await resolve(request, context);
  if (!caseId) return json({ error: "not_found" }, 404);
  if (!user) return json({ signedIn: false, error: "signin_required" }, 401);
  return json({ signedIn: true, ...(await unfollowCase(sql, user.userId, caseId)) });
}
