import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { db } from "@/db/client";
import { loadCaseForViewer } from "@/app/case/load-public-case";
import { SubscriberCaseGate, subscriberGateMetadata } from "@/modules/accounts/ui/subscriber-gate";
import {
  listPublicDocketEntries,
  listPublicDocuments,
  listPublicParties,
} from "@/modules/cases/application/list-public-case-sections";
import { buildCaseMetaDescription, buildRecordAnswers } from "@/modules/cases/domain/record-answers";
import { buildCaseTitle } from "@/modules/cases/domain/case-title";
import { formatPublicCaseDate, formatVerifiedOutcome, visibleCaseStatusDetails } from "@/modules/cases/domain/scotus-display";
import {
  OPINION_TEXT_PENDING_BODY,
  OPINION_TEXT_PENDING_HEADING,
  opinionTextIsPending,
} from "@/modules/cases/domain/opinion-availability";
import { robotsFor } from "@/lib/seo/indexing";
import { casePageIndexable } from "@/modules/cases/application/get-public-case";
import { BrandedCaseCaption, cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { CaseNav } from "@/modules/cases/ui/case-nav";
import { PublicCaseTools } from "@/modules/cases/ui/public-case-tools";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";
import "./case-intelligence.css";
import { loadCachedCaseCitations } from "@/modules/citations/application/cached-public-citations";
import { publicCitationTargets } from "@/modules/citations/application/public-citations";
import { citationCountLine } from "@/modules/citations/domain/citation-summary";
import { CitedCaseText } from "@/modules/citations/ui/cited-case-text";
import { CitationCaseList } from "@/modules/citations/ui/citation-case-list";
import { CitedStubList } from "@/modules/citations/ui/cited-stub-list";
import { listCaseNews } from "@/modules/case-news/application/list-case-news";
import { CaseNewsSection } from "@/modules/case-news/ui/case-news-section";
import { listCaseAgencyItems } from "@/modules/agency-sources/application/public-items";
import { OfficialAgencySources } from "@/modules/agency-sources/ui/official-agency-sources";
import { agencyTimelineEvents } from "@/modules/agency-sources/domain/timeline";
import { captionAllowsFollow, caseFollowEligible } from "@/modules/accounts/application/follows";
import { FollowCaseBox } from "@/modules/accounts/ui/follow-case-box";

export const dynamic = "force-dynamic";

interface CasePageProps {
  params: Promise<{ caseId: string }>;
}

async function loadCase(params: CasePageProps["params"]) {
  const { caseId } = await params;
  const access = await loadCaseForViewer(caseId);
  if (access.status === "missing") return null;
  if (access.status === "gated") return { caseId, gated: true as const };
  return { caseId, gated: false as const, legalCase: access.legalCase };
}

export async function generateMetadata({ params }: CasePageProps): Promise<Metadata> {
  const loaded = await loadCase(params);
  if (!loaded) return { title: "Case not found" };
  if (loaded.gated) return subscriberGateMetadata();
  const legalCase = loaded.legalCase;
  const caption = cleanCaseCaption(legalCase.caption);
  // "United States v. Olsen, No. 1:26-cr-00123 (E.D. Cal. 2026)"; judge, type and status go in the description.
  const title = buildCaseTitle({
    caption,
    docketNumber: legalCase.docketNumber,
    courtName: legalCase.courtName,
    providerCourtId: legalCase.courtCode,
    filedOn: legalCase.filedOn,
    decidedOn: legalCase.decidedOn,
  });
  const description = buildCaseMetaDescription({
    caption,
    docketNumber: legalCase.docketNumber,
    courtName: legalCase.courtName,
    courtKind: legalCase.courtKind ?? "other",
    natureOfSuit: legalCase.natureOfSuit ?? null,
    judgeName: legalCase.judgeName ?? null,
    filedOn: legalCase.filedOn,
    terminatedOn: legalCase.terminatedOn ?? null,
    decidedOn: legalCase.decidedOn,
    officialCitation: legalCase.officialCitation,
    captionCategory: legalCase.captionCategory ?? null,
  });
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/case/${loaded.caseId}` },
    openGraph: { title, description, type: "article" },
    robots: robotsFor(casePageIndexable(loaded.legalCase)),
  };
}

function formatJusticeName(value: string) {
  return value.toLocaleLowerCase("en-US").replaceAll(/(^|[\s'’\-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-US"));
}

function formatJusticePosition(value: string) {
  const labels: Record<string, string> = {
    court_opinion: "Majority",
    concurrence: "Concurrence",
    concurrence_in_judgment: "Concurrence in judgment",
    dissent: "Dissent",
    concurrence_and_dissent: "Concurrence and dissent",
    not_participating: "Did not participate",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

export default async function CasePage({ params }: CasePageProps) {
  const loaded = await loadCase(params);
  if (!loaded) notFound();
  if (loaded.gated) return <SubscriberCaseGate path={`/case/${loaded.caseId}`} />;
  const { caseId, legalCase } = loaded;
  const sql = db();
  const [docketEntries, parties, documents, citations, newsLinks, agencyItems, followEligible] = await Promise.all([
    listPublicDocketEntries(sql, caseId),
    listPublicParties(sql, caseId),
    listPublicDocuments(sql, caseId),
    loadCachedCaseCitations(caseId),
    // News is optional: a failure here must never break the case page.
    listCaseNews(sql, caseId).catch(() => []),
    // Official agency items that state this case's court + docket (empty until the tables exist).
    listCaseAgencyItems(sql, caseId).catch(() => []),
    // Never offer following on sealed or restricted cases (the follow API re-checks).
    captionAllowsFollow(legalCase.caption, legalCase.docketNumber)
      ? caseFollowEligible(sql, caseId).catch(() => false)
      : Promise.resolve(false),
  ]);
  const { cited: citedCases, citing: citingCases, counts: citationCounts } = citations;
  const verified = legalCase.verification === "verified";
  const statusDetails = verified ? visibleCaseStatusDetails(legalCase) : [];
  const outcome = verified ? formatVerifiedOutcome(legalCase.dispositionScope) : null;
  const supportingStatusDetails = outcome ? statusDetails.filter(([label]) => label !== "Disposition") : statusDetails;
  const readableDocuments = documents.filter((document) => document.hasReadableContent);
  const opinionTextPending = opinionTextIsPending(legalCase.hasReadableOpinion);
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
    // Dated filings from linked official agency items (e.g. FTC case pages).
    ...agencyTimelineEvents(agencyItems),
  ]
    .filter((event): event is { date: string; label: string } => Boolean(event))
    .filter((event, index, events) => events.findIndex((candidate) => candidate.date === event.date && candidate.label === event.label) === index)
    .sort((left, right) => left.date.localeCompare(right.date));
  const availableDocumentTypes = [...new Set(documents.map((document) => document.documentType.replaceAll("_", " ")))];
  const caption = cleanCaseCaption(legalCase.caption);
  const canonicalPath = `/case/${caseId}`;
  const permanentUrl = `https://jurvio.com${canonicalPath}`;
  const latestEvent = timelineEvents.at(-1) ?? null;
  // Template answers built only from structured record fields (see record-answers.ts);
  // used when no verified editorial summary exists.
  const recordAnswers = buildRecordAnswers({
    caption,
    docketNumber: legalCase.docketNumber,
    courtName: legalCase.courtName,
    courtKind: legalCase.courtKind ?? "other",
    filedOn: legalCase.filedOn,
    terminatedOn: legalCase.terminatedOn ?? null,
    decidedOn: legalCase.decidedOn,
    natureOfSuit: legalCase.natureOfSuit ?? null,
    causeOfAction: legalCase.causeOfAction ?? null,
    docketEntryCount: docketEntries.length,
    citedByCount: citationCounts.citedBy,
    hasReadableOpinion: legalCase.hasReadableOpinion,
    opinionFiledOn: primaryOpinion?.filedOn ?? null,
    captionCategory: legalCase.captionCategory ?? null,
  });
  const verifiedHappened = legalCase.backgroundSummary ?? (verified ? legalCase.statusExplanation : null);
  const verifiedOutcome = legalCase.exactHolding ?? (outcome ? `${outcome}.` : null);
  const caseAnswers = [
    {
      id: "what-happened",
      question: "What happened in this case?",
      answer: verifiedHappened
        ?? recordAnswers.happened
        ?? `The public record currently confirms this case as ${legalCase.courtName} docket ${legalCase.docketNumber}. A source-backed plain-English summary is not yet available.`,
      sourceUrl: verifiedHappened ? legalCase.backgroundSourceUrl : null,
      available: Boolean(verifiedHappened || recordAnswers.happened),
      fromRecord: !verifiedHappened && Boolean(recordAnswers.happened),
    },
    {
      id: "case-about",
      question: "What is this case about?",
      answer: legalCase.questionPresented
        ?? recordAnswers.about
        ?? "Jurvio has not yet verified a plain-English description of the legal question in this case.",
      sourceUrl: legalCase.questionPresented ? legalCase.questionSourceUrl : null,
      available: Boolean(legalCase.questionPresented || recordAnswers.about),
      fromRecord: !legalCase.questionPresented && Boolean(recordAnswers.about),
    },
    {
      id: "current-status",
      question: "Where does the case stand now?",
      answer: (verified ? legalCase.statusExplanation : null)
        ?? (latestEvent ? `The latest dated event currently available is “${latestEvent.label}” on ${formatPublicCaseDate(latestEvent.date) ?? latestEvent.date}.` : "Jurvio has not yet verified the current procedural posture."),
      sourceUrl: null,
      available: Boolean((verified && legalCase.statusExplanation) || latestEvent),
      fromRecord: false,
    },
    {
      id: "why-it-matters",
      question: "Why does this case matter?",
      answer: legalCase.significanceSummary
        ?? recordAnswers.matters
        ?? "A source-backed explanation of this case’s broader significance is not yet available.",
      sourceUrl: legalCase.significanceSummary ? legalCase.significanceSourceUrl : null,
      available: Boolean(legalCase.significanceSummary || recordAnswers.matters),
      fromRecord: !legalCase.significanceSummary && Boolean(recordAnswers.matters),
    },
    {
      id: "ruling-outcome",
      question: "What was the ruling or outcome?",
      answer: verifiedOutcome
        ?? recordAnswers.outcome
        ?? "No final ruling or closing date appears in the court record Jurvio holds.",
      sourceUrl: verifiedOutcome ? legalCase.holdingSourceUrl ?? legalCase.dispositionSourceUrl : null,
      available: Boolean(verifiedOutcome || recordAnswers.outcome),
      fromRecord: !verifiedOutcome && Boolean(recordAnswers.outcome),
    },
    {
      id: "latest-update",
      question: "What happened most recently?",
      answer: latestEvent
        ? `${formatPublicCaseDate(latestEvent.date) ?? latestEvent.date}: ${latestEvent.label}`
        : "No dated docket or agency filing is currently available on Jurvio.",
      sourceUrl: null,
      available: Boolean(latestEvent),
      fromRecord: false,
    },
  ] as const;
  const filedAt = legalCase.filedOn ? Date.parse(`${legalCase.filedOn}T00:00:00Z`) : Number.NaN;
  const recentlyFiled = !legalCase.decidedOn
    && Number.isFinite(filedAt)
    && Date.now() - filedAt <= 45 * 24 * 60 * 60 * 1000;

  const narrativeTargets=await publicCitationTargets(sql, [
    ...caseAnswers.map(answer=>answer.answer), legalCase.backgroundSummary,
    legalCase.significanceSummary, legalCase.questionPresented, legalCase.exactHolding,
  ].filter(Boolean).join(" "));
  const linkedText=(text:string)=><CitedCaseText text={text} targets={narrativeTargets} />;
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
    abstract: legalCase.backgroundSummary ?? legalCase.statusExplanation ?? undefined,
    sameAs: [legalCase.backgroundSourceUrl, legalCase.questionSourceUrl, legalCase.holdingSourceUrl].filter(Boolean),
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
        courtCode={legalCase.courtCode}
        showNavigation={false}
      />

      <div className="caseWorkspace">
        <aside className="caseWorkspaceNav">
          <CaseNav caseId={caseId} />
          {followEligible ? <FollowCaseBox caseId={caseId} /> : null}
          <div className="caseProvenanceRail" aria-label="Source and record details">
            <section>
              <p className="sectionKicker">Case status</p>
              <dl className="railFacts">
                <div><dt>Verification</dt><dd>{verified ? "Court metadata verified" : "Source review in progress"}</dd></div>
                {opinionTextPending
                  ? <div><dt>Opinion text</dt><dd>Pending</dd></div>
                  : <div><dt>Readable text</dt><dd>Available on Jurvio</dd></div>}
                {legalCase.decidedOn ? <div><dt>Decision date</dt><dd>{legalCase.decidedOn}</dd></div> : null}
                {legalCase.supremeCourtTerm ? <div><dt>Term</dt><dd>{legalCase.supremeCourtTerm}</dd></div> : null}
                {legalCase.officialCitation ? <div><dt>Official citation</dt><dd>{legalCase.officialCitation}</dd></div> : null}
                <div><dt>Permanent ID</dt><dd>{caseId}</dd></div>
              </dl>
            </section>
            {sourceDocument ? (
              <section>
                <p className="sectionKicker">Official source</p>
                <p>This record includes source-linked court material.</p>
                <a href={sourceDocument.sourceDownloadUrl ?? undefined} rel="nofollow noopener">View official court document</a>
              </section>
            ) : null}
          </div>
          <PublicCaseTools permanentUrl={permanentUrl} shareTitle={caption} citation={legalCase.officialCitation} />
        </aside>

        <div className="caseWorkspaceMain">
          {opinionTextPending ? (
            <section className="opinionPendingNotice" aria-labelledby="opinion-text-pending">
              <h2 id="opinion-text-pending">{OPINION_TEXT_PENDING_HEADING}</h2>
              <p>{OPINION_TEXT_PENDING_BODY}</p>
            </section>
          ) : null}
          <section className="caseAnswerPanel" aria-labelledby="case-answers-title">
            <p className="sectionKicker">Case intelligence</p>
            <h2 id="case-answers-title">{recentlyFiled ? "This case was recently filed" : "What the verified record tells us"}</h2>
            <p className="caseAnswerIntro">
              {recentlyFiled
                ? "The court record is new. Verified answers, documents, and developments will appear here as they become available."
                : "Direct answers from the verified public record. Missing information is labeled instead of inferred."}
            </p>
            <div className="caseAnswerGrid">
              {caseAnswers.map((item) => (
                <article className={item.available ? "caseAnswerCard" : "caseAnswerCard caseAnswerUnavailable"} id={item.id} key={item.id}>
                  <h3>{item.question}</h3>
                  <p>{linkedText(item.answer)}</p>
                  <footer>
                    <span>{!item.available ? "Not yet available" : item.fromRecord ? "From the court record" : "Source-backed answer"}</span>
                    {item.sourceUrl ? <a href={item.sourceUrl} rel="nofollow noopener">View source</a> : null}
                  </footer>
                </article>
              ))}
            </div>
          </section>
          <section className="caseLeadSection caseFeatureSection" aria-labelledby="understand-case">
            <div className="featureHeading">
              <div><p className="sectionKicker">Understand this case</p><h2 id="understand-case">Verified case record</h2></div>
            </div>
            {verified && legalCase.statusExplanation ? (
              <p className="statusExplanation">{linkedText(legalCase.statusExplanation)}</p>
            ) : (
              <p className="verifiedFactSummary">
                The published court record identifies <strong><BrandedCaseCaption caption={caption} /></strong> as {legalCase.courtName} docket {legalCase.docketNumber}.
                {opinionTextPending
                  ? ` ${OPINION_TEXT_PENDING_BODY}`
                  : readableDocuments.length > 0
                    ? ` Jurvio currently provides ${readableDocuments.length.toLocaleString()} readable court ${readableDocuments.length === 1 ? "document" : "documents"} for this case.`
                    : ""}
              </p>
            )}
            {legalCase.backgroundSummary ? <div className="verifiedNarrative"><h3>What happened</h3><p>{linkedText(legalCase.backgroundSummary)}</p>{legalCase.backgroundSourceUrl ? <a href={legalCase.backgroundSourceUrl} rel="nofollow noopener">Official source</a> : null}</div> : null}
            {legalCase.significanceSummary ? <div className="verifiedNarrative"><h3>Why it matters</h3><p>{linkedText(legalCase.significanceSummary)}</p>{legalCase.significanceSourceUrl ? <a href={legalCase.significanceSourceUrl} rel="nofollow noopener">Official source</a> : null}</div> : null}
            {supportingStatusDetails.length > 0 ? (
              <dl className="caseStatusGrid">
                {supportingStatusDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            ) : null}
          </section>

          {legalCase.questionPresented ? (
            <section className="contentSection caseFeatureSection" aria-labelledby="question-presented">
              <div className="featureHeading"><h2 id="question-presented">Question presented</h2></div>
              <p>{linkedText(legalCase.questionPresented)}</p>
              {legalCase.questionSourceUrl ? <a className="sectionLink" href={legalCase.questionSourceUrl} rel="nofollow noopener">Read the official petition →</a> : null}
            </section>
          ) : null}

          {outcome || legalCase.exactHolding ? (
            <section className="contentSection caseFeatureSection" aria-labelledby="case-outcome">
              <div className="featureHeading">
                  <h2 id="case-outcome">Holding and outcome</h2>
              </div>
              {outcome ? <div className="outcomeCallout"><strong>{outcome}.</strong></div> : null}
              {legalCase.exactHolding ? <div className="verifiedNarrative"><h3>Exact sourced holding</h3><p>{linkedText(legalCase.exactHolding)}</p>{legalCase.holdingSourceUrl ? <a href={legalCase.holdingSourceUrl} rel="nofollow noopener">Official source</a> : null}</div> : null}
            </section>
          ) : null}

          {decisionLabel || opinionType || legalCase.decisionLineup ? (
            <section className="contentSection caseFeatureSection" aria-labelledby="decision-lineup">
              <div className="featureHeading decisionHeading">
                <h2 id="decision-lineup">Decision lineup</h2>
                {decisionLabel ? <strong className="decisionLabel">{decisionLabel}</strong> : null}
              </div>
              {opinionType ? <p className="verifiedDetail">Opinion type: <strong>{opinionType}</strong></p> : null}
              {legalCase.decisionLineup?.voteBreakdown?.label ? (
                <p className="verifiedDetail">Final vote: <strong>{legalCase.decisionLineup.voteBreakdown.label}</strong></p>
              ) : null}
              {legalCase.decisionLineup?.justiceVotes?.length ? (
                <dl className="caseStatusGrid justiceVoteGrid" aria-label="Justice votes">
                  {legalCase.decisionLineup.justiceVotes.map((vote) => (
                    <div key={vote.justice}>
                      <dt>{formatJusticeName(vote.justice)}</dt>
                      <dd>{formatJusticePosition(vote.position)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <>
                  {legalCase.decisionLineup?.joins?.length ? <p className="verifiedDetail">Joined by: <strong>{legalCase.decisionLineup.joins.map(formatJusticeName).join(", ")}</strong></p> : null}
                  {legalCase.decisionLineup?.separateOpinions?.map((opinion) => <p className="verifiedDetail" key={opinion.author + opinion.type}>{formatJusticeName(opinion.author)}: <strong>{formatJusticePosition(opinion.type)}</strong></p>)}
                </>
              )}
            </section>
          ) : null}

          <CitationCaseList
            title="Cases cited"
            cases={citedCases}
            total={citationCounts.cited}
            summary={citationCounts.cited ? citationCountLine(citationCounts.cited, citationCounts.citedOnJurvio) : undefined}
          />
          <CitedStubList stubs={citations.stubs ?? []} />
          <CitationCaseList
            title="Cited by"
            cases={citingCases}
            total={citationCounts.citedBy}
            summary={citationCounts.citedBy ? `${citationCounts.citedBy.toLocaleString("en-US")} ${citationCounts.citedBy === 1 ? "case" : "cases"} on Jurvio cite this case` : undefined}
          />

          <CaseNewsSection links={newsLinks} />

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

          <OfficialAgencySources items={agencyItems} />

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

      </div>
    </main>
  );
}

