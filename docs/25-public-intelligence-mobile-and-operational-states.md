# Jurvio Gate 8G: Public Intelligence, Mobile and Operational States

**Status:** Design review draft  
**Date:** 2026-07-19  
**Depends on:** Gate 8F core page family

## Completed concepts

- public-company litigation profile;
- government-enforcement matter;
- Cases in the News;
- Supreme Court hub;
- readable HTML document viewer;
- mobile case overview and legal-term sheet;
- mobile search and document intelligence;
- authentication, follows, alerts and pricing;
- uncertain, corrected, sealed, suppressed and non-indexable states.

## Public companies

Profiles connect stable entity identity, ticker/CIK, subsidiaries, litigation, enforcement and SEC disclosures. Every matter shows current status and allegations versus findings. Jurvio does not infer financial materiality, predict price impact or provide investment advice.

## Enforcement

Matter pages separate agency allegations, subject response, relief sought, legal stage, deterministic next step, issuer, adjudicative forum, lifecycle, statutes, documents and official sources. “Complaint filed · No findings issued” remains prominent until supported findings exist.

## Cases in the News

Ranking uses objective public-attention, filing-activity, calendar, follow and coverage signals. Political viewpoint is excluded. Each item shows status, latest meaningful event, why it is trending, sources and next scheduled event. Methodology is public.

## Supreme Court

The hub organizes terms, calendars, stages, questions presented, lower-court paths, arguments, opinions, votes and issue areas. Appointing presidents are factual fields. Path-to-SCOTUS assessment is labeled analysis, not prediction; ideology scores are prohibited.

## HTML document viewer

Exact court text remains the primary source and is never replaced by a guide. The viewer includes outline, paragraph/page anchors, search, OCR confidence/version, source PDF, citations, legal terms, passage-supported summary statements and deterministic case effect. Users can report OCR errors.

## Mobile rules

Current status remains in the first viewport. Desktop sidebars become ordered content or accessible bottom sheets. Section navigation, filters, document intelligence and legal definitions use 44px targets and preserve source access. No desktop layout is merely squeezed into mobile.

## Accounts and conversion

Public reading and keyword search remain free. Follow/save/alerts require a free account after the user chooses the action. One complete anonymous Ask Jurvio answer is preserved before login is requested for continued use. Pricing remains transparent: Free, Plus $29, Professional $99, Team $299, subject to validation.

## Operational/legal states

Jurvio explicitly supports:

- Status not verified: conflicting sources are shown without a guess.
- Status needs review: ambiguous events enter legal-operations review.
- Corrected record: public revision history and provenance.
- Sealed/restricted: content removed with controlling source and permitted metadata.
- Name suppressed: neutral pseudonym and stable opaque case ID; no identity leakage.
- Insufficient unique content: page excluded from indexing/sitemaps.
- Internal cross-surface checks: cache, search, AI, API and sitemap propagation.

Administrative evidence, reviewer identity and audit data are never exposed publicly unless policy requires.

## Implementation gate

These mockups are behavioral specifications, not production code. Before implementation, consolidate the final PRD, data model, API contracts, ingestion schemas, deterministic status state machine, search mappings, privacy directive model, acceptance tests, phased roadmap and cost envelope for one final architecture approval.
