import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import { listResponseDeadlines } from "@/modules/scotus/application/emergency-docket";
import { emergencyProGate, icsEscape, icsFold, proGateRedirect } from "@/modules/scotus/http/emergency-pro";

export const dynamic = "force-dynamic";

/**
 * Pro: response deadlines for pending emergency applications as an all-day
 * calendar (.ics download). ?followed=1 limits it to applications you follow.
 */
export async function GET(request: Request) {
  const gate = await emergencyProGate();
  if (!gate.ok) return proGateRedirect(gate, request, "/supreme-court/emergency");
  const followedOnly = new URL(request.url).searchParams.get("followed") === "1";
  const rows = await listResponseDeadlines(db(), { userId: gate.userId, followedOnly });
  const origin = siteOrigin();
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Jurvio//Emergency docket deadlines//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Supreme Court emergency response deadlines"];
  for (const row of rows) {
    const day = row.responseDueOn.replace(/-/g, "");
    const next = new Date(Date.parse(`${row.responseDueOn}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
    const url = `${origin}/supreme-court/emergency/${row.docketNumber}`;
    lines.push("BEGIN:VEVENT", `UID:emergency-${row.docketNumber}-${day}@jurvio.com`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${icsEscape(`Response due: ${row.caption} (No. ${row.docketNumber})`)}`,
      `DESCRIPTION:${icsEscape([row.responseDueText ? `Due ${row.responseDueText}.` : null, row.requestedBy ? `Requested by ${/chief/i.test(row.requestedBy) ? "the Chief Justice" : `Justice ${row.requestedBy}`}.` : null, url].filter(Boolean).join(" "))}`,
      `URL:${url}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new NextResponse(`${lines.map(icsFold).join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="jurvio-emergency-deadlines.ics"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
