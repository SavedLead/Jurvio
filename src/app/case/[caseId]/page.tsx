import type { ReactNode } from "react";
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
import { publicDocumentType, publicOpinionType, publicPartyRole } from "@/modules/cases/domain/public-labels";
import { formatPublicCaseDate, formatVerifiedOutcome, visibleCaseStatusDetails } from "@/modules/cases/domain/scotus-display";
import {
  officialOpinionNotice,
  opinionTextIsPending,
} from "@/modules/cases/domain/opinion-availability";
import { robotsFor } from "@/lib/seo/indexing";
import { casePageIndexable } from "@/modules/cases/application/get-public-case";
import { BrandedCaseCaption, cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import { CaseHeader } from "@/modules/cases/ui/case-header";
import { caseSections } from "@/modules/cases/ui/case-nav";
import { CaseGlossary, CaseSection, CaseSourceList, CaseSources, CaseSummaryCard, SourceRef } from "@/modules/cases/ui/case-declutter";
import { CaseSectionOpener } from "@/modules/cases/ui/case-section-opener";
import { keyDate as pickKeyDate, standingAfterSummary, summaryFromStanding, type CardLineSource } from "@/modules/cases/domain/case-summary";
import { CaseCardActions } from "@/modules/cases/ui/case-card-actions";
import { CaseSectionBar, type SectionChip } from "@/modules/cases/ui/case-section-bar";
import { BackToTop } from "@/modules/cases/ui/back-to-top";
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
import { loadCaseLineup } from "@/modules/scotus/application/justice-analytics";
import { SCDB_DIRECTION_DOC, SCDB_HOME } from "@/modules/scotus/ui/justice-ui";
import { loadCaseJusticeNotes } from "@/modules/scotus/application/justice-notes";
import { noteLabel, RULE_OF_FOUR_SOURCE } from "@/modules/scotus/ui/case-justice-notes";
import { CaseJusticesVoted, justicesHint } from "@/modules/scotus/ui/case-justices-voted";
import { buildCaseJourney } from "@/modules/scotus/domain/case-journey";
import { termsInText, type PlainTerm } from "@/modules/plain-english/domain/term-index";
import { loadCitationReach } from "@/modules/scotus/application/ramifications";
import { readSyllabusHeld } from "@/modules/scotus/domain/ramifications";
import { CaseRamificationsSection, type RamificationsHolding } from "@/modules/scotus/ui/case-ramifications";
import { ALLOTMENT_SOURCE_URL, APPLICATIONS_GUIDE_URL, circuitJusticeFor, circuitJusticeForCircuit, circuitOfCourtName } from "@/modules/scotus/domain/circuit-justice";
import { CircuitJusticeBox } from "@/modules/scotus/ui/circuit-justice-box";
import { captionAllowsFollow, caseFollowEligible } from "@/modules/accounts/application/follows";
import { FollowEntityButton } from "@/modules/accounts/ui/follow-entity-button";
import { FollowCaseExtras } from "@/modules/accounts/ui/follow-case-extras";
import { FollowCaseBox } from "@/modules/accounts/ui/follow-case-box";
import { createTermMarker, TermText, type TermMarker } from "@/modules/plain-english/ui/term-text";
import { buildCaseStanding } from "@/modules/plain-english/domain/case-standing";
import { loadCaseStandingSignals } from "@/modules/plain-english/application/case-standing-signals";
import { CaseStandingSection } from "@/modules/plain-english/ui/case-standing-section";
import { readKeyDatesAhead } from "@/modules/case-intelligence/domain/key-dates";
import { CircuitSplitSection, KeyDatesAheadSection, SimilarCasesSection } from "@/modules/case-intelligence/ui/case-extras";
import { loadSimilarCases } from "@/modules/citations/application/similar-cases";
import { loadCaseCircuitSplit } from "@/modules/scotus/application/circuit-split";
import { readCircuitSplit } from "@/modules/scotus/domain/circuit-split";
import { ALLEGATION_NOTE, DOCKET_FEED_NOTE, docketEntryKind, namedParties, statedOutcome } from "@/modules/cases/domain/docket-entry-reading";
import { docketCaseType, formatCauseOfAction, parseNatureOfSuit } from "@/modules/cases/domain/record-answers";
import { buildMotionGuide } from "@/modules/plain-english/domain/motion-guide";
import { CaseMotionsSection } from "@/modules/plain-english/ui/case-motions";
import { loadCaseJourney, loadJourneyBenchmarks, loadOnwardSupremeCourt } from "@/modules/scotus/application/case-journey";
import { CaseJourneySection, OnwardSupremeCourtSection } from "@/modules/scotus/ui/case-journey";

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

/** "Inside: where the case came from, what the court did and 2 more" (the collapsed stands section's hint). */
function standsHint(inside: string[]): string {
  const shown = inside.slice(0, 3);
  const more = inside.length - shown.length;
  const list = shown.length > 1 ? `${shown.slice(0, -1).join(", ")}${more ? ", " : " and "}${shown.at(-1)}` : shown[0] ?? "";
  return `Inside: ${list}${more ? ` and ${more} more` : ""}`;
}

export default async function CasePage({ params }: CasePageProps) {
  const loaded = await loadCase(params);
  if (!loaded) notFound();
  if (loaded.gated) return <SubscriberCaseGate path={`/case/${loaded.caseId}`} />;
  const { caseId, legalCase } = loaded;
  const sql = db();
  const isSupremeCourt = legalCase.courtKind === "supreme" || (legalCase.courtCode ?? "").toLowerCase() === "scotus";
  const [docketEntries, parties, documents, citations, newsLinks, agencyItems, followEligible, scdbLineup, justiceNotes] = await Promise.all([
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
    // SCDB vote lineup (Supreme Court cases linked to an SCDB case only); optional like news.
    legalCase.supremeCourtTerm !== null ? loadCaseLineup(sql, caseId).catch(() => null) : Promise.resolve(null),
    // Justice notes from the official docket (dissents from denial, would-grant, statements); optional like news.
    isSupremeCourt ? loadCaseJusticeNotes(sql, caseId).catch(() => null) : Promise.resolve(null),
  ]);
  // Case journey: Supreme Court docket steps (with typical times), or, on an appeals case, the Supreme Court case it went on to.
  const journeyEntries = docketEntries.map((entry) => ({ filedOn: entry.filedOn, description: entry.description }));
  const [journey, journeyBenchmarks, onwardSupremeCourt] = await Promise.all([
    isSupremeCourt ? loadCaseJourney(sql, caseId, journeyEntries).catch(() => null) : Promise.resolve(null),
    isSupremeCourt ? loadJourneyBenchmarks(sql).catch(() => null) : Promise.resolve(null),
    legalCase.courtKind === "appellate" ? loadOnwardSupremeCourt(sql, legalCase.courtCode ?? null, legalCase.docketNumber ?? null).catch(() => []) : Promise.resolve([]),
  ]);
  const { cited: citedCases, citing: citingCases, counts: citationCounts } = citations;
  const verified = legalCase.verification === "verified";
  const statusDetails = verified ? visibleCaseStatusDetails(legalCase) : [];
  const outcome = verified ? formatVerifiedOutcome(legalCase.dispositionScope) : null;
  const supportingStatusDetails = outcome ? statusDetails.filter(([label]) => label !== "Disposition") : statusDetails;
  const readableDocuments = documents.filter((document) => document.hasReadableContent);
  // Only decided appellate / Supreme Court cases are expected to have an opinion;
  // an open district docket has nothing "pending" to promise.
  const opinionTextPending = opinionTextIsPending(legalCase.hasReadableOpinion)
    && Boolean(legalCase.decidedOn)
    && (legalCase.courtKind === "supreme" || legalCase.courtKind === "appellate");
  const sourceDocument = documents.find((document) => document.sourceDownloadUrl);
  // No opinion text to show: link the official copy, or say nothing.
  const opinionNotice = opinionTextPending ? officialOpinionNotice(sourceDocument?.sourceDownloadUrl) : null;
  const primaryOpinion = readableDocuments.find((document) => document.opinionType || document.documentType.includes("opinion")) ?? readableDocuments[0];
  const opinionPath = primaryOpinion ? `/case/${caseId}/documents/${primaryOpinion.publicId}` : null;
  const decisionLabel = primaryOpinion?.perCuriam ? "Per curiam" : primaryOpinion?.authorName;
  const opinionType = publicOpinionType(primaryOpinion?.opinionType);
  const timelineEvents = [
    legalCase.filedOn ? { date: legalCase.filedOn, label: "Case filed" } : null,
    ...docketEntries.filter((entry) => entry.filedOn).map((entry) => {
      const kind = docketEntryKind(entry.description);
      const label = kind === "other" ? entry.description : `${kind[0]?.toUpperCase()}${kind.slice(1)} · ${entry.description}`;
      return { date: entry.filedOn as string, label };
    }),
    legalCase.decidedOn ? { date: legalCase.decidedOn, label: "Decision issued" } : null,
    // Dated filings from linked official agency items (e.g. FTC case pages).
    ...agencyTimelineEvents(agencyItems),
  ]
    .filter((event): event is { date: string; label: string } => Boolean(event))
    .filter((event, index, events) => events.findIndex((candidate) => candidate.date === event.date && candidate.label === event.label) === index)
    .sort((left, right) => left.date.localeCompare(right.date));
  const availableDocumentTypes = [...new Set(documents.map((document) => publicDocumentType(document.documentType)))];
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
        ?? `${legalCase.courtName} case number ${legalCase.docketNumber}.`,
      sourceUrl: verifiedHappened ? legalCase.backgroundSourceUrl : null,
      available: Boolean(verifiedHappened || recordAnswers.happened),
      fromRecord: !verifiedHappened && Boolean(recordAnswers.happened),
    },
    {
      id: "case-about",
      question: "What is this case about?",
      answer: legalCase.questionPresented
        ?? recordAnswers.about
        ?? "",
      sourceUrl: legalCase.questionPresented ? legalCase.questionSourceUrl : null,
      available: Boolean(legalCase.questionPresented || recordAnswers.about),
      fromRecord: !legalCase.questionPresented && Boolean(recordAnswers.about),
    },
    {
      id: "current-status",
      question: "Where does the case stand now?",
      answer: (verified ? legalCase.statusExplanation : null)
        ?? (latestEvent ? `The latest dated event in the record is “${latestEvent.label}” on ${formatPublicCaseDate(latestEvent.date) ?? latestEvent.date}.` : ""),
      sourceUrl: null,
      available: Boolean((verified && legalCase.statusExplanation) || latestEvent),
      fromRecord: false,
    },
    {
      id: "why-it-matters",
      question: "Why does this case matter?",
      answer: legalCase.significanceSummary
        ?? recordAnswers.matters
        ?? "",
      sourceUrl: legalCase.significanceSummary ? legalCase.significanceSourceUrl : null,
      available: Boolean(legalCase.significanceSummary || recordAnswers.matters),
      fromRecord: !legalCase.significanceSummary && Boolean(recordAnswers.matters),
    },
    {
      id: "ruling-outcome",
      question: "What was the ruling or outcome?",
      answer: verifiedOutcome
        ?? recordAnswers.outcome
        ?? "",
      sourceUrl: verifiedOutcome ? legalCase.holdingSourceUrl ?? legalCase.dispositionSourceUrl : null,
      available: Boolean(verifiedOutcome || recordAnswers.outcome),
      fromRecord: !verifiedOutcome && Boolean(recordAnswers.outcome),
    },
    {
      id: "latest-update",
      question: "What happened most recently?",
      answer: latestEvent
        ? `${formatPublicCaseDate(latestEvent.date) ?? latestEvent.date}: ${latestEvent.label}`
        : "",
      sourceUrl: null,
      available: Boolean(latestEvent),
      fromRecord: false,
    },
  ] as const;
  const filedAt = legalCase.filedOn ? Date.parse(`${legalCase.filedOn}T00:00:00Z`) : Number.NaN;
  const recentlyFiled = !legalCase.decidedOn
    && Number.isFinite(filedAt)
    && Date.now() - filedAt <= 45 * 24 * 60 * 60 * 1000;

  // The court's own opinion (not a dissent or concurrence) is the only text the summary reads.
  const majorityOpinion = readableDocuments.find((document) => document.perCuriam || /majority|lead|combined/i.test(document.opinionType ?? ""))
    ?? (primaryOpinion && !/dissent|concur|rehearing/i.test(primaryOpinion.opinionType ?? "") ? primaryOpinion : undefined);
  // Plain-English motions: trial and bankruptcy courts only (appellate dockets list briefs, not motions to the trial judge).
  const motionGuide = legalCase.courtKind === "district" || legalCase.courtKind === "bankruptcy"
    ? buildMotionGuide(docketEntries.map((entry) => ({ entryNumber: entry.entryNumber, filedOn: entry.filedOn, description: entry.description, publicId: entry.publicId })))
    : [];
  const decidedSupremeCourt = legalCase.courtKind === "supreme" && Boolean(legalCase.decidedOn);
  const [narrativeTargets, standingSignals, citationReach, similarCases, opinionSplit]=await Promise.all([
    publicCitationTargets(sql, [
      ...caseAnswers.map(answer=>answer.answer), legalCase.backgroundSummary,
      legalCase.significanceSummary, legalCase.questionPresented, legalCase.exactHolding,
    ].filter(Boolean).join(" ")),
    loadCaseStandingSignals(sql, caseId, majorityOpinion?.publicId ?? null),
    decidedSupremeCourt && citationCounts.citedBy > 0 ? loadCitationReach(sql, caseId) : Promise.resolve(null),
    // Cases like this: shared, less-often-cited authorities (only when this case cites something on Jurvio).
    citedCases.length > 0 ? loadSimilarCases(sql, caseId).catch(() => []) : Promise.resolve([]),
    // Circuit split sentences from the Court's own opinion (Supreme Court cases).
    isSupremeCourt && majorityOpinion ? loadCaseCircuitSplit(sql, caseId, majorityOpinion.publicId).catch(() => null) : Promise.resolve(null),
  ]);
  const todayNewYork = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const keyDatesAhead = readKeyDatesAhead(docketEntries.map((entry) => ({ publicId: entry.publicId, entryNumber: entry.entryNumber, filedOn: entry.filedOn, description: entry.description })), todayNewYork, 6, legalCase.terminatedOn ?? legalCase.decidedOn ?? null);
  const questionSplit = isSupremeCourt && !opinionSplit ? readCircuitSplit(legalCase.questionPresented) : [];
  const circuitSplit = opinionSplit
    ? { sentences: opinionSplit.sentences, sourcePath: `/case/${caseId}/documents/${opinionSplit.documentPublicId}`, sourceLabel: "the Court’s opinion" }
    : questionSplit.length ? { sentences: questionSplit, sourcePath: legalCase.questionSourceUrl ?? `/case/${caseId}`, sourceLabel: "the question presented" } : null;
  // "What this means going forward": the syllabus "Held:" point, else the verified holding quote.
  const syllabusHeld = decidedSupremeCourt ? readSyllabusHeld(standingSignals.opinionHead) : null;
  const ramificationsHolding: RamificationsHolding | null = syllabusHeld
    ? { kind: "syllabus", holding: syllabusHeld, readPath: majorityOpinion ? `/case/${caseId}/documents/${majorityOpinion.publicId}` : opinionPath,
        officialUrl: (majorityOpinion ?? primaryOpinion)?.sourceDownloadUrl ?? sourceDocument?.sourceDownloadUrl ?? null }
    : legalCase.exactHolding
      ? { kind: "verified", holding: { text: legalCase.exactHolding, truncated: false }, readPath: null, officialUrl: legalCase.holdingSourceUrl }
      : null;
  // Circuit Justice: this court's circuit, or for a Supreme Court case the court of appeals it came from.
  const ownCircuitJustice = circuitJusticeFor(legalCase.courtCode);
  const belowCircuitJustice = ownCircuitJustice ? null
    : circuitJusticeForCircuit(circuitOfCourtName(legalCase.lowerCourtName ?? standingSignals.scotusDocket?.lowerCourt));
  // Federal district cases the docket shows as open but the FJC statistics show as closed: say so in the quick answer too.
  const fjcClosedOn = !legalCase.terminatedOn ? standingSignals.fjcOutcome?.terminatedOn ?? null : null;
  const shownAnswers = caseAnswers.map((item) => fjcClosedOn && item.id === "what-happened"
    ? { ...item, answer: item.answer.replace("No closing date appears in the court records we have.",
      `The Federal Judicial Center's case statistics show the case was closed on ${formatPublicCaseDate(fjcClosedOn) ?? fjcClosedOn}.`) }
    : item);
  const standing = buildCaseStanding({
    courtKind: legalCase.courtKind ?? "other",
    courtName: legalCase.courtName,
    caption,
    decidedOn: legalCase.decidedOn,
    filedOn: legalCase.filedOn,
    terminatedOn: legalCase.terminatedOn ?? null,
    dispositionScope: legalCase.dispositionScope,
    verified,
    exactDisposition: legalCase.exactDisposition,
    dispositionSourceUrl: legalCase.dispositionSourceUrl,
    exactHolding: legalCase.exactHolding,
    holdingSourceUrl: legalCase.holdingSourceUrl,
    lowerCourtName: legalCase.lowerCourtName,
    clusterDisposition: standingSignals.clusterDisposition,
    precedentialStatus: standingSignals.precedentialStatus,
    opinionTail: standingSignals.opinionTail,
    opinionHead: standingSignals.opinionHead,
    opinionPath: majorityOpinion ? `/case/${caseId}/documents/${majorityOpinion.publicId}` : opinionPath,
    opinionIsMajority: Boolean(majorityOpinion),
    overruled: standingSignals.overruled,
    votes: standingSignals.votes,
    citedByCount: citationCounts.citedBy,
    citedByPath: citationCounts.citedBy ? "#cited-by" : null,
    docketEntries,
    docketPath: `/case/${caseId}/docket`,
    scotusDocket: standingSignals.scotusDocket,
    fjcOutcome: standingSignals.fjcOutcome,
    questionsPresented: standingSignals.questionsPresented,
  });
  // Citations become links; the plain stretches get dictionary-term tooltips
  // (first mention of each term per section, see createTermMarker).
  const linkedText=(text:string, marker:TermMarker)=><CitedCaseText text={text} targets={narrativeTargets}
    renderText={(plain)=><TermText text={plain} marker={marker} />} />;
  const marked=(text:string|null|undefined, marker:TermMarker)=><TermText text={text} marker={marker} />;
  const lineupMarker=createTermMarker("lineup");
  const timelineMarker=createTermMarker("timeline");
  const documentsMarker=createTermMarker("documents");
  const partiesMarker=createTermMarker("parties");
  const statusMarker=createTermMarker("status");
  const holdingMarker=createTermMarker("holding");
  const standsMarker=createTermMarker("stands");
  const summaryMarker=createTermMarker("summary");
  const requestHeaders = await headers();
  await recordDemandEvent(sql, {
    eventType: "page_view",
    userAgent: requestHeaders.get("user-agent"), headers: requestHeaders,
    referrer: requestHeaders.get("referer"),
    path: canonicalPath,
    contentKind: "case",
    targetType: "case",
    targetPublicId: caseId,
  });

  // One numbered Sources list for every outside source and official link on the page (sections point into it).
  const sources = new CaseSourceList();
  for (const point of standing?.points ?? []) {
    // Quotes from one document share its source line ("Question 1, from the questions presented" → "The questions presented").
    for (const quote of point.quotes ?? []) sources.add(quote.sourceLabel.replace(/^Question \d+, from the questions/i, "The questions"), quote.sourceHref);
    sources.add(point.sourceLabel, point.sourceHref);
  }
  const journeySteps = journey ? buildCaseJourney(journey) : [];
  for (const step of journeySteps) sources.add(step.sourceLabel, step.sourceUrl);
  const shownNotes = justiceNotes?.notes ?? [];
  if (justiceNotes && shownNotes.length) {
    sources.add(`Supreme Court docket, No. ${justiceNotes.docketNumber}`, justiceNotes.sourceUrl);
    for (const note of shownNotes) sources.add(`${note.name}: ${noteLabel(note.kind, note.context).toLowerCase()} (PDF)`, note.opinionUrl);
    sources.add("Supreme Court 101 (how the Court picks cases; the Rule of Four)", RULE_OF_FOUR_SOURCE);
  }
  if (scdbLineup) {
    sources.add("Supreme Court Database (vote lineup)", SCDB_HOME);
    sources.add("Supreme Court Database: how decision direction is coded", SCDB_DIRECTION_DOC);
  }
  sources.add("What happened: official source", legalCase.backgroundSourceUrl);
  sources.add("Question presented: official petition", legalCase.questionSourceUrl);
  sources.add("Why it matters: official source", legalCase.significanceSourceUrl);
  sources.add("Holding: official source", legalCase.holdingSourceUrl);
  sources.add("Disposition: official source", legalCase.dispositionSourceUrl);
  if (decidedSupremeCourt) sources.add("The opinion: official copy", ramificationsHolding?.officialUrl);
  if (opinionNotice) sources.add(opinionNotice.linkLabel, opinionNotice.href);
  for (const document of documents) sources.add(`${publicDocumentType(document.documentType)}: ${document.title} (official copy)`, document.sourceDownloadUrl);
  for (const item of agencyItems) sources.add(`${item.publisher}: ${item.title}`, item.sourceUrl);
  if (ownCircuitJustice ?? belowCircuitJustice) {
    sources.add("Circuit Justice: Supreme Court allotment order", ALLOTMENT_SOURCE_URL);
    sources.add("Circuit Justice: the Court's guide to applications (PDF)", APPLICATIONS_GUIDE_URL);
  }
  const ref = (href: string) => <SourceRef n={sources.number(href) ?? sources.add(null, href)} />;

  // The summary card: the stands headline and points, re-used (no new claims).
  const summary = summaryFromStanding(standing);
  // Each fact once: "Where this case stands" keeps only what the card doesn't already say.
  const stands = standingAfterSummary(standing);
  const cardSource = (source: CardLineSource | null) => !source ? null
    : source.href.startsWith("/") || source.href.startsWith("#")
      ? <span className="cdLineSource"> <a href={source.href}>{source.label}</a></span>
      : <SourceRef n={sources.number(source.href) ?? sources.add(source.label, source.href)} />;
  const whatHappened = summary.whatHappened ?? shownAnswers.find((item) => item.id === "what-happened")?.answer ?? caption;
  const keyDate = pickKeyDate({
    courtKind: legalCase.courtKind ?? "other",
    decidedOn: legalCase.decidedOn,
    terminatedOn: legalCase.terminatedOn ?? null,
    filedOn: legalCase.filedOn,
    fjcClosedOn,
    certStatus: standingSignals.scotusDocket?.certStatus ?? justiceNotes?.certStatus ?? null,
    certStatusOn: standingSignals.scotusDocket?.certStatusOn ?? justiceNotes?.certStatusOn ?? null,
  });
  // The key date row is left out when the status line above it already states that date ("closed this case on May 22, 2019").
  const keyDateDisplay = keyDate ? formatPublicCaseDate(keyDate.date) ?? keyDate.date : null;
  const keyDateShown = keyDate && keyDateDisplay && !(summary.goingForward ?? "").includes(keyDateDisplay) ? { ...keyDate, display: keyDateDisplay } : null;
  const summaryFacts: Array<[string, ReactNode]> = [
    ...(legalCase.hasReadableOpinion && opinionPath ? [["Opinion", <Link key="o" href={opinionPath as Route}>Read on Jurvio</Link>] as [string, ReactNode]]
      : opinionNotice ? [["Opinion", <>Official copy{ref(opinionNotice.href)}</>] as [string, ReactNode]] : []),
  ];

  // The opinion record's lineup (author, opinion type, vote), shown only when it has something to say.
  const decisionLineup = legalCase.decisionLineup;
  const decisionDetail = decisionLabel || opinionType || decisionLineup?.voteBreakdown?.label || decisionLineup?.justiceVotes?.length
    || decisionLineup?.joins?.length || decisionLineup?.separateOpinions?.length ? (
    <div className="cdDecisionLineup">
      <h3 className="cdSub" id="decision-lineup">Decision lineup, from the opinion record</h3>
      {decisionLabel ? <p className="verifiedDetail">Written by: {marked(decisionLabel, lineupMarker)}</p> : null}
      {opinionType ? <p className="verifiedDetail">Opinion type: {marked(opinionType, lineupMarker)}</p> : null}
      {decisionLineup?.voteBreakdown?.label ? <p className="verifiedDetail">Final vote: {decisionLineup.voteBreakdown.label}</p> : null}
      {decisionLineup?.justiceVotes?.length ? (
        <dl className="caseStatusGrid justiceVoteGrid" aria-label="Justice votes">
          {decisionLineup.justiceVotes.map((vote) => (
            <div key={vote.justice}><dt>{formatJusticeName(vote.justice)}</dt><dd>{marked(formatJusticePosition(vote.position), lineupMarker)}</dd></div>
          ))}
        </dl>
      ) : (
        <>
          {decisionLineup?.joins?.length ? <p className="verifiedDetail">Joined by: {decisionLineup.joins.map(formatJusticeName).join(", ")}</p> : null}
          {decisionLineup?.separateOpinions?.map((opinion) => <p className="verifiedDetail" key={opinion.author + opinion.type}>{formatJusticeName(opinion.author)}: {marked(formatJusticePosition(opinion.type), lineupMarker)}</p>)}
        </>
      )}
    </div>
  ) : null;
  const hasJustices = isSupremeCourt && (shownNotes.length > 0 || Boolean(scdbLineup) || Boolean(decisionDetail));
  const citationTotal = citationCounts.cited + citationCounts.citedBy + citedCases.length + citingCases.length + (citations.stubs?.length ?? 0);
  const shownQuickAnswers = shownAnswers.filter((item) => item.available);
  // The case record repeats a summary only when the quick answers above it don't already say it word for word.
  const quickAnswerTexts = new Set<string>(shownQuickAnswers.map((item) => item.answer));

  // One glossary for the terms the page uses; the inline tooltips stay on first mention.
  const glossary: PlainTerm[] = [...new Map(termsInText([
    whatHappened, summary.whoWon, summary.goingForward,
    ...(standing?.points ?? []).flatMap((point) => [point.text, point.label, ...(point.items ?? []).map((item) => item.label)]),
    ...shownNotes.flatMap((note) => [note.sentence, noteLabel(note.kind, note.context)]),
    ...motionGuide.flatMap((motion) => Object.values(motion).filter((value): value is string => typeof value === "string")),
    ...shownQuickAnswers.map((item) => item.answer), legalCase.statusExplanation, outcome, opinionType,
    ...timelineEvents.map((event) => event.label), ...availableDocumentTypes, ...parties.map((party) => publicPartyRole(party.role)),
  ].filter(Boolean).join(" \n ")).map((term) => [term.key, term])).values()].sort((left, right) => left.term.localeCompare(right.term));

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

  const circuitJustice = ownCircuitJustice ?? belowCircuitJustice;
  // Which sections render (the chip bar lists exactly these, in page order).
  const show = {
    stands: Boolean(stands?.standing.points.length),
    datesAhead: keyDatesAhead.length > 0,
    forward: decidedSupremeCourt || Boolean(circuitSplit),
    journey: journeySteps.length > 0 || onwardSupremeCourt.length > 0,
    justices: hasJustices,
    motions: motionGuide.length > 0,
    citations: citationTotal > 0 || similarCases.length > 0,
    docket: timelineEvents.length > 0,
    documents: documents.length > 0 || Boolean(opinionNotice) || Boolean(opinionPath) || (!isSupremeCourt && Boolean(decisionDetail)),
    parties: parties.length > 0,
    record: true,
    news: newsLinks.length > 0,
    agency: agencyItems.length > 0,
    circuitJustice: Boolean(circuitJustice),
    sources: sources.links.length > 0,
    glossary: glossary.length > 0,
  };
  const chipLabels: Record<keyof typeof show, string> = {
    stands: "Where it stands", datesAhead: "Dates ahead", forward: "Going forward", journey: "Journey", justices: "Justices",
    motions: "Motions", citations: "Citations", docket: "Docket", documents: "Documents", parties: "Parties", record: "Record",
    news: "News", agency: "Agency", circuitJustice: "Circuit Justice", sources: "Sources", glossary: "Glossary",
  };
  const sectionIds: Record<keyof typeof show, string> = {
    stands: "stands", datesAhead: "dates-ahead", forward: "going-forward", journey: "journey", justices: "justices", motions: "motions",
    citations: "citations", docket: "docket", documents: "documents", parties: "parties", record: "record", news: "news", agency: "agency",
    circuitJustice: "circuit-justice", sources: "sources", glossary: "glossary",
  };
  const chips: SectionChip[] = (Object.keys(show) as Array<keyof typeof show>).filter((key) => show[key]).map((key) => ({ id: sectionIds[key], label: chipLabels[key] }));
  return (
    <main className="shell caseShell scotusCaseShell cdShell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />
      <CaseSectionOpener />
      <div className="cdLayout">
        <div className="cdHead" id="top" tabIndex={-1}>
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
        </div>

        <aside className="cdRail" aria-label="Case summary">
          <CaseSummaryCard
            whatHappened={marked(whatHappened, summaryMarker)}
            whoWon={summary.whoWon ? <>{marked(summary.whoWon, summaryMarker)}{cardSource(stands?.whoWonSource ?? null)}</> : null}
            goingForward={summary.goingForward ? <>{marked(summary.goingForward, summaryMarker)}{cardSource(stands?.goingForwardSource ?? null)}</> : null}
            goingForwardLabel={summary.goingForwardLabel}
            whoWonLabel={(standing?.points.find((point) => point.id === "who-won")?.label ?? "Who won?").replace(/\?$/, "").replace(/^How did it end$/, "How it ended")}
            keyDate={keyDateShown}
            facts={summaryFacts}
            follow={followEligible ? <details className="cdFollow" id="follow"><summary>Follow this case</summary>
              <FollowCaseBox caseId={caseId} citationsFirst={Boolean(legalCase.decidedOn || legalCase.terminatedOn)} />
              <FollowCaseExtras caption={caption} natureOfSuit={legalCase.natureOfSuit} /></details> : null}
            tools={<CaseCardActions permanentUrl={permanentUrl} shareTitle={caption} citation={legalCase.officialCitation} summaryPath={`/case/${caseId}/summary`} />}
            note={standing ? <>Plain-English summary, not legal advice. <a href="#about-summary">How we write it</a></> : null}
          />
        </aside>

        <div className="cdMain">
        <CaseSectionBar chips={chips} />

        {show.stands && stands ? <CaseSection id="stands" title="Where this case stands" open hint={standsHint(stands.inside)}>
          <CaseStandingSection standing={stands.standing} compact sourceRef={ref} renderText={(text) => marked(text, standsMarker)} />
        </CaseSection> : null}

        {show.datesAhead ? <CaseSection id="dates-ahead" title="Key dates ahead" open hint={`${keyDatesAhead.length} upcoming ${keyDatesAhead.length === 1 ? "date" : "dates"} from the docket`} hideHeading>
          <KeyDatesAheadSection dates={keyDatesAhead} caseId={caseId} today={todayNewYork} />
        </CaseSection> : null}

        {show.forward ? <CaseSection id="going-forward" title="What this means going forward" hideHeading={!circuitSplit} hint={citationCounts.citedBy ? `Cited by ${citationCounts.citedBy.toLocaleString("en-US")} on Jurvio` : undefined}>
          {decidedSupremeCourt ? <CaseRamificationsSection holding={ramificationsHolding} reach={citationReach} citedByCount={citationCounts.citedBy} /> : null}
          {circuitSplit ? <CircuitSplitSection {...circuitSplit} /> : null}
        </CaseSection> : null}

        {show.journey ? <CaseSection id="journey" title="Case journey" hideHeading={!onwardSupremeCourt.length}
          hint={journeySteps.length ? `${journeySteps.length} steps, from the court below to the Supreme Court` : "This case went on to the Supreme Court"}>
          {journey && journeySteps.length ? <CaseJourneySection journey={journey} benchmarks={journeyBenchmarks} sourceRef={ref} /> : null}
          {onwardSupremeCourt.length ? <OnwardSupremeCourtSection cases={onwardSupremeCourt} /> : null}
        </CaseSection> : null}

        {show.justices ? <CaseSection id="justices" title="How the justices voted" hint={justicesHint(justiceNotes, scdbLineup) ?? undefined}>
          <CaseJusticesVoted notes={justiceNotes} lineup={scdbLineup} extra={decisionDetail} />
        </CaseSection> : null}

        {show.motions ? <CaseSection id="motions" title="Motions" hideHeading hint={`${motionGuide.length} ${motionGuide.length === 1 ? "motion" : "motions"} in plain English`}>
          <CaseMotionsSection motions={motionGuide} caseId={caseId} scanned={docketEntries.length} />
        </CaseSection> : null}

        {show.citations ? <CaseSection id="citations" title="Citations"
          hint={[citationCounts.cited || citedCases.length ? `Cites ${Math.max(citationCounts.cited, citedCases.length).toLocaleString("en-US")}` : null, citationCounts.citedBy ? `cited by ${citationCounts.citedBy.toLocaleString("en-US")}` : null].filter(Boolean).join(" · ") || undefined}>
          <CitationCaseList title="Cases cited" cases={citedCases} total={citationCounts.cited}
            summary={citationCounts.cited ? citationCountLine(citationCounts.cited, citationCounts.citedOnJurvio) : undefined} />
          <CitedStubList stubs={citations.stubs ?? []} />
          <CitationCaseList id="cited-by" title="Cited by" cases={citingCases} total={citationCounts.citedBy}
            summary={citationCounts.citedBy ? `At least ${citationCounts.citedBy.toLocaleString("en-US")} ${citationCounts.citedBy === 1 ? "case" : "cases"} on Jurvio ${citationCounts.citedBy === 1 ? "cites" : "cite"} this case` : undefined} />
          <SimilarCasesSection cases={similarCases} />
        </CaseSection> : null}

        {legalCase.courtKind === "district" ? <CaseSection id="district-record" title="Case record" open hint="From the court feed and the case record">
          <dl className="caseMeta">
            {legalCase.judgeName ? <div><dt>Assigned judge</dt><dd>{legalCase.judgeName}</dd></div> : null}
            {docketCaseType(legalCase.docketNumber) ? <div><dt>Case type</dt><dd>{docketCaseType(legalCase.docketNumber)}</dd></div> : null}
            {formatCauseOfAction(legalCase.causeOfAction) ? <div><dt>Cause</dt><dd>{formatCauseOfAction(legalCase.causeOfAction)}</dd></div> : null}
            {parseNatureOfSuit(legalCase.natureOfSuit) ? <div><dt>Nature of suit</dt><dd>{parseNatureOfSuit(legalCase.natureOfSuit)?.label}</dd></div> : null}
          </dl>
          <p>{DOCKET_FEED_NOTE}</p>
          <p>{ALLEGATION_NOTE}</p>
          {docketEntries.some((entry) => docketEntryKind(entry.description) === "order") ? (
            <>
              <h3>Orders and rulings</h3>
              <ul>
                {docketEntries.filter((entry) => docketEntryKind(entry.description) === "order").map((entry) => {
                  const outcome = statedOutcome(entry.description);
                  const partiesNamed = namedParties(entry.description, parties.flatMap((party) => [party.displayName, party.nameAsFiled]));
                  return (
                    <li key={entry.publicId}>
                      {entry.filedOn ? <time dateTime={entry.filedOn}>{formatPublicCaseDate(entry.filedOn) ?? entry.filedOn}</time> : null}
                      {" "}{entry.description}
                      {outcome ? <span> Outcome stated in the entry: {outcome}</span> : null}
                      {partiesNamed.length ? <span> Names {partiesNamed.join(", ")}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </CaseSection> : null}

        {show.docket ? <CaseSection id="docket" title="Docket & timeline"
          hint={`${timelineEvents.length.toLocaleString("en-US")} dated ${timelineEvents.length === 1 ? "event" : "events"}${latestEvent ? `, latest ${formatPublicCaseDate(latestEvent.date) ?? latestEvent.date}` : ""}`}>
          <ol className="caseMilestones" id="case-timeline">
            {timelineEvents.map((event) => (
              <li key={event.date + event.label}>
                <time dateTime={event.date}>{formatPublicCaseDate(event.date) ?? event.date}</time>
                <span>{marked(event.label, timelineMarker)}</span>
              </li>
            ))}
          </ol>
          {docketEntries.length > 0 ? <p className="cdMore"><Link href={`/case/${caseId}/docket` as Route}>Full docket →</Link> · <Link href={`/case/${caseId}/timeline` as Route}>View complete available timeline →</Link></p> : null}
        </CaseSection> : null}

        {show.documents ? <CaseSection id="documents" title="Opinion & documents"
          hint={documents.length ? `${documents.length.toLocaleString("en-US")} ${documents.length === 1 ? "document" : "documents"}` : undefined}>
          {opinionNotice ? <p className="cdLead" id="opinion-official-source">{opinionNotice.heading}. {opinionNotice.body} {opinionNotice.linkLabel}{ref(opinionNotice.href)}</p> : null}
          {opinionPath ? <nav className="opinionQuickLinks" aria-label="Opinion reading tools" id="read-opinion">
            <Link href={opinionPath as Route}>Read the opinion</Link>
            <Link href={`${opinionPath}#opinion-reader-tools` as Route}>Search</Link>
            <Link href={`${opinionPath}#opinion-reader-tools` as Route}>Contents</Link>
            {opinionType ? <Link href={`${opinionPath}#opinion-text` as Route}>{opinionType}</Link> : null}
            {primaryOpinion?.hasReportersNote ? <Link href={`${opinionPath}#reporters-note-heading` as Route}>Reporter’s Note</Link> : null}
          </nav> : null}
          {!isSupremeCourt ? decisionDetail : null}
          {documents.length > 0 ? <>
            <ul className="cdDocs" id="available-documents">
              {documents.map((document) => (
                <li key={document.publicId}>
                  <span className="cdDocType">{marked(publicDocumentType(document.documentType), documentsMarker)}{document.filedOn ? <> · <time dateTime={document.filedOn}>{formatPublicCaseDate(document.filedOn) ?? document.filedOn}</time></> : null}</span>
                  <span className="cdDocTitle">{document.hasReadableContent ? <Link href={`/case/${caseId}/documents/${document.publicId}` as Route}>{document.title}</Link> : document.title}
                    {document.sourceDownloadUrl ? <> · official copy{ref(document.sourceDownloadUrl)}</> : null}</span>
                </li>
              ))}
            </ul>
            <p className="cdMore"><Link href={`/case/${caseId}/documents` as Route}>View available documents →</Link></p>
          </> : null}
        </CaseSection> : null}

        {show.parties ? <CaseSection id="parties" title="Parties" hint={`${parties.length.toLocaleString("en-US")} named in the record`}>
          <p className="cdMuted">Being named in a case does not establish liability, wrongdoing, or guilt.</p>
          <ul className="cdParties" id="named-parties">
            {parties.slice(0, 8).map((party) => <li key={party.publicId + ":" + party.role}><span>{party.displayName}</span> <span className="cdMuted">{marked(publicPartyRole(party.role), partiesMarker)}</span>{followEligible ? <FollowEntityButton kind="party" target={party.publicId} name={party.displayName} compact /> : null}</li>)}
          </ul>
          <p className="cdMore"><Link href={`/case/${caseId}/parties` as Route}>View all parties →</Link></p>
        </CaseSection> : null}

        <CaseSection id="record" title={recentlyFiled ? "This case was recently filed" : "What the court record tells us"} hint="Quick answers, the question presented and the holding">
          <p className="cdMuted">
            {recentlyFiled
              ? "This case is new. More details, documents, and updates will appear here as the court record grows."
              : "Short answers drawn from the court record. If the record doesn't say, we leave it out rather than guess."}
          </p>
          <dl className="cdAnswers" id="case-answers">
            {shownQuickAnswers.map((item) => (
              <div id={item.id} key={item.id}>
                <dt>{item.question}</dt>
                <dd>{linkedText(item.answer, createTermMarker(`answer-${item.id}`))}{item.sourceUrl ? ref(item.sourceUrl) : <span className="cdMuted"> (from the court record)</span>}</dd>
              </div>
            ))}
          </dl>
          <h3 className="cdSub" id="understand-case">Case record</h3>
          {verified && legalCase.statusExplanation ? (
            <p className="statusExplanation">{linkedText(legalCase.statusExplanation, statusMarker)}</p>
          ) : (
            <p className="verifiedFactSummary">
              <BrandedCaseCaption caption={caption} /> is {legalCase.courtName} case number {legalCase.docketNumber}.
              {readableDocuments.length > 0
                ? ` Jurvio currently provides ${readableDocuments.length.toLocaleString()} readable court ${readableDocuments.length === 1 ? "document" : "documents"} for this case.`
                : ""}
            </p>
          )}
          {legalCase.backgroundSummary && !quickAnswerTexts.has(legalCase.backgroundSummary) ? <><h3 className="cdSub">What happened</h3><p>{linkedText(legalCase.backgroundSummary, createTermMarker("background"))}{legalCase.backgroundSourceUrl ? ref(legalCase.backgroundSourceUrl) : null}</p></> : null}
          {legalCase.significanceSummary && !quickAnswerTexts.has(legalCase.significanceSummary) ? <><h3 className="cdSub">Why it matters</h3><p>{linkedText(legalCase.significanceSummary, createTermMarker("significance"))}{legalCase.significanceSourceUrl ? ref(legalCase.significanceSourceUrl) : null}</p></> : null}
          {supportingStatusDetails.length > 0 ? (
            <dl className="caseStatusGrid">
              {supportingStatusDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{marked(value, statusMarker)}</dd></div>)}
            </dl>
          ) : null}
          {legalCase.questionPresented ? <>
            <h3 className="cdSub" id="question-presented">Question presented</h3>
            <p>{linkedText(legalCase.questionPresented, createTermMarker("question"))}{legalCase.questionSourceUrl ? ref(legalCase.questionSourceUrl) : null}</p>
          </> : null}
          {outcome || (legalCase.exactHolding && !quickAnswerTexts.has(legalCase.exactHolding)) ? <>
            <h3 className="cdSub" id="case-outcome">Holding and outcome</h3>
            {outcome ? <p>{marked(outcome, holdingMarker)}.</p> : null}
            {legalCase.exactHolding && !quickAnswerTexts.has(legalCase.exactHolding) ? <p><span className="cdMuted">The holding, quoted from the court: </span>{linkedText(legalCase.exactHolding, holdingMarker)}{legalCase.holdingSourceUrl ? ref(legalCase.holdingSourceUrl) : null}</p> : null}
          </> : null}
        </CaseSection>

        {show.news ? <CaseSection id="news" title="In the news" hideHeading hint={`${newsLinks.length} ${newsLinks.length === 1 ? "article" : "articles"}`}>
          <CaseNewsSection links={newsLinks} />
        </CaseSection> : null}

        {show.agency ? <CaseSection id="agency" title="Official agency sources" hideHeading hint={`${agencyItems.length} ${agencyItems.length === 1 ? "item" : "items"}`}>
          <OfficialAgencySources items={agencyItems} />
        </CaseSection> : null}

        {show.circuitJustice && circuitJustice ? <CaseSection id="circuit-justice" title="Circuit Justice" hint={`${circuitJustice.title} ${circuitJustice.justiceName}`}>
          <CircuitJusticeBox justice={circuitJustice}
            relation={ownCircuitJustice ? (legalCase.courtKind === "appellate" ? "circuit" : "court-in-circuit") : "court-below"} />
        </CaseSection> : null}

        {show.sources ? <CaseSection id="sources" title="Sources" hint={`${sources.links.length} official ${sources.links.length === 1 ? "source" : "sources"} and links`}>
          <CaseSources links={sources.links} />
        </CaseSection> : null}

        {show.glossary ? <CaseSection id="glossary" title="Glossary" hint={`${glossary.length} ${glossary.length === 1 ? "term" : "terms"} used on this page`}>
          <CaseGlossary terms={glossary} />
        </CaseSection> : null}

        <footer className="cdFoot">
          {standing ? <p id="about-summary"><strong>Plain-English summary, not legal advice.</strong> Generated from the court record by fixed rules; quotes are the court&apos;s own words. If the record doesn&apos;t say, we say so instead of guessing.</p> : null}
          <p className="cdFootLinks">More on this case: {caseSections.filter(([, suffix]) => suffix).map(([label, suffix], index) => <span key={label}>{index ? " · " : ""}<Link href={`/case/${caseId}${suffix}` as Route}>{label}</Link></span>)}</p>
        </footer>
        </div>
      </div>
      <BackToTop />
    </main>
  );
}
