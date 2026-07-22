# Jurvio Final Architecture Package A: Product Requirements and Launch Scope

**Status:** Final approval draft  
**Date:** 2026-07-19  
**Purpose:** Consolidate approved Gates 1–8G into an implementation boundary.

## 1. Product promise

Jurvio makes public litigation searchable, understandable and connected. It combines readable court records, deterministic procedural status, sourced plain-language explanations, document intelligence and entity relationships.

Launch is not a complete legal-research replacement. It is the strongest free public experience for understanding selected federal litigation, with paid monitoring and professional workflow.

## 2. Launch users

Priority:

1. legal professionals monitoring or researching federal litigation;
2. investigative journalists and business researchers;
3. people researching companies, parties, attorneys, judges and cases;
4. public users trying to understand legal procedures.

## 3. Launch scope

### Public discovery

- universal keyword search;
- cases, parties/companies, attorneys, judges, firms, courts, documents, nature of suit and enforcement;
- crawlable entity and case pages;
- qualified document, opinion, order and judgment pages;
- readable HTML where source rights and extraction quality permit;
- current status and last verified/source;
- legal-term, procedure, court and citation explanations;
- Cases in the News, public-company litigation, enforcement and SCOTUS as phased editorial/automated collections.

### Understanding

- case summary;
- What happened / What it means / What happens next;
- deterministic current status explanation;
- procedural timeline;
- allegation, argument, finding, order and judgment labels;
- filing/document summaries with passage support;
- judgment claim-by-claim disposition;
- citation context;
- source and correction history.

### Free accounts

- follows;
- limited alerts;
- saved searches;
- reading history/preferences where consented;
- continued Ask Jurvio after one complete anonymous answer, within free limits;
- correction and profile-claim workflows.

### Paid

Initial tests:

- Plus: $29/month;
- Professional: $99/month;
- Team: $299/month.

Paid value includes higher-frequency monitoring, advanced filters/search, higher AI limits, reports/exports, larger watchlists, team workflow, webhooks and later API access. Public reading and basic keyword search remain free.

## 4. Explicit non-goals for launch

- all state courts;
- international coverage;
- outcome prediction;
- judge ideology/rankings;
- attorney win rates or consumer ratings;
- legal advice;
- investment advice/materiality prediction;
- automated removal approval;
- indexing every docket entry;
- unrestricted AI generation across the corpus;
- microservices.

## 5. Core quality requirements

- primary legal claims trace to sources;
- current status is deterministic;
- uncertain data is labeled, not guessed;
- case status appears above the fold on every case route;
- public records distinguish allegations from findings;
- entity resolution carries confidence and provenance;
- AI content is cached, versioned and subordinate to sources;
- privacy directives propagate to every public surface;
- indexability requires substantial unique value;
- pages are server-rendered, accessible and machine-readable.

## 6. Launch coverage strategy

Do not promise every federal case immediately.

Phase 1 corpus:

- federal civil cases with useful metadata and public RECAP documents;
- opinions, orders and judgments with strong extraction quality;
- selected high-interest/public-company/enforcement cases;
- courts, judges, nature-of-suit taxonomy and professionals linked to covered matters.

Coverage labels disclose court, date range, source availability and last retrieval. Demand may prioritize acquisition but never overrides publication or privacy rules.

## 7. Success metrics

North-star: weekly users who reach a sourced understanding action.

Supporting metrics:

- qualified organic landings;
- search success and zero-result rate;
- case status/summary engagement;
- document/source opens;
- follows, alerts and return visits;
- free-account conversion;
- paid conversion and retention;
- cost per active followed matter;
- indexed-page quality/traffic ratio;
- correction rate and time to resolution;
- AI answer citation coverage and error rate;
- human versus verified crawler/API demand by entity/topic/court.

Bot traffic is not treated as user adoption.

## 8. Release gates

### Alpha

- one court/source slice;
- ingestion and provenance;
- case/docket/party/document pages;
- deterministic status;
- keyword search;
- internal admin review;
- no public AI answer product.

### Private beta

- multiple federal courts;
- accounts/follows;
- daily alerts;
- HTML reader;
- document summaries for qualified records;
- privacy/correction operations;
- monitored SEO pilot.

### Public beta

- controlled sitemap expansion;
- public search and qualified pages;
- one anonymous Ask Jurvio answer;
- selected News/enforcement/company collections;
- paid Plus test only after monitoring value is reliable.

### General availability

- broader coverage;
- Professional/Team;
- reports/exports;
- webhooks/API;
- formal SLAs only when operations support them.

## 9. Acceptance for implementation authorization

Implementation may begin only after approval of Packages A–D together. Production scope must match the phased boundaries, cost caps and safeguards; changes that expand publication risk, AI spend or jurisdiction require a new architecture decision.
