import type { Metadata } from "next";
import { robotsFor } from "@/lib/seo/indexing";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { loadCaseForViewer } from "@/app/case/load-public-case";
import { SubscriberCaseGate, subscriberGateMetadata } from "@/modules/accounts/ui/subscriber-gate";
import { listPublicDocketEntries } from "@/modules/cases/application/list-public-case-sections";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";
import { createTermMarker, TermText } from "@/modules/plain-english/ui/term-text";

export const dynamic = "force-dynamic";

interface SectionPageProps { params: Promise<{ caseId: string }> }

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { caseId } = await params;
  const access = await loadCaseForViewer(caseId);
  if (access.status === "missing") return { title: "Docket not found" };
  if (access.status === "gated") return subscriberGateMetadata();
  const legalCase = access.legalCase;
  const caption = cleanCaseCaption(legalCase.caption);
  return {
    title: [caption, "Docket", legalCase.docketNumber, legalCase.courtName].filter(Boolean).join(" | "),
    description: `Official docket entries currently available for ${caption}, docket ${legalCase.docketNumber}.`,
    alternates: { canonical: `/case/${caseId}/docket` },
    robots: robotsFor(!legalCase.searchExcluded),
  };
}

export default async function DocketPage({ params }: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const sql = db();
  const access = await loadCaseForViewer(caseId);
  if (access.status === "missing") notFound();
  if (access.status === "gated") return <SubscriberCaseGate path={`/case/${caseId}/docket`} />;
  const legalCase = access.legalCase;
  const records = await listPublicDocketEntries(sql, caseId);
  const requestHeaders = await headers();
  await recordDemandEvent(sql, {
    eventType: "page_view",
    userAgent: requestHeaders.get("user-agent"), headers: requestHeaders,
    referrer: requestHeaders.get("referer"),
    path: `/case/${caseId}/docket`,
    contentKind: "case",
    targetType: "case",
    targetPublicId: caseId,
  });

  const docketMarker = createTermMarker("docket");
  return (
    <main className="shell caseShell">
      <CaseHeader caseId={caseId} caption={legalCase.caption} courtName={legalCase.courtName}
        docketNumber={legalCase.docketNumber} filedOn={legalCase.filedOn}
        decidedOn={legalCase.decidedOn} courtCode={legalCase.courtCode} />
      {records.length > 0 ? (
        <section className="contentSection">
          <p className="sectionKicker">Official activity</p>
          <h2>Full docket</h2>
          <ol className="recordList">
            {records.map((entry) => (
              // One marker for the whole docket: each term is underlined at its first mention.
              <li key={entry.publicId} id={`entry-${entry.publicId}`}>
                <strong>{entry.entryNumber ? "Entry " + entry.entryNumber : "Docket entry"}</strong>
                {entry.filedOn ? " · " + entry.filedOn : ""}
                <p><TermText text={entry.description} marker={docketMarker} /></p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}
