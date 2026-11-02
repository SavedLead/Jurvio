import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { db } from "@/db/client";
import { loadCaseForViewer } from "@/app/case/load-public-case";
import { SubscriberCaseGate, subscriberGateMetadata } from "@/modules/accounts/ui/subscriber-gate";
import { listPublicDocuments } from "@/modules/cases/application/list-public-case-sections";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import {
  officialOpinionNotice,
  opinionTextIsPending,
} from "@/modules/cases/domain/opinion-availability";
import { robotsFor } from "@/lib/seo/indexing";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";
import { publicDocumentType } from "@/modules/cases/domain/public-labels";
import { formatPublicCaseDate } from "@/modules/cases/domain/scotus-display";

export const dynamic = "force-dynamic";

interface DocumentsPageProps { params: Promise<{ caseId: string }> }

async function load(params: DocumentsPageProps["params"]) {
  const { caseId } = await params;
  const access = await loadCaseForViewer(caseId);
  if (access.status === "missing") return null;
  if (access.status === "gated") return { caseId, gated: true as const };
  return { caseId, gated: false as const, legalCase: access.legalCase };
}

export async function generateMetadata({ params }: DocumentsPageProps): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded) return { title: "Documents not found" };
  if (loaded.gated) return subscriberGateMetadata();
  const caption = cleanCaseCaption(loaded.legalCase.caption);
  return {
    title: [caption, "Documents", loaded.legalCase.docketNumber, loaded.legalCase.courtName].filter(Boolean).join(" | "),
    description: `Verified court documents currently available for ${caption}, docket ${loaded.legalCase.docketNumber}.`,
    alternates: { canonical: `/case/${loaded.caseId}/documents` },
    robots: robotsFor(loaded.legalCase.hasReadableOpinion && !loaded.legalCase.searchExcluded),
  };
}

export default async function DocumentsPage({ params }: DocumentsPageProps) {
  const loaded = await load(params);
  if (!loaded) notFound();
  if (loaded.gated) return <SubscriberCaseGate path={`/case/${loaded.caseId}/documents`} />;
  const { caseId, legalCase } = loaded;
  const sql = db();
  const records = await listPublicDocuments(sql, caseId);
  // No opinion text to show: link the official copy, or say nothing.
  const opinionNotice = opinionTextIsPending(legalCase.hasReadableOpinion) && legalCase.decidedOn
    && (legalCase.courtKind === "supreme" || legalCase.courtKind === "appellate")
    ? officialOpinionNotice(records.find((document) => document.sourceDownloadUrl)?.sourceDownloadUrl)
    : null;
  const requestHeaders = await headers();
  await recordDemandEvent(sql, {
    eventType: "page_view", userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"), path: `/case/${caseId}/documents`,
    contentKind: "case", targetType: "case", targetPublicId: caseId,
  });

  return (
    <main className="shell caseShell">
      <CaseHeader caseId={caseId} caption={legalCase.caption} courtName={legalCase.courtName}
        docketNumber={legalCase.docketNumber} filedOn={legalCase.filedOn}
        decidedOn={legalCase.decidedOn} courtCode={legalCase.courtCode} />
      {opinionNotice ? (
        <section className="opinionPendingNotice" aria-labelledby="opinion-official-source">
          <h2 id="opinion-official-source">{opinionNotice.heading}</h2>
          <p>{opinionNotice.body} <a href={opinionNotice.href} rel="nofollow noopener">{opinionNotice.linkLabel}</a></p>
        </section>
      ) : null}
      {records.length > 0 ? (
        <section className="contentSection availableDocuments">
          <p className="sectionKicker">Available court materials</p>
          <h2>Documents currently available</h2>
          <p className="sectionIntroduction">Court documents for this case. This may not be every document the court has on file.</p>
          <ul className="documentCards">{records.map((document) => (
            <li key={document.publicId}>
              <div>
                <span className="documentType">{publicDocumentType(document.documentType)}</span>
                <h3>{document.title}</h3>
                {document.filedOn ? <time dateTime={document.filedOn}>{formatPublicCaseDate(document.filedOn) ?? document.filedOn}</time> : null}
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
