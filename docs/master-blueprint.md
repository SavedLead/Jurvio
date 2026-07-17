# Jurvio — Public Legal Intelligence Platform Master Blueprint

Status: Planning approved; implementation architecture pending approval  
Owner: David Rosenberg  
Last updated: July 17, 2026

Working brand: Jurvio  
Domain: Jurvio.com  
Recommended repository: `SavedLead/jurvio`

## Product thesis

Build the open web's most understandable litigation database: readable court records, connected case intelligence, professional analysis, and precise monitoring.

The product is not another PACER viewer. Its core job is to help a user answer, quickly and confidently:

- What is this case about?
- Who is involved?
- What happened?
- What is the current status?
- What changed recently?
- Why does it matter?
- What other cases, people, firms, statutes, and commentary connect to it?

## Confirmed strategic decisions

1. The platform will be a standalone company and brand.
2. Initial audiences include law firms, legal professionals, investigators, journalists, and business-intelligence users.
3. Core case and entity information will generally be public for discovery, SEO, and AI retrieval.
4. Paid value will center on monitoring, advanced discovery, organization, analytics, exports, and AI-assisted research.
5. Readable HTML legal content is a foundational capability.
6. Third-party case coverage will be explored as a quality-controlled content layer.
7. Litigation news discovery and category-based alerts are part of the product vision.
8. Federal courts are the initial jurisdictional scope; states follow through provider adapters.
9. Court records are authoritative. AI output must be labeled, sourced, versioned, and reproducible.
10. No production application code begins until the architecture blueprint is reviewed and approved.

## Recommended first product boundary

### Public discovery layer

- Federal case search
- Case pages
- Party, attorney, law firm, judge, court, and opinion pages
- Docket metadata and available documents
- Readable HTML opinions and supported filings
- Deterministic case timeline
- Plain-English case overview with citations
- Coverage and analysis from credible external publishers
- Internal linking, breadcrumbs, canonical URLs, structured data, and controlled indexing

### Paid intelligence layer

- Saved cases and searches
- Case, entity, keyword, topic, and industry monitoring
- Personalized email digests
- Importance-ranked filing alerts
- Advanced and Boolean search
- Exports
- Team workspaces
- AI-assisted research grounded in source records
- Premium SMS alerts
- API and webhooks in later tiers

## Product principles

- Source before summary.
- Allegation is not fact.
- Understanding before document volume.
- Deterministic processing before AI.
- Public utility creates distribution; workflow utility creates revenue.
- Index only pages that meet quality and uniqueness thresholds.
- Preserve raw source records and provenance for every normalized field.
- Begin with a modular monolith and independently scalable workers.
- Add specialized infrastructure only when measured workloads require it.

## Architecture approval gates

1. Strategy: executive summary, competitive landscape, personas, positioning, business model.
2. Product: PRD, feature matrix, information architecture, navigation, acceptance criteria.
3. Data: sources, ingestion, normalization, provenance, canonical schema, ERD.
4. Discovery: search, indexing, SEO, AI discoverability, URL strategy.
5. Intelligence: AI enrichment, RAG, related cases, knowledge graph evolution.
6. Platform: API, authentication, subscriptions, infrastructure, security, monitoring.
7. Execution: design system, wireframes, roadmap, milestones, testing, costs, scaling, risks.

## Initial technical direction (not yet approved)

- Application: Next.js, React, TypeScript.
- Canonical data: PostgreSQL.
- Search: OpenSearch, introduced when the ingestion/search benchmark justifies it.
- Storage: S3-compatible object storage.
- Ingestion: provider adapters, durable jobs, idempotent workers, raw immutable source snapshots.
- Delivery: CDN and edge protection through Cloudflare.
- Architecture: modular monolith plus independently scalable ingestion/enrichment workers.
- AI: selective enrichment with provenance, confidence, prompt/model versioning, and caching.

## Immediate planning sequence

1. Complete evidence-backed competitor and user-pain research.
2. Define MVP jobs-to-be-done and personas.
3. Produce the PRD and feature prioritization.
4. Design the canonical data model and ingestion contracts.
5. Design search, public-page, and indexing architecture.
6. Produce case-page and search-result wireframes.
7. Estimate build phases, staffing, infrastructure, and AI costs.
8. Present the architecture approval package.

## Decision log

| Decision | Status | Rationale |
|---|---|---|
| Federal-first launch | Confirmed | Achievable scope with a scalable path to states |
| Core pages publicly accessible | Confirmed | Distribution, SEO, AI retrieval, public utility |
| Subscription for workflow intelligence | Confirmed | Recurring value comes from monitoring and productivity |
| Readable HTML records | Confirmed | Major usability and discoverability differentiator |
| Standalone company | Confirmed | Independent credibility, brand, policy, and enterprise value |
| Modular monolith | Proposed | Best balance for a small team and future scale |
| PostgreSQL canonical store | Proposed | Strong relational integrity and operational simplicity |
| OpenSearch | Proposed | Strong full-text, filters, facets, and Boolean search at scale |
