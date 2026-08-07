import { db } from "@/db/client";
import { sitePubliclyLaunched } from "@/lib/seo/indexing";
import { siteOrigin } from "@/lib/config/site-url";
import { getMachineCase } from "@/modules/discovery/application/get-machine-case";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!/^jv-[a-z0-9]{8,10}$/.test(caseId)) return Response.json({ error: "not_found" }, { status: 404 });
  const record = await getMachineCase(db(), caseId);
  if (!record) return Response.json({ error: "not_found" }, { status: 404 });
  await recordDemandEvent(db(), {
    eventType: "page_view",
    userAgent: request.headers.get("user-agent"),
    referrer: request.headers.get("referer"),
    path: `/case/${caseId}/ai.json`,
    channel: "machine_json",
    contentKind: "machine_record",
    targetType: "case",
    targetPublicId: caseId,
  });
  const origin = siteOrigin();
  return Response.json({
    schemaVersion: "jurvio.case.v1",
    canonicalUrl: `${origin}/case/${record.publicId}`,
    sourceType: "public_court_record",
    generatedCommentary: false,
    case: {
      id: record.publicId,
      caption: record.caption,
      docketNumber: record.docketNumber,
      court: record.courtName,
      filedOn: record.filedOn,
      currentStatus: {
        activity: record.activityState,
        proceduralPhase: record.proceduralPhase,
        dispositionScope: record.dispositionScope,
        judgment: record.judgmentState,
        appeal: record.appealState,
        verification: record.verification,
        explanation: record.statusExplanation,
        ruleVersion: record.statusRuleVersion,
      },
      documents: record.documents.map((document) => ({
        ...document,
        url: `${origin}/case/${record.publicId}/documents/${document.publicId}`,
      })),
    },
  }, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "X-Robots-Tag": sitePubliclyLaunched() ? "index, follow" : "noindex, nofollow, noarchive, nosnippet, noimageindex",
    },
  });
}
