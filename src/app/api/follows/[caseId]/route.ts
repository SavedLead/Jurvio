import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { getSessionUser } from "@/modules/accounts/application/sign-in";
import { followCase, followState, parseFollowKinds, unfollowCase } from "@/modules/accounts/application/follows";
import { SESSION_COOKIE, safeCasePublicId } from "@/modules/accounts/domain/tokens";
import { isSameOriginRequest, noStore, readBody } from "@/modules/accounts/http/request";

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
  // Body { activity, citations } sets the follow's kinds (Follow box toggles);
  // an empty body follows docket activity. Both off unfollows.
  const kinds = parseFollowKinds(await readBody(request));
  if (!kinds) return json({ signedIn: true, ...(await unfollowCase(sql, user.userId, caseId)) });
  const result = await followCase(sql, user.userId, caseId, kinds);
  if (result.status === "not_eligible") return json({ signedIn: true, error: "not_eligible" }, 404);
  if (result.status === "limit_reached") return json({ signedIn: true, error: "limit_reached", ...result.state }, 409);
  let refresh: { outcome: string; courtListenerCalls: number; freeFilled: boolean; elapsedMs: number } | null = null;
  if (result.status === "followed") {
    const [legalCase] = await sql<{ id: string }[]>`SELECT id FROM legal_case WHERE public_id = ${caseId}`;
    if (legalCase) {
      const [ready] = await sql<{ ok: boolean }[]>`
        SELECT to_regclass('public.followed_item_priority') IS NOT NULL AS ok
      `;
      if (ready?.ok) {
        await sql`
          UPDATE followed_item_priority SET due_at = now() + interval '20 minutes', updated_at = now()
          WHERE case_id = ${legalCase.id}
        `;
      }
      const started = Date.now();
      const pending = (async () => {
        const { refreshFollowedCase } = await import("@/modules/ingestion/application/follow-refresh");
        const { createArtifactStore } = await import("@/modules/ingestion/infrastructure/create-artifact-store");
        return refreshFollowedCase(
          sql,
          createArtifactStore({ localRoot: process.env.JURVIO_ARTIFACT_ROOT ?? ".data/artifacts" }),
          legalCase.id,
        );
      })().catch(() => null);
      const finished = await Promise.race([
        pending,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
      ]);
      void pending.then(async (done) => {
        if (!done || done.outcome === "quota") return;
        const [ready] = await sql<{ ok: boolean }[]>`
          SELECT to_regclass('public.followed_item_priority') IS NOT NULL AS ok
        `;
        if (!ready?.ok) return;
        await sql`
          UPDATE followed_item_priority
          SET last_refresh_at = now(), due_at = now() + interval '15 minutes', last_error = NULL, updated_at = now()
          WHERE case_id = ${legalCase.id}
        `;
      }).catch(() => undefined);
      refresh = finished ?? { outcome: "queued", courtListenerCalls: 0, freeFilled: false, elapsedMs: Date.now() - started };
    }
  }
  return json({ signedIn: true, ...result.state, refresh });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);
  const { caseId, sql, user } = await resolve(request, context);
  if (!caseId) return json({ error: "not_found" }, 404);
  if (!user) return json({ signedIn: false, error: "signin_required" }, 401);
  return json({ signedIn: true, ...(await unfollowCase(sql, user.userId, caseId)) });
}
