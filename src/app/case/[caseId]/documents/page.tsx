import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicDocuments } from "@/modules/cases/application/list-public-case-sections";
import { CaseNav } from "@/modules/cases/ui/case-nav";
import Link from "next/link";
import type { Route } from "next";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({ params }: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const legalCase = await getPublicCase(db(), caseId);
  if (!legalCase) notFound();
  const records = await listPublicDocuments(db(), caseId);
  const requestHeaders = await headers();
  await recordDemandEvent(db(), {
    eventType: "page_view", userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"), path: `/case/${caseId}/documents`,
    contentKind: "case", targetType: "case", targetPublicId: caseId,
  });

  return (
    <main className="shell">
      <p className="eyebrow">{legalCase.courtName}</p>
      <h1>{legalCase.caption}</h1>
      <CaseNav caseId={caseId} />
      <section>
        <h2>Documents</h2>
        {records.length === 0 ? <p>No documents are approved for publication.</p> : (
          <ul>{records.map((document) => (
            <li key={document.publicId}>
              <strong>{document.hasReadableContent
                ? <Link href={`/case/${caseId}/documents/${document.publicId}` as Route}>{document.title}</Link>
                : document.title}</strong>
              {document.filedOn ? " · " + document.filedOn : ""}
              <p>{document.documentType}</p>
            </li>
          ))}</ul>
        )}
      </section>
    </main>
  );
}
