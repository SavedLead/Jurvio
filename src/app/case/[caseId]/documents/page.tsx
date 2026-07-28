import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicDocuments } from "@/modules/cases/application/list-public-case-sections";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import Link from "next/link";
import type { Route } from "next";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({ params }: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const sql = db();
  const legalCase = await getPublicCase(sql, caseId);
  if (!legalCase) notFound();
  const records = await listPublicDocuments(sql, caseId);
  const requestHeaders = await headers();
  await recordDemandEvent(sql, {
    eventType: "page_view", userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"), path: `/case/${caseId}/documents`,
    contentKind: "case", targetType: "case", targetPublicId: caseId,
  });

  return (
    <main className="shell caseShell">
      <CaseHeader caseId={caseId} caption={legalCase.caption} courtName={legalCase.courtName}
        docketNumber={legalCase.docketNumber} filedOn={legalCase.filedOn} />
      {records.length > 0 ? (
        <section className="contentSection">
          <p className="sectionKicker">Source material</p>
          <h2>Documents</h2>
          <ul className="recordList">{records.map((document) => (
            <li key={document.publicId}>
              <strong>{document.hasReadableContent
                ? <Link href={`/case/${caseId}/documents/${document.publicId}` as Route}>{document.title}</Link>
                : document.sourceDownloadUrl
                  ? <a href={document.sourceDownloadUrl} target="_blank" rel="noreferrer">{document.title}</a>
                  : document.title}</strong>
              {document.filedOn ? " · " + document.filedOn : ""}
              <p>{document.documentType.replaceAll("_", " ")}</p>
            </li>
          ))}</ul>
        </section>
      ) : null}
    </main>
  );
}
