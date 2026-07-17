# Gate 1 — Strategy Foundation

Status: Confirmed direction; detailed strategy package in progress  
Owner: David Rosenberg  
Updated: July 17, 2026

## Strategic wedge

Jurvio will launch as the easiest place on the open web to search for and understand federal litigation.

The initial differentiator is readable, sourced legal content inspired by the strongest part of the former Casetext experience:

- Judicial opinions and supported court documents presented as readable HTML
- Judgment and opinion summaries
- Plain-English explanations
- Clear procedural context
- Case timelines
- Connected parties, attorneys, judges, firms, courts, statutes, opinions, and related cases

Jurvio is not initially differentiated by a paywall, a generic AI assistant, or raw docket volume.

## Initial audience

The initial professional workflow will be designed primarily for small and midsize law firms, while public pages remain useful to:

- Individuals researching people or companies
- Businesspeople
- Investors
- Investigators
- Journalists
- Researchers
- Compliance professionals
- Other legal professionals

## Free-first adoption strategy

Jurvio will begin as a free product to maximize adoption, backlinks, search visibility, user feedback, and data about recurring behavior.

Monetization will be introduced only after Jurvio demonstrates which recurring workflows users value enough to pay for.

The architecture must preserve the ability to introduce paid tiers later without forcing premature feature gating.

Cost controls are mandatory:

- Use deterministic extraction and formatting wherever reliable.
- Do not AI-enrich every record automatically.
- Prioritize opinions, judgments, material orders, and pages with demonstrated demand or strategic value.
- Cache generated enrichments and reuse them.
- Track cost per ingested record, enriched record, indexed page, active user, search, and alert.
- Establish budgets and enrichment thresholds before large-scale processing.
- Allow low-cost metadata pages to exist without expensive AI enrichment.
- Consider on-demand generation for long-tail cases, followed by caching.
- Do not embed every document by default.

## Primary acquisition loop

Jurvio must be discoverable both through direct legal research and through “back-door” entity discovery.

A person searching Google or an AI search engine for a party or company may discover a Jurvio party page or case page, even when the user did not begin with a legal-research intent.

The intended loop is:

1. User searches for a person, company, case, lawyer, judge, or legal issue.
2. A high-quality Jurvio entity or case page appears.
3. Jurvio answers the immediate question accurately and neutrally.
4. The page introduces the connected litigation context.
5. The user explores cases, parties, documents, timelines, and related entities.
6. Jurvio earns return usage, account creation, alerts, or later conversion.

## Party-page strategy

Party pages are a first-class acquisition and navigation surface.

A strong party page may include:

- Canonical display name
- Entity type
- Known name variants
- Identity and disambiguation context
- Cases involving the party
- Role in each case
- Courts and jurisdictions
- Filing and outcome timeline
- Attorneys and firms of record
- Current and historical case status
- Related organizations or individuals when supported
- Sources and update timestamps
- Clear distinction between allegations, arguments, findings, and outcomes

## Party-page safeguards

Party SEO creates material accuracy, reputation, privacy, and legal risk. Jurvio must not publish or index ambiguous or misleading identity pages merely to gain traffic.

Required safeguards:

- Never merge people based only on name similarity.
- Maintain separate party mentions and canonical entities.
- Require identity confidence before consolidating cases under one person or organization.
- Provide disambiguation pages for common names.
- Display the role and procedural context of every case.
- Label allegations as allegations.
- Do not imply wrongdoing from inclusion in litigation.
- Prominently display dismissals, favorable outcomes, corrections, and current disposition.
- Preserve source provenance.
- Provide correction, identity-split, and dispute workflows.
- Noindex thin, duplicate, ambiguous, sealed, restricted, expunged, or otherwise unsafe pages.
- Establish written indexing and removal policies before scaling party pages.

## Initial value proposition

> Search a federal case, person, or company and quickly understand the litigation, the record, and how everything connects.

## Success metrics by phase

### Phase 1: Content-market fit

Because the initial product is free, first-release success will be measured through:

- Qualified organic impressions
- Indexed high-quality pages
- Search-result click-through rate
- Case and party page engagement
- Movement from party pages into case content
- Document and opinion reading
- Repeat visitors
- Account creation
- Saved cases and alerts, if offered free
- Correction rate and identity-merge error rate
- Cost per useful public page

### Phase 2: Workflow validation

- Saved searches
- Followed cases and entities
- Alert engagement
- Return frequency
- Research-session depth
- User interviews
- Recurring professional usage

### Phase 3: Monetization

- Free-to-paid conversion
- Paid retention
- Revenue per active professional user
- Cost-to-serve by tier
- Expansion into team accounts, premium alerts, exports, analytics, AI research, and API access

## Confirmed strategic choices

1. Primary first impression: “I finally understand this case.”
2. Initial professional audience: small and midsize law firms.
3. Long-term commercial goal: paying retention.
4. Launch posture: free-first adoption.
5. Core content focus: readable judgments, opinions, and sourced case explanations.
6. Primary acquisition advantage: SEO and AI-search visibility for cases, parties, people, and companies.
7. Party pages are a strategic priority, subject to strict identity and indexing safeguards.

## Open strategic questions

- Which federal courts and document classes provide the best initial readable-content corpus?
- What minimum content threshold makes a case or party page indexable?
- Which summaries can be created deterministically?
- Which documents justify AI enrichment?
- Should free accounts receive alerts at launch, and at what frequency?
- What correction and identity-dispute process is required before public indexing?
- Which usage signal should trigger on-demand enrichment?
- When should Jurvio begin monetization experiments?
