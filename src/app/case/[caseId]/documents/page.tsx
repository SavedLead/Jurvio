import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicDocuments } from "@/modules/cases/application/list-public-case-sections";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";

export const dynamic = "force-dynamic";

interface DocumentsPageProps { params: Promise<{ caseId: string }> }

async function load(params: DocumentsPageProps["params"]) {
  const { caseId } = await params;
  const legalCase = await getPublicCase(db(), caseId);
  return legalCase ? { caseId, legalCase } : null;
}

export async function generateMetadata({ params }: DocumentsPageProps): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded) return { title: "Documents not found" };
  const caption = cleanCaseCaption(loaded.legalCase.caption);
  return {
    title: `Available documents for ${caption}`,
    description: `Verified court documents currently available for ${caption}, docket ${loaded.legalCase.docketNumber}.`,
    alternates: { canonical: `/case/${loaded.caseId}/documents` },
  };
}

export default async function DocumentsPage({ params }: DocumentsPageProps) {
  const loaded = await load(params);
  if (!loaded) notFound();
  const { caseId, legalCase } = loaded;
  const sql = db();
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
        <section className="contentSection availableDocuments">
          <p className="sectionKicker">Available court materials</p>
          <h2>Documents currently available</h2>
          <p className="sectionIntroduction">This list includes only documents Jurvio has obtained and verified. It does not claim to be the complete Supreme Court record.</p>
          <ul className="documentCards">{records.map((document) => (
            <li key={document.publicId}>
              <div>
                <span className="documentType">{document.documentType.replaceAll("_", " ")}</span>
                <h3>{document.title}</h3>
                {document.filedOn ? <time dateTime={document.filedOn}>{document.filedOn}</time> : null}
              </div>
              <div className="documentActions">
                {document.hasReadableContent ? <Link href={`/case/${caseId}/documents/${document.publicId}` as Route}>Read on Jurvio</Link> : null}
                {document.sourceDownloadUrl ? <a href={document.sourceDownloadUrl} target="_blank" rel="nofollow noopener noreferrer">Official source</a> : null}
              </div>
            </li>
          ))}</ul>
        </section>
      ) : null}
    </main>
  );
}
