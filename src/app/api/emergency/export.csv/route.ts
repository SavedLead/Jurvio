import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { listEmergencyApplications } from "@/modules/scotus/application/emergency-docket";
import { APPLICANT_KIND_LABEL, APPLICATION_KIND_LABEL, EVENT_LABEL, STATUS_LABEL } from "@/modules/scotus/domain/emergency-application";
import { csvCell, emergencyProGate, proGateRedirect } from "@/modules/scotus/http/emergency-pro";
import { siteOrigin } from "@/lib/config/site-url";

export const dynamic = "force-dynamic";

/** Pro: every emergency application Jurvio holds (extensions with ?extensions=1). */
export async function GET(request: Request) {
  const gate = await emergencyProGate();
  if (!gate.ok) return proGateRedirect(gate, request, "/supreme-court/emergency");
  const extensions = new URL(request.url).searchParams.get("extensions") === "1";
  const data = await listEmergencyApplications(db(), { status: "all", extensions, applicant: null, kind: null, limit: 500 });
  if (!data) return new NextResponse("The emergency docket is not available right now.", { status: 503, headers: { "Cache-Control": "no-store" } });
  const origin = siteOrigin();
  const header = ["docket_number", "caption", "request_type", "capital", "applicant_type", "status", "submitted_to", "expected_circuit_justice",
    "filed_on", "docketed_on", "referred_on", "response_due_on", "response_due_text", "response_filed_on", "administrative_stay_on", "ruling_on", "noted_votes",
    "amicus_briefs", "lower_court", "latest_event", "latest_event_on", "jurvio_url"];
  const lines = [header.join(",")];
  for (const row of data.rows) {
    lines.push([row.docketNumber, row.caption, APPLICATION_KIND_LABEL[row.kind], row.capital ? "yes" : "no", APPLICANT_KIND_LABEL[row.applicantKind],
      STATUS_LABEL[row.status], row.submittedJustice, row.expectedJustice, row.submittedOn, row.docketedOn, row.referredOn, row.responseDueOn,
      row.responseDueText, row.responseFiledOn, row.adminStayOn, row.rulingOn, row.notedVotes, row.amicusCount, row.lowerCourt,
      row.lastEvent ? EVENT_LABEL[row.lastEvent.kind] : null, row.lastEvent?.filedOn ?? null,
      `${origin}/supreme-court/emergency/${row.docketNumber}`].map(csvCell).join(","));
  }
  return new NextResponse(`${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jurvio-emergency-docket-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
