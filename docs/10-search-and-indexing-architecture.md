# Jurvio Gate 5A: Search and Indexing Architecture

**Status:** Decision draft  
**Date:** 2026-07-19  
**Depends on:** Approved Gates 1–4

## 1. Product decision

Search is a primary Jurvio product, not a database filter. It must resolve exact legal identifiers, find people and organizations despite name variation, search readable legal text, expose filters without hiding ambiguity, and later support semantic discovery.

Use PostgreSQL for canonical records and transactional lookups. Use a managed OpenSearch deployment for public full-text search, facets, autocomplete and relevance ranking before public beta. The OpenSearch cluster is a rebuildable projection, never the authoritative store.

## 2. Search experiences

### Universal search

One entry point recognizes:

- docket and case numbers;
- official citations;
- case captions;
- party, attorney, judge and firm names;
- organizations and aliases;
- courts;
- statutes and regulations;
- keywords and quoted phrases.

Results are grouped or explicitly typed. Jurvio must not silently mix a party occurrence, verified person, attorney and same-name organization as though they are interchangeable.

### Document search

Search across decisions and other eligible readable documents with:

- passage snippets;
- court, date, document type and topic filters;
- exact phrase and field targeting;
- links to stable source passages;
- visible evidence/document class.

### Entity and browse search

Entity directories support prefix/name lookup, aliases, jurisdictions and verified relationship filters. Browse pages use the same search projection but a separate approved landing-page registry.

## 3. Query-understanding pipeline

1. Normalize Unicode, spacing and punctuation while retaining the original query.
2. Detect high-confidence docket numbers, citations and known court abbreviations deterministically.
3. Detect quoted phrases and supported field syntax.
4. Generate conservative name and corporate-suffix variants.
5. Search exact identifiers first.
6. Search typed lexical fields and aliases.
7. Blend entity families with explicit result-type priors.
8. Use behavioral or semantic signals only after offline evaluation.

AI is not required to interpret ordinary queries. A small model may later rewrite complex natural-language questions into a transparent structured query, but users must be able to inspect and remove the interpretation.

## 4. Index families

Use versioned physical indexes behind stable aliases:

| Alias | Unit | Purpose |
|---|---|---|
| `jurvio_cases_read` | Case | Caption, docket, status, court, parties, topics and key outcome |
| `jurvio_documents_read` | Document/passages | Full text, headings, citations and passage snippets |
| `jurvio_entities_read` | Entity/profile | Organizations, verified professionals, names, aliases and relationships |
| `jurvio_occurrences_read` | Case-scoped occurrence | Same-name-safe party and professional occurrences |
| `jurvio_authorities_read` | Authority | Cases, statutes, rules and citations |
| `jurvio_suggest_read` | Suggestion | Approved autocomplete terms and popular identifiers |

Do not use one giant index. Do not create an index per court, year or customer. Physical indexes may be split later only when measured shard size, update rate or retention needs justify it.

OpenSearch aliases permit zero-downtime switches between index generations, which supports safe full rebuilds and relevance experiments ([OpenSearch index aliases](https://docs.opensearch.org/latest/im-plugin/index-alias/)).

## 5. Search document design

Each projection contains:

- canonical Jurvio ID and URL;
- projection and canonical-record versions;
- entity/result type;
- exact and normalized identifiers;
- primary display name/caption plus aliases;
- searchable text fields with field-level boosts;
- filters as normalized keyword/date/boolean fields;
- quality, verification, publication and coverage state;
- source authority/freshness signals;
- public-safe snippet fields;
- relationship summaries needed for filtering;
- optional embedding reference/version, not raw authority.

Sensitive, held, disputed or `noindex` content must be excluded or appropriately restricted in the public search projection.

## 6. Lexical relevance v1

Ranking order by query class:

1. exact docket/citation/official identifier;
2. exact normalized primary name or caption;
3. verified alias/exact phrase;
4. strong fielded lexical match;
5. prefix/fuzzy match within conservative edit-distance limits;
6. body-text relevance;
7. semantic similarity, only after later approval.

Tie-breakers may include source authority, page quality, verification, substantive-content depth, recency where query intent warrants it, and measured engagement. Popularity must not override an exact legal identifier or turn allegations into ranking sensationalism.

## 7. Name search and disambiguation

- Preserve initials, punctuation, suffixes and exact source-rendered names.
- Treat nicknames, former names and transliterations as typed sourced aliases.
- Return distinct occurrences when canonical identity is unresolved.
- Show court, role, case, date and firm/location context on result cards.
- Never use a guessed social profile or address to publicly resolve identity.
- Verified canonical profiles may rank above occurrences for exact-name navigational queries, but occurrences remain accessible.

## 8. Filters and sorting

Initial filters:

- entity/document type;
- federal court and circuit;
- filing/decision date;
- case status;
- nature of suit and controlled topic;
- party role;
- judge, attorney and firm where verified;
- available full text and summary state.

Initial sorts:

- relevance;
- newest/oldest decision or filing date;
- recently updated.

Do not launch attorney ratings, win-rate sorts, judge predictions or opaque “risk” sorting.

## 9. Pagination and exports

- Use cursor-based pagination.
- For stable deep result traversal, use OpenSearch point-in-time plus `search_after`, not large `from` offsets ([OpenSearch point in time](https://docs.opensearch.org/latest/search-plugins/searching-data/point-in-time/)).
- Public result depth is capped to control scraping and cost.
- Large exports become asynchronous, authenticated jobs in a future paid tier.

## 10. Indexing pipeline

```text
PostgreSQL canonical transaction
  → transactional outbox
  → projection builder
  → policy/redaction check
  → bulk index/update/delete
  → alias-backed OpenSearch index
  → cache/autocomplete invalidation
  → reconciliation and lag metrics
```

Requirements:

- idempotency key: entity ID + canonical version + projection version;
- tombstones for unpublish, merge and deletion events;
- full rebuild from PostgreSQL/object storage;
- nightly reconciliation of counts and sampled hashes;
- dead-letter handling and replay;
- versioned mappings/analyzers;
- alias swap only after completeness and quality checks.

## 11. Semantic and hybrid search

Defer semantic ranking from default v1 until Jurvio has:

- a representative legal query set;
- human relevance judgments;
- lexical baseline metrics;
- document-level embeddings with source/version lineage;
- latency and cost benchmarks;
- safeguards against semantically related but legally irrelevant results.

When introduced, retrieve lexical and vector candidates separately and combine them using evaluated rank fusion. OpenSearch documents RRF and score-normalization approaches, but weights must be learned from Jurvio judgments rather than copied from defaults ([OpenSearch hybrid-search optimization](https://docs.opensearch.org/latest/search-plugins/search-relevance/optimize-hybrid-search/)).

## 12. Search quality program

Create a versioned judgment set covering:

- docket/citation exact lookup;
- common and rare party names;
- corporate aliases and former names;
- attorney/judge names;
- case caption variants;
- legal topics and phrases;
- ambiguous names;
- misspellings;
- sensitive and held records;
- zero-result queries.

Track precision@1, success@3, NDCG@10, zero-result rate, filter correctness, p50/p95 latency, index lag, stale-result rate and same-name error rate. Relevance changes require offline evaluation and guarded online experiments.

## 13. Availability and cost controls

- One managed OpenSearch deployment initially, with production redundancy sized after benchmarks.
- Cache only safe, common anonymous queries and exact identifier resolutions.
- Rate-limit by endpoint and behavior, not just IP.
- Cap wildcard, regex, Boolean clause and aggregation complexity.
- Keep an exact-identifier PostgreSQL fallback for critical navigation, not full-text fallback.
- Do not add Redis solely for search caching before hit-rate measurements justify it.

## 14. Gate 5A decisions requested

1. Approve managed OpenSearch for public search before beta, with PostgreSQL authoritative.
2. Approve separate index families behind versioned aliases.
3. Approve deterministic query routing and lexical relevance as v1.
4. Approve explicit same-name occurrences rather than silent identity blending.
5. Approve semantic/hybrid ranking only after a relevance judgment set and benchmark.
6. Approve cursor/PIT pagination and complexity/rate limits.

