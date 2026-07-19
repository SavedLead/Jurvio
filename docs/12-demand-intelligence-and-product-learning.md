# Jurvio Gate 6 Foundation: Demand Intelligence and Product Learning

**Status:** Decision draft  
**Date:** 2026-07-19  
**Depends on:** Approved Gates 1–5

## 1. Objective

Jurvio will continuously learn what people and legitimate machines are trying to understand, where the product fails to answer them, and which jurisdictions, courts, case types, entities, topics and workflows deserve additional coverage or enrichment.

The system produces evidence-backed recommendations. It does not autonomously alter legal facts, merge identities, change publication policy, generate indexable pages, or deploy product changes.

## 2. Demand-signal families

### Human product behavior

- landing page, referral class and anonymous session journey;
- case/entity/topic/court engagement;
- search query class, filters, refinements and zero-result searches;
- document opens, passage-source clicks and timeline expansion;
- saves, watches, shares, exports and return visits;
- corrections, identity disputes and trust-related exits;
- conversion after substantive value is delivered.

### Search and referral demand

- Google and Bing query/impression/click data;
- AI-answer referrals and cited landing pages where observable;
- external links and publisher referrals;
- sitemap discovery, crawl and indexation by page type;
- branded versus party, organization, attorney, case and topic queries.

### Bot, agent and API demand

- verified crawler/platform;
- user-directed retrieval versus indexing crawler versus unknown automation;
- route/entity type, status, latency and bytes transferred;
- API endpoint, entity class, filter family and response outcome;
- authenticated customer/account tier where applicable;
- rate-limit, cache and abuse signals.

Do not combine verified AI crawlers, ordinary search crawlers, customer API calls and unidentified scraping into one “bot traffic” number.

### External voice of customer

Monitor legally and operationally approved public sources such as:

- Reddit and professional forums;
- legal-technology communities and newsletters;
- public social discussions;
- competitor reviews, support forums, release notes and public roadmaps;
- attorney and law-firm commentary;
- journalist/investigator discussions;
- public search trends and frequently asked questions;
- Jurvio feedback, support, correction and feature requests.

Use APIs, RSS, licensed feeds, public search and permitted collection methods. Preserve source URL/date and comply with platform terms, copyright and privacy requirements.

## 3. Event architecture

Every analytics event uses a versioned contract with:

- event ID, name and schema version;
- occurred/received timestamps;
- actor class: human, verified crawler, user-directed agent, authenticated API, unknown automation or internal system;
- anonymous/session/account identifier as policy permits;
- canonical Jurvio entity IDs rather than copied display names;
- page/template, jurisdiction, court, state, case type, topic and document class dimensions;
- referral/search/AI platform dimensions;
- outcome, latency and error state;
- consent, retention and data-classification fields.

Raw events are append-only. Identity, legal-document text, search queries and URLs may contain sensitive data, so collection must minimize payloads and apply access/retention controls.

## 4. Measurement model

### Demand

- unique interested humans;
- qualified professional/research sessions;
- external search impressions and clicks;
- AI citations/referrals;
- internal searches and zero-result demand;
- verified API/agent requests;
- saves/watches and repeat use.

### Supply

- covered cases/documents by jurisdiction and type;
- readable-text and summary availability;
- freshness and source completeness;
- qualifying entity/profile coverage;
- search-result availability and source-link quality.

### Opportunity

Jurvio computes an explainable opportunity score from:

- demonstrated demand;
- supply/coverage gap;
- source availability and rights;
- enrichment cost;
- page/search quality potential;
- strategic audience fit;
- legal/privacy risk;
- expected traffic, retention or revenue impact;
- confidence and sample size.

The score ranks investigation candidates; it does not authorize work automatically.

## 5. Required analytical views

- demand by federal court, circuit, future state, jurisdiction and region;
- nature of suit, cause of action, case type, topic and procedural stage;
- party/person/organization, attorney, firm and judge interest;
- document and decision type;
- source/referrer, search engine, AI platform, verified bot and API client;
- new versus returning and public versus professional behavior;
- content supply versus demand gap;
- zero-result and low-result search clusters;
- high-traffic pages missing summaries, passages or updates;
- page quality, indexation, engagement, correction and dispute rates;
- cost per useful page, returning user, alert subscriber and API result.

## 6. Jurvio recommendation engine

### Deterministic layer

Rules detect:

- rapidly growing query/topic demand;
- traffic concentrated in pages with weak coverage;
- repeated zero-result searches;
- emerging jurisdictions or case types;
- bot/API interest that materially differs from human demand;
- high correction/dispute rates;
- crawling/indexation anomalies;
- content with strong engagement but poor internal linking;
- expensive enrichment with little downstream value.

### AI-assisted layer

AI may:

- cluster semantically similar search and feature requests;
- summarize external conversations with source links;
- label pain points, audiences and requested workflows;
- compare Jurvio demand with competitor conversations;
- draft hypotheses and recommended experiments;
- identify recurring unmet needs and emerging legal topics.

AI recommendations must include evidence, time window, sample size, confidence, estimated impact/cost, affected audience and contrary signals. Unsupported strategic prose is not actionable intelligence.

## 7. Decision cadence

- **Daily:** operational anomalies, crawl failures, zero-result spikes and urgent emerging topics.
- **Weekly:** top demand/supply gaps and enrichment opportunities.
- **Monthly:** product, SEO, AI-discovery, corpus and cost recommendations.
- **Quarterly:** jurisdiction expansion, crawler registry, competitor landscape and roadmap reassessment.

Each recommendation receives an owner and state: new, investigating, approved experiment, rejected, implemented, measuring or archived. Outcomes feed back into future recommendation quality.

## 8. Guardrails against bad learning

- Do not optimize solely for pageviews or sensational cases.
- Do not let scraper volume masquerade as user demand.
- Do not amplify thin pages because they briefly rank.
- Normalize for coverage, seasonality, campaigns and crawler changes.
- Require minimum sample sizes and show uncertainty.
- Separate correlation from causation.
- Preserve a holdout or before/after baseline for material experiments.
- Do not personalize public legal facts.
- Do not infer protected or sensitive traits.
- Do not use private workspaces or customer research to improve public pages without a clear policy basis.
- Never let paid placement change legal facts or organic relevance.

## 9. Privacy and governance

- Prefer first-party, privacy-conscious analytics and short-lived pseudonymous identifiers.
- Define consent, retention, deletion and access policies before implementation.
- Restrict raw queries and URLs because they can contain names and sensitive details.
- Aggregate reporting where individual behavior is unnecessary.
- Separate product analytics from security/audit logs.
- Maintain a data dictionary and event ownership.
- Version dashboards and metric definitions so historical comparisons remain valid.

## 10. Small-team implementation sequence

1. Define the event taxonomy and canonical dimensions.
2. Capture server-side page/search/source-click events and verified crawler/API logs.
3. Integrate Google Search Console, Bing Webmaster Tools and referral analytics.
4. Build demand-versus-supply and zero-result dashboards.
5. Add a recommendation ledger and weekly deterministic report.
6. Add sourced AI clustering/summarization after enough data exists.
7. Add approved external voice-of-customer feeds.
8. Add experiment tracking and recommendation outcome learning.

Do not begin with a heavy customer-data platform or autonomous agent. Start with trustworthy events, SQL metrics and a reviewable recommendation queue.

## 11. Acceptance criteria

1. Human, crawler, user-agent and API activity are distinguishable.
2. Demand can be analyzed by court, jurisdiction/state, case type, topic and entity class.
3. Every recommendation links to supporting metrics or external sources.
4. Zero-result and coverage-gap reports produce actionable ranked opportunities.
5. Sensitive query/event data has explicit retention and access controls.
6. Product changes require approval and measurable experiments.
7. Recommendation outcomes are recorded and used to improve later prioritization.
8. External monitoring complies with source terms and preserves attribution.

## 12. Decisions requested

1. Approve Demand Intelligence as a core platform capability rather than a later dashboard.
2. Approve separate measurement of humans, verified search/AI crawlers, user-directed agents, APIs and unknown automation.
3. Approve a demand-versus-supply opportunity model across jurisdictions, case types, topics and entities.
4. Approve ongoing, source-attributed external voice-of-customer monitoring.
5. Approve AI-assisted recommendations with evidence, but no autonomous legal/product publication decisions.
6. Approve first-party events and SQL reporting before purchasing a heavy analytics platform.
