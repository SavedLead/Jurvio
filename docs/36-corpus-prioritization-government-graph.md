# Corpus Prioritization, Court Taxonomy, and Government Graph

Status: **Approved and locked**  
Decision date: 2026-07-21

## Outcome

Jurvio will launch federal-first and interest-first. It will not ingest every case from one court merely because that court is convenient to obtain. It will select the highest-value matters across peer courts, publish the most consequential documents first, and use measured demand to determine the next ingestion and enrichment work.

The first public corpus will center on readable primary law, Supreme Court matters, federal executive action, litigation involving the administration and federal agencies, and the court-system explainers required to understand those materials.

## Court taxonomy

Jurvio must distinguish the source and legal authority of each adjudicative body.

1. **Article III judiciary:** Supreme Court, courts of appeals, district courts, and Court of International Trade.
2. **Article I legislative courts and adjudicators:** including the Tax Court, Court of Federal Claims, Court of Appeals for Veterans Claims, Court of Appeals for the Armed Forces, bankruptcy courts, and magistrate judges, with the precise statutory relationship recorded rather than flattened.
3. **Territorial courts:** courts established under Congress's territorial authority, classified separately from Article III courts.
4. **Executive-branch administrative adjudication:** immigration courts and the Board of Immigration Appeals within DOJ, plus agency administrative law judges and boards. These are not presented as Article III courts.
5. **State, local, tribal, and other courts:** separate systems with their own authority, hierarchy, geography, and operating status.

There is no product category called an "Article V court." Article V concerns constitutional amendments.

Every imported court/source record must be classified as one of:

- active court;
- historical court;
- administrative tribunal or board;
- reporter, opinion series, or non-court source;
- training/test record;
- unknown and withheld for review.

A provider record is not automatically a publishable court page. Jurvio will not turn CourtListener's 3,360 catalog records into 3,360 indexable pages. The snapshot includes active and inactive courts, historical bodies, administrative sources, tribal courts, report series, and test records. Only verified, useful entities receive indexable pages.

## Launch corpus order

### Tier 1 — Supreme Court

- All merits cases for the current term and the four preceding terms.
- All opinions, judgments, briefs, oral-argument transcripts and audio, lower-court decisions, and case timelines available from lawful authoritative sources.
- All emergency applications, orders, administrative stays, responses, replies, and separate writings for the same period.
- The public label is **Supreme Court Emergency & Orders Docket**. Pages may explain that this is often called the "shadow docket," but Jurvio will not treat that informal phrase as an official court classification.
- Backfill older terms after launch in reverse chronological order.

Each Supreme Court matter receives a source-grounded plain-English summary, question presented, procedural history, outcome, vote, current legal effect, and "what happens next." Because this is a high-interest, bounded corpus, summaries may be generated proactively, with citations, confidence state, versioning, and quality review.

### Tier 2 — Executive action and administration litigation

- Ingest every executive order available from authoritative sources, beginning with the current administration and backfilling earlier administrations.
- Also ingest legally consequential presidential memoranda and proclamations when they create or materially alter policy.
- Ingest federal rules, agency actions, and implementation documents when connected to litigation.
- Select cases nationwide through deterministic links: the United States, President, or federal agency as a party; an executive-order number; a Federal Register citation; a challenged rule; a DOJ case announcement; or an explicit reference in a complaint or ruling.
- Track the chain: executive action -> agency implementation -> lawsuit -> trial ruling -> appeal -> Supreme Court application/order -> current effect.

Jurvio uses neutral status language such as "challenged," "defended," "enjoined," "stayed," "partly in effect," and "vacated." It does not supply political commentary or predictions presented as fact.

### Tier 3 — High-interest federal opinions and dispositive matters

Select matters across courts at the same level, rather than completing one court at a time. Initial deterministic interest signals include:

- cited or frequently cited opinions;
- published or precedential appellate decisions;
- publicly traded companies, elected officials, major institutions, and federal agencies as parties;
- constitutional, regulatory, election, antitrust, securities, labor, civil-rights, immigration, environmental, and other high-interest topics;
- emergency relief, preliminary injunctions, motions to dismiss, summary judgment, class certification, conviction, sentencing, settlement approval, and final judgment;
- reliable coverage or official agency announcements;
- strong internal search demand, external referrals, summary requests, saves, or alerts.

Interest affects processing priority, not truth, prominence of one side, or editorial viewpoint.

## Document priority

Jurvio's first CaseText-like value is readable primary authority with context. Documents are processed in this order:

1. opinions, judgments, verdicts, and orders resolving claims or emergency relief;
2. complaints, indictments, petitions, and notices initiating or defining the dispute;
3. dispositive and major motions, responses, replies, and appellate or Supreme Court briefs;
4. exhibits and other documents necessary to understand a major ruling;
5. routine docket administration.

Every published document keeps the original file, source, retrieval date, checksum, and page/paragraph anchors. HTML is a faithful reading layer, not a replacement for the source artifact. Deterministic extraction and court-provided text are preferred; OCR is used when necessary; LLMs do not silently rewrite primary law.

## CaseText void Jurvio will address

The initial professional research loop is:

1. find relevant authority across jurisdictions;
2. read the decision in clean, linked HTML;
3. understand the holding, posture, treatment, and current status;
4. see why a cited case matters in this context;
5. move to the briefs and motions that produced the ruling;
6. find cited, citing, and meaningfully similar matters;
7. upload or select a document to find related authority;
8. request a source-grounded plain-English explanation when needed.

Search, readable opinions, and ordinary deterministic recommendations remain broadly free during adoption. Expensive AI work is metered, queued, cached, and generated once for reuse.

## Jurvio Learn

Jurvio will publish its own neutral, cited court-system guide rather than relying only on external explanations. Initial pages include:

- how the three branches of the federal government work;
- federal versus state courts;
- Article III, Article I, territorial, and administrative adjudication;
- how a federal civil and criminal case moves;
- jurisdiction, removal, appeals, precedent, and standards of review;
- motions to dismiss, preliminary injunctions, summary judgment, trial, and judgment;
- Supreme Court merits cases and the Emergency & Orders Docket;
- immigration courts and agency adjudication;
- a versioned legal glossary with contextual definitions.

Each concept has a short fifth-grade-level explanation and an expandable professional explanation, with primary sources, last-reviewed date, and jurisdiction warnings.

## Three-branch government graph

The architecture will support a first-class `/government` hub:

- `/government/executive`: administrations, presidents, agencies, executive orders, rules, memoranda, proclamations, and implementation actions;
- `/government/legislative`: Congresses, chambers, members, committees, bills, amendments, votes, sponsors, enacted public laws, and codification;
- `/government/judicial`: court systems, courts, judges, cases, dockets, documents, opinions, and cited authority.

Canonical relationships include:

`bill -> enacted public law -> U.S. Code section -> regulation or executive implementation -> litigation -> ruling -> appeal`

At launch, Jurvio may ingest structured metadata for all bills in the current Congress, but it will proactively explain enacted laws, high-interest pending bills, and legislation connected to active litigation. This prevents the legal-intelligence product from becoming an unfocused general-news site before demand is established.

## Day-one analytics and demand intelligence

Analytics are part of the ingestion architecture, not a later marketing add-on. Jurvio will distinguish human, known crawler, AI crawler, and authenticated API traffic where technically supportable, without invasive fingerprinting.

Core events include:

- entity and document views;
- referrer and landing-page class;
- internal query, filters, result click, and zero-result query;
- definition and citation-context opens;
- timeline and current-status interactions;
- summary/explanation requests and completions;
- saves, alerts, exports, and shares;
- recommendation impressions, clicks, and stated reason;
- bot/API identity and consumption volume;
- processing cost and freshness per entity.

The demand engine ranks ingestion and enrichment candidates using observed interest, authority, freshness, coverage gaps, expected reuse, and marginal cost. It produces recommendations for review; it does not automatically publish sensitive claims or use popularity as a truth signal.

## Recommendations

Every supported entity page includes useful, explainable recommendations:

- cases: cited/citing decisions, same executive action, statute, issue, judge, posture, parties, or procedural path;
- parties: related cases and verified organizations, counsel, and counterparties;
- judges: recent decisions, recurring topics, court, and appellate treatment;
- attorneys and firms: public cases, courts, clients represented in public matters, and legal topics;
- laws and executive actions: implementing agencies, affected provisions, challenges, rulings, and current legal effect.

Recommendations begin with deterministic graph relationships. Embeddings may improve recall later. Each recommendation displays a reason such as "challenges the same executive order" or "cites the same controlling decision." LLM output is never the source of an asserted relationship.

## Cost and publication controls

- Metadata first; primary documents second; deterministic enrichment third; AI enrichment last.
- Fetch and compute once, store the result, and reuse it across pages.
- Proactive AI summaries are limited initially to the bounded Supreme Court and highest-demand corpora.
- Other pages expose a request-summary action that enters a prioritized, budget-capped queue.
- Thin, duplicate, unclassified, or source-uncertain pages remain non-indexable.
- Every factual explanation links to primary material and states whether it is deterministic, editorially reviewed, or AI-assisted.

## Acceptance criteria

This decision is implemented when:

1. court records cannot be published without a verified taxonomy and operating status;
2. corpus candidates receive transparent priority signals and cost estimates;
3. Supreme Court merits and emergency matters have distinct data models and page templates;
4. executive actions can be linked through implementation and litigation to current legal effect;
5. document importance controls conversion, OCR, summary, and indexing priority;
6. analytics and recommendation events ship with the first public case pages;
7. government entities share stable identifiers and graph relationships rather than duplicated text blobs;
8. all summaries retain source anchors, version history, and disclosure of their creation method.
