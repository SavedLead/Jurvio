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
import { formatPublicCaseDate, formatVerifiedOutcome, visibleCaseStatusDetails } from "@/modules/cases/domain/scotus-display";
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
    title: caption,
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
  const outcome = verified ? formatVerifiedOutcome(legalCase.dispositionScope) : null;
  const supportingStatusDetails = outcome ? statusDetails.filter(([label]) => label !== "Disposition") : statusDetails;
  const readableDocuments = documents.filter((document) => document.hasReadableContent);
  const sourceDocument = documents.find((document) => document.sourceDownloadUrl);
  const primaryOpinion = readableDocuments.find((document) => document.opinionType || document.documentType.includes("opinion")) ?? readableDocuments[0];
  const opinionPath = primaryOpinion ? `/case/${caseId}/documents/${primaryOpinion.publicId}` : null;
  const decisionLabel = primaryOpinion?.perCuriam ? "Per curiam" : primaryOpinion?.authorName;
  const opinionType = primaryOpinion?.opinionType && primaryOpinion.opinionType !== "unknown"
    ? primaryOpinion.opinionType.replaceAll("-", " ")
    : null;
  const timelineEvents = [
    legalCase.filedOn ? { date: legalCase.filedOn, label: "Case filed" } : null,
    ...docketEntries.filter((entry) => entry.filedOn).map((entry) => ({
      date: entry.filedOn as string,
      label: entry.description,
    })),
    legalCase.decidedOn ? { date: legalCase.decidedOn, label: "Decision issued" } : null,
  ]
    .filter((event): event is { date: string; label: string } => Boolean(event))
    .filter((event, index, events) => events.findIndex((candidate) => candidate.date === event.date && candidate.label === event.label) === index)
    .sort((left, right) => left.date.localeCompare(right.date));
  const availableDocumentTypes = [...new Set(documents.map((document) => document.documentType.replaceAll("_", " ")))];
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

      <div className={`caseWorkspace${sourceDocument ? "" : " caseWorkspaceNoRail"}`}>
        <aside className="caseWorkspaceNav">
          <CaseNav caseId={caseId} />
          <PublicCaseTools permanentUrl={permanentUrl} shareTitle={caption} citation={legalCase.officialCitation} />
        </aside>

        <div className="caseWorkspaceMain">
          <section className="caseLeadSection caseFeatureSection" aria-labelledby="understand-case">
            <div className="featureHeading">
              <h2 id="understand-case">Understand this case</h2>
            </div>
            {verified && legalCase.statusExplanation ? (
              <p className="statusExplanation">{legalCase.statusExplanation}</p>
            ) : (
              <p className="verifiedFactSummary">
                The published court record identifies <strong><BrandedCaseCaption caption={caption} /></strong> as {legalCase.courtName} docket {legalCase.docketNumber}.
                {readableDocuments.length > 0 ? ` Jurvio currently provides ${readableDocuments.length.toLocaleString()} readable court ${readableDocuments.length === 1 ? "document" : "documents"} for this case.` : ""}
              </p>
            )}
            {legalCase.backgroundSummary ? <div className="verifiedNarrative"><h3>What happened</h3><p>{legalCase.backgroundSummary}</p>{legalCase.backgroundSourceUrl ? <a href={legalCase.backgroundSourceUrl} rel="nofollow noopener">Official source</a> : null}</div> : null}
            {legalCase.significanceSummary ? <div className="verifiedNarrative"><h3>Why it matters</h3><p>{legalCase.significanceSummary}</p>{legalCase.significanceSourceUrl ? <a href={legalCase.significanceSourceUrl} rel="nofollow noopener">Official source</a> : null}</div> : null}
            {supportingStatusDetails.length > 0 ? (
              <dl className="caseStatusGrid">
                {supportingStatusDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            ) : null}
          </section>

          {legalCase.questionPresented ? (
            <section className="contentSection caseFeatureSection" aria-labelledby="question-presented">
              <div className="featureHeading"><h2 id="question-presented">Question presented</h2></div>
              <p>{legalCase.questionPresented}</p>
              {legalCase.questionSourceUrl ? <a className="sectionLink" href={legalCase.questionSourceUrl} rel="nofollow noopener">Read the official petition →</a> : null}
            </section>
          ) : null}

          {outcome || legalCase.exactHolding ? (
            <section className="contentSection caseFeatureSection" aria-labelledby="case-outcome">
              <div className="featureHeading">
                
                <h2 id="case-outcome">Holding and outcome</h2>
              </div>
              {outcome ? <div className="outcomeCallout"><strong>{outcome}.</strong></div> : null}
              {legalCase.exactHolding ? <div className="verifiedNarrative"><h3>Exact sourced holding</h3><p>{legalCase.exactHolding}</p>{legalCase.holdingSourceUrl ? <a href={legalCase.holdingSourceUrl} rel="nofollow noopener">Official source</a> : null}</div> : null}
            </section>
          ) : null}

          {decisionLabel || opinionType || legalCase.decisionLineup ? (
            <section className="contentSection caseFeatureSection" aria-labelledby="decision-lineup">
              <div className="featureHeading decisionHeading">
                
                <h2 id="decision-lineup">Decision lineup</h2>
                {decisionLabel ? <strong className="decisionLabel">{decisionLabel}</strong> : null}
              </div>
              {opinionType ? <p className="verifiedDetail">Opinion type: <strong>{opinionType}</strong></p> : null}
              {legalCase.decisionLineup?.joins?.length ? <p className="verifiedDetail">Joined by: <strong>{legalCase.decisionLineup.joins.join(", ")}</strong></p> : null}
              {legalCase.decisionLineup?.separateOpinions?.map((opinion) => <p className="verifiedDetail" key={opinion.author + opinion.type}>{opinion.author}: <strong>{opinion.type.replaceAll("_", " ")}</strong></p>)}
            </section>
          ) : null}

          {timelineEvents.length > 0 ? (
            <section className="contentSection caseFeatureSection" aria-labelledby="case-timeline">
              <div className="featureHeading">
                
                <h2 id="case-timeline">Case timeline</h2>
              </div>
              <ol className="caseMilestones">
                {timelineEvents.map((event) => (
                  <li key={event.date + event.label}>
                    <time dateTime={event.date}>{formatPublicCaseDate(event.date) ?? event.date}</time>
                    <span>{event.label}</span>
                  </li>
                ))}
              </ol>
              {docketEntries.length > 0 ? <Link className="sectionLink" href={`/case/${caseId}/timeline` as Route}>View complete available timeline →</Link> : null}
            </section>
          ) : null}

          {documents.length > 0 ? (
            <section className="contentSection availableDocuments caseFeatureSection" aria-labelledby="available-documents">
              <div className="featureHeading">
                
                <div><p className="sectionKicker">Available court materials</p><h2 id="available-documents">Documents and argument</h2></div>
              </div>
              <div className="availableDocumentTypes" aria-label="Available document types">
                {availableDocumentTypes.map((type) => <span key={type}>{type}</span>)}
              </div>
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

          {opinionPath ? (
            <section className="contentSection caseFeatureSection" aria-labelledby="read-opinion">
              <div className="featureHeading">
                
                <h2 id="read-opinion">Read the opinion</h2>
              </div>
              <nav className="opinionQuickLinks" aria-label="Opinion reading tools">
                <Link href={`${opinionPath}#opinion-reader-tools` as Route}>Search</Link>
                <Link href={`${opinionPath}#opinion-reader-tools` as Route}>Contents</Link>
                {opinionType ? <Link href={`${opinionPath}#opinion-text` as Route}>{opinionType}</Link> : null}
                {primaryOpinion?.hasReportersNote ? <Link href={`${opinionPath}#reporters-note-heading` as Route}>Reporter’s Note</Link> : null}
              </nav>
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

        {sourceDocument ? (
          <aside className="caseProvenanceRail" aria-label="Official court source">
            <section>
              <p className="sectionKicker">Official source</p>
              <p>This case includes source-linked court material.</p>
              <a href={sourceDocument.sourceDownloadUrl ?? undefined} rel="nofollow noopener">View official court document</a>
            </section>
          </aside>
        ) : null}
      </div>
    </main>
  );
}
