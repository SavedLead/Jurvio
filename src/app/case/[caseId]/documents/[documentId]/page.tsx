import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { isPublicId } from "@/lib/ids/public-id";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { getPublicDocument } from "@/modules/cases/application/get-public-document";
import { CaseHeader } from "@/modules/cases/ui/case-header";

export const dynamic = "force-dynamic";

interface DocumentPageProps {
  params: Promise<{ caseId: string; documentId: string }>;
}

export async function generateMetadata({ params }: DocumentPageProps): Promise<Metadata> {
  const { caseId, documentId } = await params;
  if (!isPublicId("case", caseId) || !isPublicId("document", documentId)) return {};
  const document = await getPublicDocument(db(), caseId, documentId);
  if (!document) return {};

  return {
    title: document.title,
    description: "Read filing details and procedural context for " + document.title + ".",
    alternates: { canonical: "/case/" + caseId + "/documents/" + documentId },
  };
}

export default async function DocumentPage({ params }: DocumentPageProps) {
  const { caseId, documentId } = await params;
  if (!isPublicId("case", caseId) || !isPublicId("document", documentId)) notFound();

  const [legalCase, document] = await Promise.all([
    getPublicCase(db(), caseId),
    getPublicDocument(db(), caseId, documentId),
  ]);
  if (!legalCase || !document) notFound();

  return (
    <main className="shell caseShell">
      <CaseHeader
        caseId={caseId}
        caption={legalCase.caption}
        courtName={legalCase.courtName}
        docketNumber={legalCase.docketNumber}
        filedOn={legalCase.filedOn}
      />

      <article className="documentPage">
        <nav aria-label="Document breadcrumb" className="breadcrumb">
          <a href={"/case/" + caseId + "/documents"}>Documents</a>
          <span aria-hidden="true">/</span>
          <span>{document.publicId}</span>
        </nav>

        <p className="eyebrow">{document.documentType}</p>
        <h2>{document.title}</h2>
        <dl className="factList">
          <div><dt>Filed</dt><dd>{document.filedOn ?? "Date unavailable"}</dd></div>
          <div><dt>Docket entry</dt><dd>{document.docketEntryNumber ?? "Not linked"}</dd></div>
          <div><dt>Jurvio document ID</dt><dd>{document.publicId}</dd></div>
          <div><dt>Text confidence</dt><dd>{document.extractionConfidence ?? "Not available"}</dd></div>
        </dl>

        <section className="contentSection" aria-labelledby="filing-context">
          <p className="sectionKicker">Court record</p>
          <h2 id="filing-context">What this filing says</h2>
          {document.docketDescription ? (
            <p>{document.docketDescription}</p>
          ) : (
            <p className="emptyState">
              A source-backed description is not available for this filing. Jurvio will not
              invent or infer one.
            </p>
          )}
        </section>

        <section className="contentSection" aria-labelledby="plain-explanation">
          <p className="sectionKicker">Plain English</p>
          <h2 id="plain-explanation">Explanation status</h2>
          <p className="emptyState">
            This filing has not been summarized. On-demand explanations will be generated only
            after source text is available and the result passes Jurvio&apos;s review rules.
          </p>
        </section>
      </article>
    </main>
  );
}
