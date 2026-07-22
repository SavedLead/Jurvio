# Professional Research Wedge and Commercial Scale

Status: **Approved and locked**  
Decision date: 2026-07-21

## Commercial objective

Jurvio will be designed to support more than 10,000 paying customers while operating economically before revenue. This means commercial data boundaries and scale paths exist from the beginning; it does not mean purchasing peak infrastructure before demand exists.

At 10,000 customers, reliability, permissions, billing accuracy, research trust, and customer support are product requirements. The system must not depend on manual account changes, per-customer deployments, or AI work that is recomputed for every user.

## CaseText-style professional wedge

The first paid-product wedge is source-grounded similar-authority research:

1. A user describes a legal issue, facts, jurisdiction, and procedural posture, or uploads a brief, pleading, or opinion.
2. Jurvio extracts search concepts and explicit citations without changing the source document.
3. Hybrid retrieval combines exact citations, Boolean/keyword search, jurisdiction and date filters, procedural posture, citation graph, and semantic similarity.
4. Results return opinions and dispositive rulings with the matching passages, source links, court, date, precedential status where known, and an explanation of why each result matched.
5. Citation treatment and current validity are displayed only when supported by deterministic citation data and reviewable sources.
6. A generated answer may summarize the retrieved authorities, but it never invents a citation or substitutes for the opinion.

The initial release is query-to-opinion research. Document upload follows after secure retention, deletion, confidentiality, malware scanning, and privilege protections are ready.

## Adoption and paid boundaries

Public adoption remains the top of the funnel:

- readable primary law and case pages;
- basic keyword and citation search;
- current status, timelines, linked entities, and deterministic explanations;
- ordinary related-case recommendations;
- limited on-demand plain-English summaries.

Potential paid value includes:

- natural-language and advanced Boolean research;
- describe-a-case and find-similar-authority research;
- private document upload and analysis;
- deeper citator and treatment workflows;
- saved searches, monitoring, alerts, folders, and research history;
- exports, team workspaces, collaboration, and API access;
- higher AI, search, alert, and document-processing limits.

Feature boundaries will be tested against actual usage. Jurvio will not damage SEO discovery or force payment merely to read public primary law.

## Commercial architecture required before billing

- stable user, organization, membership, role, and invitation records;
- customer, subscription, price, entitlement, usage, credit, invoice-reference, and webhook-event records;
- idempotent billing webhooks and an immutable entitlement decision trail;
- per-feature usage metering and budget caps;
- organization-level data isolation and authorization checks;
- individual, professional, team, enterprise, and API-ready entitlement shapes without hard-coded plan logic;
- audit logging for administrative and support actions;
- account export, deletion, retention, and legal-hold controls;
- rate limits and abuse controls by IP, account, organization, API key, and workload;
- cached and reusable enrichment so the same public case is not summarized separately for every customer;
- service health, job latency, search quality, cost per workflow, activation, conversion, retention, and churn analytics.

Payment-card data will be handled by a compliant payment provider and never stored by Jurvio.

## Scale path

1. **Pre-revenue:** one small application/database host, PostgreSQL search, asynchronous jobs, Cloudflare, and strict cost caps.
2. **Early revenue:** isolate workers and object storage when ingestion competes with serving; move PostgreSQL to managed or dedicated infrastructure when availability requires it.
3. **Product-market fit:** add search replicas or OpenSearch only after measured PostgreSQL relevance or latency limits; separate high-cost workloads; introduce organization support and operational SLAs.
4. **10,000+ paying customers:** multi-instance stateless web tier, dedicated workers and queues, highly available database with read scaling, resilient search cluster, tested disaster recovery, automated support operations, and enterprise security controls justified by revenue.

Scaling decisions are triggered by latency, queue depth, storage, availability, support burden, and revenue thresholds rather than forecasts alone.

## Success measures

- visitor-to-free-account conversion;
- free-to-paid conversion;
- first successful authority search;
- percentage of searches producing a useful clicked result;
- saved/exported/cited authorities per active professional;
- weekly and monthly professional retention;
- alert and monitoring retention lift;
- AI and search cost per active and paying customer;
- gross margin by feature and plan;
- support contacts and time-to-resolution;
- citation-quality and false-match review rates.

## Explicit exclusions

- No unsourced generated citations.
- No claim that semantic similarity means legal relevance or favorable authority.
- No automated conclusion that an opinion remains good law without citation support.
- No public use of uploaded confidential documents.
- No congressional scorecards or generalized three-branch product during the CaseText-focused launch phase.
