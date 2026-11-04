import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { isSameOriginRequest, noStore, readBody } from "@/modules/accounts/http/request";
import { SESSION_ID_COOKIE, VISITOR_ID_COOKIE, analyticsPathTemplate, cookieId } from "@/modules/demand/application/record-demand-event";
import { classifyVisitor } from "@/modules/demand/domain/classify-visitor";
import { FIRST_TOUCH_COOKIE, cleanPath, isTrackablePublicPath, normalizeHost, parseFirstTouch, readCookie } from "@/modules/growth/attribution";

export const dynamic = "force-dynamic";

/**
 * Browser page-view beacon. Only runs after JavaScript executed on a public page, and
 * drops anything the visitor classifier (UA lists, browser headers, Cloudflare signals)
 * does not call human. Stores salted hashes of the first-party ids, never the ids.
 */
export async function POST(request: NextRequest) {
  const done = () => noStore(new NextResponse(null, { status: 204 }));
  if (!isSameOriginRequest(request) || request.headers.get("sec-fetch-site") === "cross-site") return done();
  const visitor = classifyVisitor(request.headers.get("user-agent"), { headers: request.headers });
  if (visitor.visitorClass !== "human") return done();
  const body = await readBody(request);
  const path = cleanPath(body.path ?? body.l);
  if (!isTrackablePublicPath(path)) return done();
  const vid = cookieId(request.headers, VISITOR_ID_COOKIE);
  const sid = cookieId(request.headers, SESSION_ID_COOKIE);
  if (!vid) return done();
  const first = body.first === true ? parseFirstTouch(body) : null;
  const touch = first ?? parseFirstTouch(readCookie(request.headers.get("cookie"), FIRST_TOUCH_COOKIE));
  try {
    const sql = db();
    await sql`
      INSERT INTO demand_event (event_type, visitor_class, referrer_host, visitor_hash, session_hash, metadata)
      VALUES ('page_view', 'human', ${normalizeHost(body.r)}, demand_id_hash('visitor', ${vid}), demand_id_hash('session', ${sid}),
        ${sql.json({ channel: "beacon", pathTemplate: analyticsPathTemplate(path), firstSource: touch?.source ?? "direct", privacyVersion: "first-party-minimal-v3" })})`;
    if (first) {
      await sql`
        INSERT INTO visitor_first_touch (source, referrer_host, landing_path, utm_source, utm_medium, utm_campaign, visitor_hash)
        VALUES (${first.source}, ${first.referrerHost}, ${first.landingPath}, ${first.utmSource}, ${first.utmMedium}, ${first.utmCampaign},
          demand_id_hash('visitor', ${vid}))`;
    }
  } catch (error) {
    console.error(JSON.stringify({ visit: "record_failed", error: error instanceof Error ? error.message : "error" }));
  }
  return done();
}
