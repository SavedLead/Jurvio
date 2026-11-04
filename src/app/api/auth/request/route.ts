import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requestSignIn } from "@/modules/accounts/application/sign-in";
import { followKindsToBits, parseFollowKinds } from "@/modules/accounts/application/follows";
import { captureLead, honeypotTripped, LEAD_SUCCESS_MESSAGE, type LeadStatus } from "@/modules/accounts/application/waitlist";
import { safeCasePublicId, safeRedirectPath } from "@/modules/accounts/domain/tokens";
import { absoluteUrl, signInDeps } from "@/modules/accounts/http/config";
import { attributionFromCookies } from "@/modules/growth/attribution";
import { clientIp, isSameOriginRequest, noStore, readBody, wantsJson } from "@/modules/accounts/http/request";

export const dynamic = "force-dynamic";

type Status = "sent" | "logged" | "waitlisted" | "invalid" | "rate_limited" | "unavailable";
const HTTP_STATUS: Record<Status, number> = { sent: 200, logged: 200, waitlisted: 200, invalid: 400, rate_limited: 429, unavailable: 503 };
const LEAD_TO_STATUS: Record<LeadStatus, Status> = { joined: "waitlisted", invalid: "invalid", rate_limited: "rate_limited" };

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return noStore(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  const body = await readBody(request);
  const sql = db();
  const ip = clientIp(request);
  const follow = safeCasePublicId(body.follow);
  // Follow box checkboxes; unticking both still follows docket activity.
  const followKindBits = followKindsToBits(parseFollowKinds(body) ?? { activity: true, citations: false });
  const attribution = attributionFromCookies(request.headers.get("cookie"));
  let status: Status;
  if (honeypotTripped(body.company)) {
    status = "waitlisted";
  } else {
    try {
      status = await requestSignIn(sql, { email: body.email, ip, redirectPath: body.next, followCasePublicId: body.follow, followKindBits, attribution }, signInDeps());
    } catch (error) {
      console.error(JSON.stringify({ signin: "request_failed", error: error instanceof Error ? error.message : "error" }));
      status = "unavailable";
    }
    // No email provider yet (or the send failed): keep the address on the
    // waitlist instead of losing it. Sign-in converts it later.
    if (status === "unavailable") {
      try {
        const lead = await captureLead(sql, follow
          ? { email: body.email, ip, source: "case_follow", casePublicId: follow, followKindBits, attribution }
          : { email: body.email, ip, source: "signin", attribution });
        status = LEAD_TO_STATUS[lead];
      } catch (error) {
        console.error(JSON.stringify({ waitlist: "capture_failed", error: error instanceof Error ? error.message : "error" }));
      }
    }
  }
  if (!honeypotTripped(body.company)) {
    await sql`INSERT INTO signin_request_event (outcome, source, signin_from_path)
      VALUES (${status}, ${typeof attribution?.source === "string" ? attribution.source : null},
        ${typeof attribution?.signinFromPath === "string" ? attribution.signinFromPath : null})`.catch(() => undefined);
  }
  if (wantsJson(request)) {
    return noStore(NextResponse.json(status === "waitlisted" ? { status, message: LEAD_SUCCESS_MESSAGE } : { status }, { status: HTTP_STATUS[status] }));
  }
  if (status === "waitlisted" && follow) {
    const back = typeof body.next === "string" && /^\/supreme-court\/emergency\/\d{2}A\d+$/.test(body.next) ? body.next : `/case/${follow}`;
    return noStore(NextResponse.redirect(absoluteUrl(`${back}?follow=waitlisted#follow`, request.nextUrl.origin), 303));
  }
  const target = new URLSearchParams();
  if (status === "sent" || status === "logged") target.set("sent", "1");
  else if (status === "waitlisted") target.set("waitlisted", "1");
  else target.set("error", status);
  if (typeof body.next === "string" && body.next) target.set("next", safeRedirectPath(body.next));
  if (follow) target.set("follow", follow);
  return noStore(NextResponse.redirect(absoluteUrl(`/signin?${target}`, request.nextUrl.origin), 303));
}
