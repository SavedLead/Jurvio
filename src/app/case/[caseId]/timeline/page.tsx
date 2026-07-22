import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicDocketEntries } from "@/modules/cases/application/list-public-case-sections";
import { CaseHeader } from "@/modules/cases/ui/case-header";

export const dynamic = "force-dynamic";

export default async function TimelinePage({ params }: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const legalCase = await getPublicCase(db(), caseId);
  if (!legalCase) notFound();
  const records = await listPublicDocketEntries(db(), caseId);

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
