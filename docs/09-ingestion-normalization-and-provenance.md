# Jurvio Gate 4B: Ingestion, Normalization, and Provenance Architecture

**Status:** Approved  
**Date:** 2026-07-19  
**Depends on:** Gate 4A canonical model

## 1. Objective

Build a repeatable provider-independent pipeline that can acquire millions of records, preserve evidence, update incrementally, and recover from parser or AI mistakes without corrupting canonical data.

## 2. Architecture boundary

Use a modular monolith for control-plane APIs and independently scalable worker processes for acquisition, parsing, normalization, resolution, publication and enrichment. A durable managed queue is introduced when workload begins; Kafka is not required for launch.

```text
Provider adapter
  → acquisition job
  → immutable raw snapshot
  → validation/quarantine
  → deterministic parsing
  → normalized observations
  → identity/dedup candidates
  → canonical projection
  → policy and quality gates
  → public/search/AI projections
```

Every stage is replayable from immutable input. Downstream failure never requires reacquiring the original source.

## 3. Provider adapter contract

Each adapter must implement equivalent capabilities, even if a provider lacks some of them:

- provider and dataset identity;
- supported record/document types and jurisdiction coverage;
- authentication and rate policy;
- incremental discovery by cursor/date/version;
- deterministic provider record key;
- fetch metadata and payload/artifact retrieval;
- deletion, sealing, withdrawal and correction signals;
- rights-policy identifier;
- checkpoint serialization;
- retry classification;
- adapter and mapping version;
- fixtures for contract tests.

Adapters emit a standard envelope containing provider ID, record type/key, observed and effective timestamps, source URL, parent keys, checksums, content type, rights class and raw object pointers. They do not emit canonical entities.

## 4. Processing stages

### A. Discovery and acquisition

- Poll feed, bulk manifest, API or approved crawl source.
- Respect provider limits and conditional requests.
- Write payload bytes once by checksum.
- Record fetch result even when unchanged, missing or withdrawn.
- Advance checkpoints only after durable raw storage.

### B. Validation and quarantine

- Validate MIME type, size, malware status, schema and checksum.
- Detect encrypted, malformed, truncated or unexpected documents.
- Apply rights and sensitive-record policy before further processing.
- Quarantine failures with reason; do not silently discard them.

### C. Deterministic extraction

- Parse provider metadata.
- Extract text/layout where available.
- OCR only if text quality fails and policy allows it.
- Segment into stable page/block passages.
- Extract explicit identifiers, citations, captions, dates and roles.
- Store parser version and field observations.

### D. Normalization and resolution

- Map source labels to controlled vocabularies.
- Generate case/document/event duplicate candidates.
- Resolve deterministic high-confidence keys automatically.
- Route ambiguous person/entity resolution to candidate state.
- Compute canonical projections using documented precedence.

### E. Policy, publication and enrichment

- Evaluate sealing, privacy, rights, identity and minimum-content gates.
- Publish source-only entities before optional AI enrichment when useful.
- Trigger only affected projections.
- Generate summaries from a frozen source set.
- Validate citations, evidence language and source coverage before publication.

## 5. Idempotency and concurrency

- Every job has an idempotency key: stage + input revision + processor version + policy version.
- At-least-once delivery is assumed; handlers must safely repeat.
- Database uniqueness constraints are the final duplicate defense.
- Use short leases with heartbeats; abandoned work returns to the queue.
- Canonical projection uses row/version checks to avoid stale writers.
- Side effects use an outbox table committed with canonical changes.
- Search indexing, sitemap updates and cache invalidation consume the outbox.

Exactly-once messaging is not required.

## 6. Duplicate handling

### Deterministic matches

- exact jurisdiction-qualified docket/court identifiers;
- exact provider alias already linked;
- exact document byte checksum;
- explicit official citation/identifier with compatible court/date.

### Candidate matches

- caption similarity plus court/date proximity;
- docket-format variants;
- corrected or transferred case relationships;
- document text similarity where byte checksums differ;
- professional name plus bar/court identifier signals.

Candidate scores are explainable feature records, not a single opaque number. Ambiguous cases remain separate until rules or review resolve them.

## 7. Reprocessing and invalidation

A dependency ledger records which processor/source-set produced each derived object. Reprocess when:

- source checksum or active source set changes;
- parser, taxonomy, prompt, model or policy version changes;
- identity merge/split changes relevant relationships;
- a correction or publication hold is applied;
- quality thresholds change.

Rebuild the smallest affected unit. A new docket entry should not regenerate unrelated document text or the entire case summary.

## 8. Secondary content ingestion

Start with publisher-submitted URLs, RSS feeds, sitemaps, APIs and approved discovery feeds. Store metadata and canonical outbound links by default.

For each item:

1. determine publisher, author, date and canonical URL;
2. capture only permitted text;
3. detect cases/entities mentioned and retain evidence for the link;
4. identify representation or sponsorship conflicts where known;
5. create a concise Jurvio-authored description or summary;
6. label content as reporting, commentary, marketing/client alert or advocacy;
7. send traffic to the original publisher.

Social material should use official embeds or links when permitted. Public availability alone does not authorize bulk copying. Scraping, storage, display and model use each require a documented policy basis.

## 9. Holds, deletions and corrections

- A policy signal can immediately stop publication and downstream indexing.
- Holds cascade to page/search/cache projections without deleting evidence.
- Provider deletion is recorded as a new state, not erased history, subject to retention policy.
- A sealed/redacted replacement becomes the active public revision.
- Corrections are auditable and reversible.
- Dead-letter queues are not publication queues; unresolved items remain private.

## 10. Operations and cost controls

Track by provider, stage, court, document and entity:

- acquired and changed records;
- queue age, throughput, attempts and terminal failures;
- duplicate and conflict rates;
- bytes stored/transferred;
- PACER/licensing/OCR/AI costs;
- publication and hold outcomes;
- parser and summary quality samples.

Set daily and monthly circuit breakers for paid acquisition, OCR, AI, SMS/email and abnormal object-storage growth.

## 11. Acceptance criteria

1. Reimporting the same provider snapshot creates no duplicate canonical records.
2. Every canonical material field can be traced to observations and source revisions.
3. Parser and policy upgrades can be replayed without refetching sources.
4. Ambiguous identity matches remain unpublished candidates.
5. Holds remove affected projections within a measured urgent target.
6. Queue retries do not duplicate external side effects.
7. A provider can be disabled without breaking canonical reads.
8. One provider's schema change is quarantined instead of corrupting shared entities.
9. Secondary commentary is visibly distinct from court records and linked to its origin.
10. Cost and quality dashboards support per-stage decisions.

## 12. Alternatives considered

| Alternative | Why not now | Reconsider when |
|---|---|---|
| Kafka/event-streaming platform | High operational overhead for initial batch/feed workloads | Sustained event volume and multiple independent consumers justify it |
| Provider-specific pipelines | Faster once, expensive forever | Never for canonical flow |
| AI-first parsing | Costly, nondeterministic and harder to audit | Only for fields deterministic methods cannot reliably extract |
| Synchronous end-to-end imports | Fragile and difficult to replay | Never for bulk ingestion |
| Full-web law-firm crawl at launch | Rights, quality and maintenance burden | After publisher program and source policies are proven |

## 13. Gate 4B decisions requested

1. Approve provider adapters that emit immutable standard envelopes, not canonical entities.
2. Approve replayable staged workers with at-least-once delivery and idempotent handlers.
3. Approve deterministic extraction before AI and candidate state for ambiguity.
4. Approve an outbox-driven projection model for search, cache and sitemaps.
5. Approve RSS/API/submission-first secondary-content acquisition, with broad crawling deferred.
6. Approve immediate publication holds independent of source retention.

