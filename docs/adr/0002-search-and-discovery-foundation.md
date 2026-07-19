# ADR 0002: Search and Discovery Foundation

**Status:** Proposed  
**Date:** 2026-07-19

## Context

Jurvio requires legal-identifier lookup, entity disambiguation, full-text search, millions of indexable candidates and controlled external discovery. PostgreSQL alone is not the long-term relevance engine, while uncontrolled page generation would create search-quality and legal risk.

## Decision

- Deploy managed OpenSearch as a rebuildable public-search projection before beta.
- Keep PostgreSQL canonical and retain exact-identifier fallback only.
- Launch deterministic query routing and lexical ranking before semantic ranking.
- Require a relevance judgment set before hybrid search.
- Control external indexation through registered templates and deterministic quality gates.
- Use canonical server-rendered HTML, synchronized structured data and versioned JSON endpoints.
- Use a vendor-neutral AI discovery representation and a maintained crawler registry.
- Permit verified search/retrieval crawlers on eligible public pages across Google/Gemini, Bing/Copilot, OpenAI/ChatGPT, Anthropic/Claude, Perplexity and future systems.
- Decide model-training access separately and consistently across providers.

## Consequences

Benefits include strong legal search behavior, scalable full text/facets, zero-downtime index rebuilds, measurable relevance, controlled crawl quality and reduced dependency on any one AI vendor. Costs include operating a managed search cluster, projection consistency work, ongoing relevance evaluation and quarterly crawler-policy maintenance.

## Alternatives

- PostgreSQL-only search: simpler but insufficient for the intended full-text/facet/relevance product at launch scale.
- Elasticsearch: technically viable; OpenSearch is preferred for licensing flexibility and managed-service options. Re-evaluate through a vendor/cost benchmark before procurement.
- Hosted search SaaS: faster initially but potentially costly and restrictive for legal passage search and advanced Boolean requirements.
- Vector-first search: deferred because exact identifiers and legal terminology demand a strong lexical baseline.

## Reconsideration triggers

- Benchmark shows a hosted service materially lowers total cost without limiting required search behavior.
- OpenSearch operational cost materially exceeds usage and PostgreSQL meets the measured beta workload.
- Relevance evaluations demonstrate hybrid retrieval consistently improves legal results within cost/latency budgets.

## Approval

This ADR becomes Accepted when Gate 5 is explicitly approved.
