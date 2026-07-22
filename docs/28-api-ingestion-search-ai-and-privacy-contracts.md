# Jurvio Final Architecture Package C: API, Ingestion, Search, AI and Privacy Contracts

**Status:** Final approval draft  
**Date:** 2026-07-19

## 1. Application architecture

Start as a modular monolith with separately deployable workers.

Modules:

- identity/access;
- catalog/entities;
- cases/dockets;
- documents/citations;
- ingestion/normalization;
- status/procedure;
- search;
- enrichment/AI;
- follows/alerts;
- subscriptions/entitlements;
- publication/privacy;
- analytics/admin.

Use typed internal module contracts and transactional boundaries. Split services only after measured scaling or ownership needs.

## 2. Public API shape

Versioned REST under `/api/v1`.

Read resources:

- `GET /cases/{id}`
- `GET /cases/{id}/docket`
- `GET /cases/{id}/parties`
- `GET /cases/{id}/attorneys`
- `GET /cases/{id}/timeline`
- `GET /cases/{id}/documents`
- `GET /documents/{id}`
- `GET /entities/{id}`
- `GET /attorneys/{id}`
- `GET /judges/{id}`
- `GET /firms/{id}`
- `GET /courts/{id}`
- `GET /nature-of-suit/{code}`
- `GET /search`

Account resources:

- follows;
- saved searches;
- alert rules;
- notification preferences;
- exports;
- correction/privacy requests.

Contracts include opaque ID, type, schema version, source/provenance links, verification time, publication limitations and stable pagination cursor. Field-level entitlements prevent accidental paid-data leakage.

JSON-LD and public machine representations are generated from the same public projection as HTML.

## 3. API safety

- authentication for personal/workflow resources;
- organization RBAC;
- short-lived sessions and secure cookies;
- API keys for approved machine clients;
- per-user/key/IP rate limits;
- idempotency keys for writes;
- cursor pagination;
- allowlisted export fields;
- audit logs;
- no raw provider payloads or restricted source fields;
- privacy directive enforcement before serialization;
- versioned deprecation policy.

## 4. Provider adapter contract

Every adapter implements:

- source discovery;
- checkpoint/cursor;
- conditional retrieval;
- raw preservation;
- source ID/version extraction;
- deletion/sealing/correction detection;
- rate/terms policy;
- health metrics;
- deterministic retry/backoff;
- replay from raw artifacts.

Adapters emit source events. They never write canonical public entities directly.

## 5. Ingestion pipeline

1. discover;
2. retrieve;
3. hash/deduplicate;
4. store immutable raw artifact;
5. parse;
6. normalize source-scoped record;
7. validate;
8. resolve canonical entities;
9. create/update canonical events;
10. run deterministic status;
11. evaluate publication/privacy;
12. enqueue document extraction/enrichment;
13. project search/cache/API;
14. evaluate alerts;
15. record metrics and audit.

Use PostgreSQL jobs/outbox initially. Each stage is idempotent, retryable and replayable. Dead-letter failures remain inspectable.

## 6. Document pipeline

- rights/availability check;
- secure file retrieval;
- malware/type validation;
- text-layer extraction;
- OCR only when needed;
- page/paragraph segmentation;
- header/footer cleanup without altering source;
- confidence scoring;
- document classification;
- deterministic metadata;
- citation/statute extraction;
- PII/sensitive-data scan;
- publication decision;
- HTML derivative;
- optional AI explanation;
- support-link validation;
- search/embedding projection.

Low OCR confidence exposes source PDF and flags text as unreliable; it does not silently publish corrupted text.

## 7. Search architecture

OpenSearch indices are purpose-specific projections:

- cases;
- docket entries/documents;
- entities/organizations/people;
- attorneys/firms;
- judges/courts;
- legal concepts;
- enforcement matters.

Common capabilities:

- exact docket/citation/identifier lookup;
- aliases and normalized names;
- BM25 full text;
- field boosts;
- typo tolerance;
- Boolean/phrase search;
- filters;
- date/status sorting;
- highlighting;
- access/publication filters;
- freshness and coverage signals.

Query flow:

1. classify likely intent deterministically;
2. execute exact identifier/name strategies;
3. execute lexical retrieval;
4. optionally semantic rerank a bounded candidate set;
5. diversify by entity type;
6. apply publication/privacy;
7. explain why matched.

Semantic search supplements lexical search; it never replaces exact legal identifiers. Search indexes are rebuildable from PostgreSQL/object storage.

## 8. AI architecture

Use AI only where it creates user value:

- document/case summaries;
- topic/entity/citation relationship suggestions;
- plain-language procedural narrative;
- semantic embeddings/search rerank;
- grounded Ask Jurvio.

Use deterministic logic for status, dates, roles, citations where parsable, docket ordering, filters, entitlements, publication and privacy.

AI job requirements:

- input/source version;
- prompt/model version;
- structured output schema;
- cached content hash;
- token/cost record;
- passage citations;
- validation/evaluation result;
- expiry/regeneration policy.

No AI page is published without source coverage thresholds. Reuse one enrichment across HTML, API and search rather than regenerating per visit.

Ask Jurvio retrieves only public-permitted chunks, cites sources, states uncertainty and refuses unsupported conclusions. It cannot provide legal advice or override status.

## 9. Search indexing contract

Outbox event includes object ID/type, canonical version, public-projection version, privacy version and operation.

Indexer:

- reads canonical public projection;
- creates complete replacement document;
- writes using external versioning;
- updates aliases atomically;
- verifies expected counts;
- supports full rebuild;
- logs rejected mappings;
- purges on privacy/sealing events before lower-priority enrichment.

Privacy/sealing events use a priority lane and completion acknowledgement across search, cache, API, embeddings and sitemap.

## 10. Alerts

Alerts trigger from verified canonical changes, not raw provider events.

Event types:

- new filing/document;
- status change;
- judgment/order/opinion;
- deadline/hearing;
- party/attorney/judge change;
- enforcement update;
- correction/sealing/privacy impact.

Deduplicate, bundle according to preference, include source and allow unsubscribe. Do not send allegation language as a finding.

## 11. Observability

Trace each public fact back through:

public projection → canonical version → normalized source → raw artifact → ingestion run.

Monitor provider health, lag, duplicates, parsing errors, status-review queue, search freshness, alert delay, AI cost/error, OCR confidence, privacy propagation and public-page error rates.
