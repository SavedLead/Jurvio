import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import {
  listPublicDocketEntries,
  listPublicDocuments,
  listPublicParties,
} from "@/modules/cases/application/list-public-case-sections";
import { visibleCaseStatusDetails } from "@/modules/cases/domain/scotus-display";
import { BrandedCaseCaption, cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { CaseNav } from "@/modules/cases/ui/case-nav";
import { PublicCaseTools } from "@/modules/cases/ui/public-case-tools";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";

export const dynamic = "force-dynamic";

interface CasePageProps {
  params: Promise<{ caseId: string }>;
}

async function loadCase(params: CasePageProps["params"]) {
  const { caseId } = await params;
  if (!/^jv-[a-z0-9]{8,10}$/.test(caseId)) return null;
  const legalCase = await getPublicCase(db(), caseId);
  return legalCase ? { caseId, legalCase } : null;
}

export async function generateMetadata({ params }: CasePageProps): Promise<Metadata> {
  const loaded = await loadCase(params);
  if (!loaded) return { title: "Case not found" };
  const caption = cleanCaseCaption(loaded.legalCase.caption);
  const description = [
    caption,
    loaded.legalCase.courtName,
    `Docket ${loaded.legalCase.docketNumber}`,
    loaded.legalCase.filedOn ? `filed ${loaded.legalCase.filedOn}` : null,
    loaded.legalCase.decidedOn ? `decided ${loaded.legalCase.decidedOn}` : null,
    loaded.legalCase.supremeCourtTerm ? `Supreme Court term ${loaded.legalCase.supremeCourtTerm}` : null,
    loaded.legalCase.officialCitation,
  ].filter(Boolean).join(". ");
  return {
    title: `${caption} | Jurvio`,
    description,
    alternates: { canonical: `/case/${loaded.caseId}` },
    openGraph: { title: caption, description, type: "article" },
  };
}

export default async function CasePage({ params }: CasePageProps) {
  const loaded = await loadCase(params);
  if (!loaded) notFound();
  const { caseId, legalCase } = loaded;
  const sql = db();
  const [docketEntries, parties, documents] = await Promise.all([
    listPublicDocketEntries(sql, caseId),
    listPublicParties(sql, caseId),
    listPublicDocuments(sql, caseId),
  ]);
  const verified = legalCase.verification === "verified";
  const statusDetails = verified ? visibleCaseStatusDetails(legalCase) : [];
  const readableDocuments = documents.filter((document) => document.hasReadableContent);
  const sourceDocument = documents.find((document) => document.sourceDownloadUrl);
  const caption = cleanCaseCaption(legalCase.caption);
  const canonicalPath = `/case/${caseId}`;
  const permanentUrl = `https://jurvio.com${canonicalPath}`;

  const requestHeaders = await headers();
  await recordDemandEvent(sql, {
    eventType: "page_view",
    userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"),
    path: canonicalPath,
    contentKind: "case",
    targetType: "case",
    targetPublicId: caseId,
  });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LegalCase",
    name: caption,
    identifier: [
      { "@type": "PropertyValue", name: "Docket number", value: legalCase.docketNumber },
      { "@type": "PropertyValue", name: "Jurvio ID", value: caseId },
    ],
    datePublished: legalCase.decidedOn ?? legalCase.filedOn ?? undefined,
    url: permanentUrl,
    isPartOf: { "@type": "WebSite", name: "Jurvio", url: "https://jurvio.com" },
  };

  return (
    <main className="shell caseShell scotusCaseShell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />
      <CaseHeader
        caseId={caseId}
        caption={caption}
        courtName={legalCase.courtName}
        docketNumber={legalCase.docketNumber}
        filedOn={legalCase.filedOn}
        decidedOn={legalCase.decidedOn}
        supremeCourtTerm={legalCase.supremeCourtTerm}
        officialCitation={legalCase.officialCitation}
        showNavigation={false}
      />

      <div className="caseWorkspace">
        <aside className="caseWorkspaceNav">
          <CaseNav caseId={caseId} />
          <PublicCaseTools permanentUrl={permanentUrl} shareTitle={caption} citation={legalCase.officialCitation} />
        </aside>

        <div className="caseWorkspaceMain">
          <section className="caseLeadSection" aria-labelledby="understand-case">
            <p className="sectionKicker">Understand this case</p>
            <h2 id="understand-case">Verified case record</h2>
            {verified && legalCase.statusExplanation ? (
              <p className="statusExplanation">{legalCase.statusExplanation}</p>
            ) : (
              <p className="verifiedFactSummary">
                The published court record identifies <strong><BrandedCaseCaption caption={caption} /></strong> as Supreme Court docket {legalCase.docketNumber}.
                {readableDocuments.length > 0 ? ` Jurvio currently provides ${readableDocuments.length.toLocaleString()} readable court ${readableDocuments.length === 1 ? "document" : "documents"} for this case.` : ""}
              </p>
            )}
            {statusDetails.length > 0 ? (
              <dl className="caseStatusGrid">
                {statusDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            ) : null}
          </section>

          {documents.length > 0 ? (
            <section className="contentSection availableDocuments" aria-labelledby="available-documents">
              <p className="sectionKicker">Available court materials</p>
              <h2 id="available-documents">Documents currently available</h2>
              <p className="sectionIntroduction">Jurvio shows only verified documents currently available for this case. Additional court materials will appear here as they are obtained and verified.</p>
              <ul className="documentCards">
                {documents.map((document) => (
                  <li key={document.publicId}>
                    <div>
                      <span className="documentType">{document.documentType.replaceAll("_", " ")}</span>
                      <h3>{document.title}</h3>
                      {document.filedOn ? <time dateTime={document.filedOn}>{document.filedOn}</time> : null}
                    </div>
                    <div className="documentActions">
                      {document.hasReadableContent ? <Link href={`/case/${caseId}/documents/${document.publicId}` as Route}>Read on Jurvio</Link> : null}
                      {document.sourceDownloadUrl ? <a href={document.sourceDownloadUrl} rel="nofollow noopener">Official source</a> : null}
                    </div>
                  </li>
                ))}
              </ul>
              <Link className="sectionLink" href={`/case/${caseId}/documents` as Route}>View available documents →</Link>
            </section>
          ) : null}

          {docketEntries.length > 0 ? (
            <section className="contentSection" aria-labelledby="recent-activity">
              <p className="sectionKicker">Official activity</p>
              <h2 id="recent-activity">Recent case activity</h2>
              <ol className="recordList">
                {docketEntries.slice(0, 5).map((entry) => (
                  <li key={entry.publicId}>
                    <strong>{entry.entryNumber ? `Entry ${entry.entryNumber}` : "Court event"}</strong>
                    {entry.filedOn ? ` · ${entry.filedOn}` : ""}
                    <p>{entry.description}</p>
                  </li>
                ))}
              </ol>
              <Link className="sectionLink" href={`/case/${caseId}/timeline` as Route}>View case timeline →</Link>
            </section>
          ) : null}

          {parties.length > 0 ? (
            <section className="contentSection" aria-labelledby="named-parties">
              <p className="sectionKicker">Named in the record</p>
              <h2 id="named-parties">Parties</h2>
              <p className="sourceNote">Being named in a case does not establish liability, wrongdoing, or guilt.</p>
              <ul className="recordList">
                {parties.slice(0, 8).map((party) => <li key={party.publicId + ":" + party.role}><strong>{party.displayName}</strong><p>{party.role.replaceAll("_", " ")}</p></li>)}
              </ul>
              <Link className="sectionLink" href={`/case/${caseId}/parties` as Route}>View all parties →</Link>
            </section>
          ) : null}
        </div>

        <aside className="caseProvenanceRail" aria-label="Source and record details">
          <section>
            <p className="sectionKicker">Case status</p>
            <dl className="railFacts">
              <div><dt>Verification</dt><dd>{verified ? "Court metadata verified" : "Source review in progress"}</dd></div>
              {readableDocuments.length > 0 ? <div><dt>Readable text</dt><dd>Available on Jurvio</dd></div> : null}
              {legalCase.decidedOn ? <div><dt>Decision date</dt><dd>{legalCase.decidedOn}</dd></div> : null}
              {legalCase.supremeCourtTerm ? <div><dt>Term</dt><dd>{legalCase.supremeCourtTerm}</dd></div> : null}
              {legalCase.officialCitation ? <div><dt>Official citation</dt><dd>{legalCase.officialCitation}</dd></div> : null}
              <div><dt>Permanent ID</dt><dd>{caseId}</dd></div>
            </dl>
          </section>
          {sourceDocument ? (
            <section>
              <p className="sectionKicker">Official source</p>
              <p>This record includes material published by the Supreme Court of the United States.</p>
              <a href={sourceDocument.sourceDownloadUrl ?? undefined} rel="nofollow noopener">View official court document</a>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
