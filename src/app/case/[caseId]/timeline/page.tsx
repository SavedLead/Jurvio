import { notFound } from "next/navigation";\nimport { headers } from "next/headers";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicDocketEntries } from "@/modules/cases/application/list-public-case-sections";
import { CaseHeader } from "@/modules/cases/ui/case-header";\nimport { recordDemandEvent } from "@/modules/demand/application/record-demand-event";

export const dynamic = "force-dynamic";

export default async function TimelinePage({ params }: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const legalCase = await getPublicCase(db(), caseId);
  if (!legalCase) notFound();
  const records = await listPublicDocketEntries(db(), caseId);
  const requestHeaders = await headers();
  await recordDemandEvent(db(), {
    eventType: "page_view",
    userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"),
    path: `/case/${caseId}/timeline`,
    contentKind: "case",
    targetType: "case",
    targetPublicId: caseId,
  });

  return (
    <main className="shell caseShell">
      <CaseHeader
        caseId={caseId}
        caption={legalCase.caption}
        courtName={legalCase.courtName}
        docketNumber={legalCase.docketNumber}
        filedOn={legalCase.filedOn}
      />
      <section className="contentSection">
        <p className="sectionKicker">Newest first</p>
        <h2>Case timeline</h2>
        {records.length === 0 ? (
          <p className="emptyState">No timeline events are approved for publication.</p>
        ) : (
          <ol className="recordList">
            {[...records].reverse().map((event) => (
              <li key={event.publicId}>
                <time>{event.filedOn ?? "Date unavailable"}</time>
                <p>{event.description}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
