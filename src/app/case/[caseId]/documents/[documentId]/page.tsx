import { cache } from "react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { getPublicOpinion } from "@/modules/cases/application/get-public-opinion";
import { viewerHasSubscriberAccess } from "@/modules/accounts/http/viewer";
import { SubscriberCaseGate, subscriberGateMetadata } from "@/modules/accounts/ui/subscriber-gate";
import { BrandedCaseCaption, cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { OpinionReaderTools } from "@/modules/cases/ui/opinion-reader-tools";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";
import { distinguishReportersNote } from "@/modules/legal-context/domain/legal-context";
import { labelsForTerms, termsInText } from "@/modules/plain-english/domain/term-index";
import { createTermMarker, TermText } from "@/modules/plain-english/ui/term-text";
import { AnnotatedLegalText } from "@/modules/legal-context/ui/annotated-legal-text";
import { robotsFor } from "@/lib/seo/indexing";

import { publicCitationTargets } from "@/modules/citations/application/public-citations";
import { linkCaseCitations } from "@/modules/citations/domain/link-citations";
import { citationKey } from "@/modules/citations/domain/citations";
import { citationCountLine, summarizeCitations } from "@/modules/citations/domain/citation-summary";
import { publicOpinionType } from "@/modules/cases/domain/public-labels";
import { formatPublicCaseDate } from "@/modules/cases/domain/scotus-display";

export const dynamic = "force-dynamic";

interface OpinionPageProps {
  params: Promise<{ caseId: string; documentId: string }>;
}

const loadOpinion = cache(async (caseId: string, documentId: string) => {
  if (!/^jv-[a-z0-9]{8,10}$/.test(caseId) || !/^jd-[a-z0-9]{8,10}$/.test(documentId)) return null;
  return getPublicOpinion(db(), caseId, documentId);
});

/** null = not found; "gated" = subscriber-only opinion and the viewer is not a paid subscriber. */
async function load(params: OpinionPageProps["params"]) {
  const { caseId, documentId } = await params;
  const opinion = await loadOpinion(caseId, documentId);
  if (!opinion) return null;
  if (opinion.subscriberOnly && !(await viewerHasSubscriberAccess())) return "gated" as const;
  return opinion;
}

export async function generateMetadata({ params }: OpinionPageProps): Promise<Metadata> {
  const opinion = await load(params);
  if (!opinion) return { title: "Opinion not found" };
  if (opinion === "gated") return subscriberGateMetadata();
  const caption = cleanCaseCaption(opinion.caseCaption);
  const title = [
    caption,
    "Judicial Opinion",
    opinion.officialCitation ?? opinion.filedOn ?? opinion.title,
    opinion.docketNumber,
    opinion.courtName,
  ].filter(Boolean).join(" | ");
  const description = opinion.contentText.replace(/\s+/g, " ").trim().slice(0, 155);
  return {
    title,
    description,
    alternates: { canonical: `/case/${opinion.casePublicId}/documents/${opinion.documentPublicId}` },
    openGraph: { title, description, type: "article" },
    robots: robotsFor(opinion.indexable),
  };
}

export default async function OpinionPage({ params }: OpinionPageProps) {
  const opinion = await load(params);
  if (!opinion) notFound();
  if (opinion === "gated") {
    const { caseId, documentId } = await params;
    return <SubscriberCaseGate path={`/case/${caseId}/documents/${documentId}`} />;
  }

  const caption = cleanCaseCaption(opinion.caseCaption);
  const canonicalPath = `/case/${opinion.casePublicId}/documents/${opinion.documentPublicId}`;
  const permanentUrl = `https://jurvio.com${canonicalPath}`;
  const officialCitation = opinion.officialCitation;
  const requestHeaders = await headers();
  await recordDemandEvent(db(), {
    eventType: "document_view",
    userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"),
    path: canonicalPath,
    contentKind: "document",
    targetType: "document",
    targetPublicId: opinion.documentPublicId,
  });
  const citationTargets = await publicCitationTargets(db(), opinion.contentText, opinion.contentHtml);
  // The opinion header usually repeats the case's own citation; never count,
  // link or mark it as a citation to another case.
  const ownTargets = new Set(citationTargets.filter(target => target.casePublicId === opinion.casePublicId).map(target => target.citationKey));
  const ownKeys = new Set([...ownTargets, ...(officialCitation ? [citationKey(officialCitation)] : [])]);
  const outgoingTargets = citationTargets.filter(target => !ownTargets.has(target.citationKey));
  const citationSummary = summarizeCitations(
    opinion.contentText,
    opinion.contentHtml,
    new Set(outgoingTargets.map(target => target.citationKey)),
    officialCitation ? [officialCitation] : [],
  );
  // Only the dictionary terms this opinion actually uses go to the client.
  const opinionTerms = termsInText(opinion.contentText);
  const opinionTermLabels = labelsForTerms(new Set(opinionTerms.map((term) => term.key)));
  const headerMarker = createTermMarker("opinion-header");
  const linkedHtml = linkCaseCitations(opinion.contentHtml, outgoingTargets, { markUnresolved: true, exclude: ownKeys });
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "DigitalDocument",
    name: opinion.title,
    headline: caption,
    datePublished: opinion.filedOn ?? undefined,
    pagination: `${opinion.wordCount} words`,
    identifier: [
      { "@type": "PropertyValue", name: "Docket number", value: opinion.docketNumber },
      { "@type": "PropertyValue", name: "Jurvio document ID", value: opinion.documentPublicId },
      officialCitation ? { "@type": "PropertyValue", name: "Official citation", value: officialCitation } : null,
    ].filter(Boolean),
    isPartOf: { "@type": "LegalCase", name: caption, url: `https://jurvio.com/case/${opinion.casePublicId}` },
    citation: outgoingTargets.filter(target => target.machineAccessible).map(target => `https://jurvio.com/case/${target.casePublicId}`),
    provider: { "@type": "Organization", name: "Jurvio" },
    url: permanentUrl,
  };

  return (
    <main className="readerShell enhancedReaderShell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/cases">Cases</Link> / <Link href={`/case/${opinion.casePublicId}`}><BrandedCaseCaption caption={caption} /></Link> / Opinion
      </nav>
      <article className="opinionLayout">
        <header className="opinionHeader">
          <p className="eyebrow">{opinion.courtName}</p>
          <h1><BrandedCaseCaption caption={caption} /></h1>
          <p className="lede">Judicial opinion</p>
          <dl className="metadataGrid">
            {opinion.filedOn ? <div><dt>Filed or decided</dt><dd><time dateTime={opinion.filedOn}>{formatPublicCaseDate(opinion.filedOn) ?? opinion.filedOn}</time></dd></div> : null}
            <div><dt>Docket</dt><dd>{opinion.docketNumber}</dd></div>
            {publicOpinionType(opinion.opinionType) ? <div><dt>Opinion</dt><dd><TermText text={publicOpinionType(opinion.opinionType)} marker={headerMarker} /></dd></div> : null}
            {opinion.authorName ? <div><dt>Author</dt><dd>{opinion.authorName}</dd></div> : null}
            {opinion.perCuriam ? <div><dt>Authorship</dt><dd><TermText text="Per curiam" marker={headerMarker} /></dd></div> : null}
            {officialCitation ? <div><dt>Official citation</dt><dd>{officialCitation}</dd></div> : null}
          </dl>
          <aside className="sourceNotice">
            <strong>Official court text.</strong> Jurvio reformats the published opinion for readability without changing the Court&apos;s words.
            {opinion.sourceDownloadUrl ? <> <a href={opinion.sourceDownloadUrl} rel="nofollow noopener">View the official source</a>.</> : null}
          </aside>
          <p className="legalTermHelp">Hover, tap, or tab to any dotted-underlined legal term for a plain-English definition.</p>
        </header>

        <div className="opinionWorkspace">
          <OpinionReaderTools
            targetId="opinion-text"
            permanentUrl={permanentUrl}
            shareTitle={`${caption} — Judicial Opinion`}
            citation={officialCitation}
          />
          <div id="opinion-text" className="opinionTextSurface" data-reader-size="regular" data-reader-width="standard" data-reader-theme="paper">
            <AnnotatedLegalText
              className="opinionBody"
              html={distinguishReportersNote(linkedHtml)}
              terms={opinionTerms}
              labels={opinionTermLabels}
            />
          </div>
          <aside className="readerMetadataRail" aria-label="Opinion source and record details">
            <section>
              <p className="sectionKicker">Opinion details</p>
              <dl className="railFacts">
                <div><dt>Court</dt><dd>{opinion.courtName}</dd></div>
                <div><dt>Docket</dt><dd>{opinion.docketNumber}</dd></div>
                {opinion.filedOn ? <div><dt>Filed or decided</dt><dd><time dateTime={opinion.filedOn}>{formatPublicCaseDate(opinion.filedOn) ?? opinion.filedOn}</time></dd></div> : null}
                {officialCitation ? <div><dt>Citation</dt><dd>{officialCitation}</dd></div> : null}
              </dl>
            </section>
            {citationSummary.cases ? (
              <section className="citationRail">
                <h2>Cases cited <span className="citationCount">{citationSummary.cases.toLocaleString("en-US")}</span></h2>
                <p>{citationCountLine(citationSummary.cases, citationSummary.onJurvio)}</p>
                {outgoingTargets.length ? <ul>{[...new Map(outgoingTargets.map(target => [target.casePublicId,target])).values()].map(target => <li key={target.citationKey}><Link href={`/case/${target.casePublicId}`}>{cleanCaseCaption(target.caption)}</Link></li>)}</ul> : null}
                {citationSummary.notYetOnJurvio.length ? (
                  <details className="citationPendingList">
                    <summary>Not yet on Jurvio ({citationSummary.notYetOnJurvio.length})</summary>
                    <ul>{citationSummary.notYetOnJurvio.slice(0, 100).map(cite => <li key={cite.key}>{cite.label}</li>)}</ul>
                  </details>
                ) : null}
              </section>
            ) : null}
            {opinion.sourceDownloadUrl ? <section><p className="sectionKicker">Provenance</p><p>Published by {opinion.courtName}.</p><a href={opinion.sourceDownloadUrl} rel="nofollow noopener">Official court document</a></section> : null}
          </aside>
        </div>
      </article>
      <p className="permalink">Permanent link: <Link href={canonicalPath as Route}>{permanentUrl.replace(/^https:\/\//, "")}</Link></p>
    </main>
  );
}

