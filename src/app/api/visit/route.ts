import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { isSameOriginRequest, noStore, readBody } from "@/modules/accounts/http/request";
import { classifyVisitor } from "@/modules/demand/domain/classify-visitor";
import { isTrackablePublicPath, parseFirstTouch } from "@/modules/growth/attribution";

export const dynamic = "force-dynamic";

/** First human visit beacon. Bots (existing visitor_class logic) and headless browsers are dropped. */
export async function POST(request: NextRequest) {
  const done = () => noStore(new NextResponse(null, { status: 204 }));
  if (!isSameOriginRequest(request)) return done();
  const ua = request.headers.get("user-agent");
  if (classifyVisitor(ua).visitorClass !== "human" || /HeadlessChrome|Lighthouse|PhantomJS/i.test(ua ?? "")) return done();
  const ft = parseFirstTouch(await readBody(request));
  if (!ft || !isTrackablePublicPath(ft.landingPath)) return done();
  try {
    await db()`
      INSERT INTO visitor_first_touch (source, referrer_host, landing_path, utm_source, utm_medium, utm_campaign)
      VALUES (${ft.source}, ${ft.referrerHost}, ${ft.landingPath}, ${ft.utmSource}, ${ft.utmMedium}, ${ft.utmCampaign})`;
  } catch (error) {
    console.error(JSON.stringify({ visit: "record_failed", error: error instanceof Error ? error.message : "error" }));
  }
  return done();
}
