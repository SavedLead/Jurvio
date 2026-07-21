import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicDocuments } from "@/modules/cases/application/list-public-case-sections";
import { CaseHeader } from "@/modules/cases/ui/case-header";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({ params }: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const legalCase = await getPublicCase(db(), caseId);
  if (!legalCase) notFound();
  const records = await listPublicDocuments(db(), caseId);

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
        <p className="sectionKicker">Case record</p>
        <h2>Documents and filings</h2>
        {records.length === 0 ? (
          <p className="emptyState">No documents are approved for publication.</p>
        ) : (
          <ul className="recordList">
            {records.map((document) => (
              <li key={document.publicId}>
                <Link href={("/case/" + caseId + "/documents/" + document.publicId) as Route}>
                  <strong>{document.title}</strong>
                </Link>
                {document.filedOn ? " · " + document.filedOn : ""}
                <p>{document.documentType}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
