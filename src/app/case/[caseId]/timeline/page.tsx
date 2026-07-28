import type { Metadata } from "next";\nimport { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicDocketEntries } from "@/modules/cases/application/list-public-case-sections";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";\nimport { CaseHeader } from "@/modules/cases/ui/case-header";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";

export const dynamic = "force-dynamic";

interface SectionPageProps { params: Promise<{ caseId: string }> }

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { caseId } = await params;
  const legalCase = await getPublicCase(db(), caseId);
  if (!legalCase) return { title: "Timeline not found" };
  const caption = cleanCaseCaption(legalCase.caption);
  return {
    title: `Timeline for ${caption}`,
    description: `Verified case timeline events currently available for ${caption}, docket ${legalCase.docketNumber}.`,
    alternates: { canonical: `/case/${caseId}/timeline` },
  };
}

export default async function TimelinePage({ params }: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const sql = db();
  const legalCase = await getPublicCase(sql, caseId);
  if (!legalCase) notFound();
  const records = await listPublicDocketEntries(sql, caseId);
  const requestHeaders = await headers();
  await recordDemandEvent(sql, {
    eventType: "page_view", userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"), path: `/case/${caseId}/timeline`,
    contentKind: "case", targetType: "case", targetPublicId: caseId,
  });

  return (
    <main className="shell caseShell">
      <CaseHeader caseId={caseId} caption={legalCase.caption} courtName={legalCase.courtName}
        docketNumber={legalCase.docketNumber} filedOn={legalCase.filedOn} />
      {records.length > 0 ? (
        <section className="contentSection">
          <p className="sectionKicker">Newest first</p>
          <h2>Case timeline</h2>
          <ol className="recordList">
            {records.map((event) => (
              <li key={event.publicId}>
                {event.filedOn ? <time>{event.filedOn}</time> : null}
                <p>{event.description}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}
