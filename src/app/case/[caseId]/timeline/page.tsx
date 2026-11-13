import type { Metadata } from "next";
import { robotsFor } from "@/lib/seo/indexing";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { loadCaseForViewer } from "@/app/case/load-public-case";
import { SubscriberCaseGate, subscriberGateMetadata } from "@/modules/accounts/ui/subscriber-gate";
import { countPublicDocketEntries, countPublicOrderEntries, docketPageWindow, listPublicDocketEntries, listPublicOrderEntries, listPublicParties } from "@/modules/cases/application/list-public-case-sections";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { CaseRecordFacts } from "@/modules/cases/ui/case-record-facts";
import { DocketEntriesSection } from "@/modules/cases/ui/docket-entries-section";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";
import { createTermMarker } from "@/modules/plain-english/ui/term-text";

export const dynamic = "force-dynamic";

interface SectionPageProps { params: Promise<{ caseId: string }> }

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { caseId } = await params;
  const access = await loadCaseForViewer(caseId);
  if (access.status === "missing") return { title: "Timeline not found" };
  if (access.status === "gated") return subscriberGateMetadata();
  const legalCase = access.legalCase;
  const caption = cleanCaseCaption(legalCase.caption);
  return {
    title: [caption, "Timeline", legalCase.docketNumber, legalCase.courtName].filter(Boolean).join(" | "),
    description: `Verified case timeline events currently available for ${caption}, docket ${legalCase.docketNumber}.`,
    alternates: { canonical: `/case/${caseId}/timeline` },
    robots: robotsFor(!legalCase.searchExcluded, legalCase.redacted),
  };
}

export default async function TimelinePage({ params, searchParams }: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { caseId } = await params;
  const pageWindow = docketPageWindow(Number.parseInt((await searchParams).page ?? "1", 10));
  const sql = db();
  const access = await loadCaseForViewer(caseId);
  if (access.status === "missing") notFound();
  if (access.status === "gated") return <SubscriberCaseGate path={`/case/${caseId}/timeline`} />;
  const legalCase = access.legalCase;
  const [records, total, orders, orderCount, parties] = await Promise.all([
    listPublicDocketEntries(sql, caseId, pageWindow.limit, pageWindow.offset),
    countPublicDocketEntries(sql, caseId),
    listPublicOrderEntries(sql, caseId),
    countPublicOrderEntries(sql, caseId),
    listPublicParties(sql, caseId).catch(() => []),
  ]);
  const requestHeaders = await headers();
  await recordDemandEvent(sql, {
    eventType: "page_view", userAgent: requestHeaders.get("user-agent"), headers: requestHeaders,
    referrer: requestHeaders.get("referer"), path: `/case/${caseId}/timeline`,
    contentKind: "case", targetType: "case", targetPublicId: caseId,
  });

  const timelineMarker = createTermMarker("timeline");
  return (
    <main className="shell caseShell">
      <CaseHeader caseId={caseId} caption={legalCase.caption} courtName={legalCase.courtName}
        docketNumber={legalCase.docketNumber} filedOn={legalCase.filedOn}
        decidedOn={legalCase.decidedOn} courtCode={legalCase.courtCode} />
      <CaseRecordFacts caseId={caseId} legalCase={legalCase} />
      <DocketEntriesSection caseId={caseId} path="timeline" title="Case timeline" entries={records}
        total={total} orderCount={orderCount} orders={orders}
        partyNames={parties.flatMap((party) => [party.displayName, party.nameAsFiled])}
        page={pageWindow.page} marker={timelineMarker} />
    </main>
  );
}
