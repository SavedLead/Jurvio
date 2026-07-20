import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicDocketEntries } from "@/modules/cases/application/list-public-case-sections";
import { CaseNav } from "@/modules/cases/ui/case-nav";

export const dynamic = "force-dynamic";

export default async function DocketPage({ params }: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const legalCase = await getPublicCase(db(), caseId);
  if (!legalCase) notFound();
  const records = await listPublicDocketEntries(db(), caseId);

  return (
    <main className="shell">
      <p className="eyebrow">{legalCase.courtName}</p>
      <h1>{legalCase.caption}</h1>
      <CaseNav caseId={caseId} />
      <section>
        <h2>Full docket</h2>
        {records.length === 0 ? <p>No docket entries are approved for publication.</p> : (
          <ol>{records.map((entry) => (
            <li key={entry.publicId}>
              <strong>{entry.entryNumber ? "Entry " + entry.entryNumber : "Docket entry"}</strong>
              {entry.filedOn ? " · " + entry.filedOn : ""}
              <p>{entry.description}</p>
            </li>
          ))}</ol>
        )}
      </section>
    </main>
  );
}
