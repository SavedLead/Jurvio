import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { getSessionUser } from "@/modules/accounts/application/sign-in";
import {
  entityFollowState, followEntity, resolveEntityTarget, unfollowEntity, updateEntityFollowById,
} from "@/modules/accounts/application/entity-follows";
import { isEntityFrequency, isEntityKind } from "@/modules/accounts/domain/entity-follow";
import { SESSION_COOKIE } from "@/modules/accounts/domain/tokens";
import { isSameOriginRequest, noStore, readBody, wantsJson } from "@/modules/accounts/http/request";

export const dynamic = "force-dynamic";

// Judge / topic / party follows. The browser sends { kind, target } where
// target is the judge public id, topic slug or party entity public id it was
// shown; the server resolves it and checks it is public.
//   GET    ?kind=&target=          -> follow state (signed-in) or { signedIn: false }
//   POST   { kind, target, frequency } -> follow / change frequency
//   DELETE { kind, target }            -> unfollow
//   POST   { id, frequency } / { id, remove: "1" } (My alerts form posts; redirects back)

const json = (body: unknown, status = 200) => noStore(NextResponse.json(body, { status }));

async function session(request: NextRequest) {
  const sql = db();
  const user = await getSessionUser(sql, request.cookies.get(SESSION_COOKIE)?.value);
  return { sql, user };
}

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind");
  const raw = request.nextUrl.searchParams.get("target");
  if (!isEntityKind(kind)) return json({ error: "bad_request" }, 400);
  const { sql, user } = await session(request);
  if (!user) return json({ signedIn: false });
  const target = await resolveEntityTarget(sql, kind, raw);
  if (!target) return json({ signedIn: true, error: "not_found" }, 404);
  return json({ signedIn: true, label: target.label, ...(await entityFollowState(sql, user.userId, target)) });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);
  const body = await readBody(request);
  const { sql, user } = await session(request);
  const formPost = !wantsJson(request);
  if (!user) return formPost ? NextResponse.redirect(new URL("/signin?next=/alerts", request.url), 303) : json({ signedIn: false, error: "signin_required" }, 401);

  // My alerts form: change frequency or remove by follow id.
  if (typeof body.id === "string") {
    const remove = body.remove === "1" || body.remove === "true" || body.remove === true;
    const frequency = isEntityFrequency(body.frequency) ? body.frequency : undefined;
    const ok = await updateEntityFollowById(sql, user.userId, body.id, { remove, frequency });
    return formPost ? noStore(NextResponse.redirect(new URL(`/alerts?${ok ? (remove ? "removed=1" : "saved=1") : "error=1"}`, request.url), 303))
      : json({ ok }, ok ? 200 : 404);
  }

  if (!isEntityKind(body.kind)) return json({ error: "bad_request" }, 400);
  const target = await resolveEntityTarget(sql, body.kind, body.target);
  if (!target) return json({ signedIn: true, error: "not_found" }, 404);
  const frequency = isEntityFrequency(body.frequency) ? body.frequency : "daily";
  const result = await followEntity(sql, user.userId, target, frequency);
  if (result.status === "limit_reached") return json({ signedIn: true, error: "limit_reached", label: target.label, ...result.state }, 409);
  if (result.status === "paid_required") return json({ signedIn: true, error: "paid_required", label: target.label, ...result.state }, 402);
  return json({ signedIn: true, status: result.status, label: target.label, ...result.state });
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);
  const body = await readBody(request);
  const { sql, user } = await session(request);
  if (!user) return json({ signedIn: false, error: "signin_required" }, 401);
  if (!isEntityKind(body.kind)) return json({ error: "bad_request" }, 400);
  const target = await resolveEntityTarget(sql, body.kind, body.target);
  if (!target) return json({ signedIn: true, error: "not_found" }, 404);
  return json({ signedIn: true, label: target.label, ...(await unfollowEntity(sql, user.userId, target)) });
}
