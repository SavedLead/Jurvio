# Jurvio Final Architecture Package D: Delivery Plan, Testing and Cost Envelope

**Status:** Final approval draft  
**Date:** 2026-07-19

## 1. Delivery approach

Small senior team, modular monolith, infrastructure as code, measured expansion.

Suggested initial team:

- 1 technical lead/full-stack architect;
- 1 backend/data engineer;
- 1 frontend/product engineer;
- fractional product/design;
- fractional legal/privacy counsel;
- part-time legal data QA/operations.

Do not hire a large ingestion or editorial operation before source quality and demand are proven.

## 2. Milestones

### M0: foundation, 2–3 weeks

- repository standards and ADRs;
- environments and CI/CD;
- infrastructure modules;
- database migrations;
- auth/admin skeleton;
- observability/cost dashboards;
- security baseline.

Exit: repeatable deploy, rollback, secrets, backups and audit foundation.

### M1: source-to-case vertical slice, 4–6 weeks

- one CourtListener/RECAP adapter;
- raw artifacts/provenance;
- court/case/docket/party normalization;
- opaque IDs;
- case overview/docket/party pages;
- deterministic status v1;
- internal review console.

Exit: selected cases replay deterministically from raw source to public preview.

### M2: document intelligence, 4–6 weeks

- document retrieval/rights controls;
- extraction/OCR;
- document/opinion/order/judgment model;
- HTML reader;
- citations and support links;
- quality-gated summaries;
- document pages.

Exit: qualified documents are readable, sourced and correctly affect status.

### M3: search and entity graph, 4–6 weeks

- OpenSearch projections;
- universal keyword search;
- company/person/attorney/judge/firm/court/NOS pages;
- entity confidence and merge/split;
- sitemap/indexability gates;
- SEO/AI metadata.

Exit: meaningful end-to-end search and controlled crawl pilot.

### M4: accounts and monitoring, 3–5 weeks

- accounts/teams;
- follows/saved searches;
- daily/immediate alert pipeline;
- notification preferences;
- free limits;
- payment/entitlements;
- analytics Demand Intelligence Loop.

Exit: reliable follow-to-notification workflow and measurable conversion.

### M5: public beta hardening, 4–6 weeks

- privacy/correction intake;
- sealing and propagation;
- security review;
- accessibility/performance;
- load/recovery tests;
- legal policy approval;
- monitored public launch and gradual sitemap ramp.

Expected focused beta: roughly 5–7 months with the small team, depending on source/document complexity. Do not compress by weakening provenance, status or privacy.

## 3. Test strategy

### Unit/property tests

- normalizers and parsers;
- public ID generation/collision handling;
- state transitions and templates;
- identity match features;
- publication/indexability rules;
- privacy scope evaluation;
- entitlement and rate-limit logic.

### Contract tests

- provider fixtures;
- API schemas;
- OpenSearch mappings;
- outbox consumers;
- payment/notification webhooks;
- object-storage metadata.

### Golden legal corpus

Maintain expert-reviewed examples covering:

- dismissal with/without prejudice;
- voluntary/involuntary dismissal;
- partial disposition;
- mixed summary judgment;
- default judgment;
- settlement without admission;
- administrative complaint versus finding;
- stay/reopening;
- appeal filed/decided/remanded;
- amended/vacated judgment;
- sealed/corrected documents;
- party substitution and attorney withdrawal.

Every rule/prompt/model change runs against the corpus.

### End-to-end

Raw artifact → normalization → identity → status → publication → page/API → search → alert → correction/privacy propagation.

### Nonfunctional

- WCAG 2.2 AA;
- Core Web Vitals on representative pages;
- search latency/load;
- ingestion replay and recovery;
- backup restoration;
- rate limiting/abuse;
- tenant isolation/RBAC;
- dependency/container scanning;
- penetration test before paid/API launch;
- privacy leak scans across HTML, metadata, search, API, cache and embeddings.

## 4. Launch acceptance

- 99% of sampled qualified case pages render without material metadata errors;
- 100% of displayed status claims have triggering evidence and rule version;
- no LLM determines status;
- 100% of sampled allegation/finding labels pass review;
- privacy/sealing directive propagates to all public surfaces within defined emergency SLA;
- search exact docket lookup target accuracy at 100% in acceptance corpus;
- high-confidence identity precision prioritized over recall;
- summaries meet citation-coverage threshold and legal QA sample;
- no thin pages enter sitemaps;
- public pages work without login;
- mobile and keyboard primary flows pass;
- restore and full search rebuild are demonstrated.

Exact numeric SLA/quality thresholds should be tightened using beta baselines rather than invented prematurely.

## 5. Initial infrastructure cost envelope

Approved DigitalOcean + Cloudflare architecture.

### Pre-revenue target

Hard infrastructure target: approximately $250/month.

Likely components:

- small app/worker compute;
- managed PostgreSQL entry tier;
- Cloudflare CDN/security;
- R2/object storage;
- email/monitoring at low volume;
- backups/log retention within defined limits.

OpenSearch may begin as a small managed deployment only when corpus/search demand requires it; before that, PostgreSQL search can support the narrow alpha if benchmarks pass.

### AI/OCR

Combined launch cap: $500/month unless revenue or explicit approval raises it.

Controls:

- deterministic extraction first;
- summaries only for qualified/high-demand documents;
- content-hash caching;
- no per-page-view generation;
- bounded model/context;
- batch/offline processing;
- token and cost ledger;
- automatic budget breaker;
- manual approval for large backfills.

### Data acquisition

CourtListener/RECAP-first. Paid PACER acquisition is demand-driven and separately budgeted. Bot traffic cannot trigger paid retrieval.

### Other non-hosting costs

Expected categories:

- legal/privacy review;
- email delivery;
- identity verification per request;
- payment processing;
- observability/error tracking;
- OCR/AI;
- security scanning/testing;
- analytics;
- court-document acquisition;
- contractor/legal-data QA;
- insurance and corporate/compliance.

## 6. Scaling triggers

Scale components only from measured thresholds:

- add worker replicas for queue lag;
- increase PostgreSQL before sharding;
- add/read replicas for sustained read pressure;
- adopt managed OpenSearch when PostgreSQL search misses latency/relevance targets;
- partition high-volume event/audit tables;
- split a service only when independent scaling/deployment or team ownership justifies it;
- move PostgreSQL jobs to a dedicated broker only when throughput/operational evidence requires it;
- multi-region only after revenue/SLA demand.

## 7. Risk register

Highest risks:

1. incomplete/stale source coverage;
2. incorrect status/procedural explanation;
3. identity false merges;
4. allegation presented as fact;
5. privacy/sealing propagation failure;
6. thin programmatic SEO;
7. AI cost or hallucination;
8. paid document acquisition driven by bots;
9. provider terms/rights change;
10. premature infrastructure/team scale.

Each has a named owner, measurable control, incident path and review cadence before public beta.

## 8. Final approval decision

Approve Packages A–D as the implementation architecture, subject to:

- no production coding before this final gate is approved;
- counsel review before public publication;
- phased scope and cost caps;
- architecture amendments for material changes;
- implementation PRs mapped to milestone acceptance criteria.
