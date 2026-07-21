import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicDocketEntries } from "@/modules/cases/application/list-public-case-sections";
import { CaseHeader } from "@/modules/cases/ui/case-header";

export const dynamic = "force-dynamic";

export default async function DocketPage({ params }: {
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
        <p className="sectionKicker">Official activity</p>
        <h2>Full docket</h2>
        {records.length === 0 ? (
          <p className="emptyState">No docket entries are approved for publication.</p>
        ) : (
          <ol className="recordList">
            {records.map((entry) => (
              <li key={entry.publicId}>
                <strong>{entry.entryNumber ? "Entry " + entry.entryNumber : "Docket entry"}</strong>
                {entry.filedOn ? " · " + entry.filedOn : ""}
                <p>{entry.description}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
