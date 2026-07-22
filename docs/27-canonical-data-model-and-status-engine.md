# Jurvio Final Architecture Package B: Canonical Data Model and Status Engine

**Status:** Final approval draft  
**Date:** 2026-07-19

## 1. Storage boundaries

- PostgreSQL is the system of record for normalized metadata, relationships, provenance, publication and privacy state.
- Object storage holds immutable raw provider payloads, permitted source documents and derived artifacts.
- OpenSearch is a rebuildable discovery projection, never the source of truth.
- Redis is optional later for ephemeral cache/rate limiting; launch uses PostgreSQL-backed jobs where sufficient.
- Analytics storage receives privacy-filtered events and cannot drive legal facts.

Every public object has an opaque, random, non-recycled Jurvio ID.

## 2. Core entities

### Source and ingestion

- provider;
- provider_endpoint;
- ingestion_run;
- raw_artifact;
- source_record;
- source_record_version;
- provenance_assertion;
- normalization_error;
- publication_candidate.

### Jurisdiction

- jurisdiction;
- court;
- court_division;
- courthouse;
- court_rule/resource;
- nature_of_suit;
- cause_of_action;
- statute;
- topic/doctrine.

### Litigation

- case;
- case_identifier;
- case_status_event;
- case_relationship;
- docket_entry;
- docket_entry_attachment;
- deadline/calendar_event;
- claim;
- disposition;
- judgment_relief.

### Documents

- document;
- document_version;
- document_file;
- extracted_text;
- text_block/paragraph;
- document_type;
- opinion;
- judgment;
- document_relationship;
- citation;
- citation_context;
- document_explanation;
- explanation_support.

### Entities and appearances

- entity;
- person;
- organization;
- public_company;
- agency;
- law_firm;
- judge_profile;
- attorney_profile;
- entity_identifier;
- entity_alias;
- entity_merge/split history;
- party_appearance;
- attorney_appearance;
- representation;
- judicial_assignment;
- firm_affiliation.

### Product and operations

- user/account;
- organization/team;
- follow;
- saved_search;
- alert_rule;
- notification_delivery;
- subscription/entitlement;
- correction_request;
- privacy_request;
- privacy_directive;
- publication_decision;
- review_task;
- audit_event;
- analytics_event.

## 3. Identity principles

Source IDs remain source-scoped. Jurvio IDs are canonical and opaque.

Entity resolution records:

- candidate links;
- match features;
- confidence;
- rule/model version;
- evidence;
- reviewer decision;
- effective dates;
- merge/split history.

No destructive merge. A mistaken merge can be reversed and every downstream relationship rebuilt.

Names, captions and slugs are attributes, not identity keys.

## 4. Temporal and provenance rules

Important relationships are effective-dated. Never overwrite history for:

- party roles;
- attorney appearances/withdrawals;
- firm affiliations;
- judge assignments;
- case captions;
- statuses;
- document versions;
- company names/subsidiaries;
- privacy/publication decisions.

Every material fact can point to source, retrieval time, source version, extraction method, confidence and reviewer where applicable.

## 5. Deterministic status engine

### Inputs

Only qualified events can change primary status:

- sourced docket entries;
- court judgments/orders;
- official agency procedural events;
- verified calendar/deadline records;
- explicit source corrections.

AI output cannot change status.

### Processing

1. normalize event type;
2. resolve event target and scope;
3. apply jurisdiction/case-type rule pack;
4. update parallel state dimensions;
5. generate a controlled explanation;
6. record rule/template version and evidence;
7. detect contradictions/ambiguity;
8. publish or route to review.

### State dimensions

Avoid one oversimplified status field. Track:

- case activity: active, stayed, closed, reopened;
- procedural phase: filing, service, pleadings, discovery, dispositive motions, trial, post-trial, appeal;
- disposition scope: none, claim/party partial, complete;
- judgment: none, entered, amended, stayed, vacated, satisfied;
- appeal: unavailable, eligible/pending period, filed, active, resolved;
- next scheduled event;
- verification: verified, stale, conflict, needs review, not verified.

Public status is a deterministic projection of these dimensions.

### Controlled explanations

Templates receive structured facts only:

- triggering event and date;
- actor;
- scope;
- current effect;
- what was not decided;
- scheduled next event;
- ordinary possible next steps.

Example:

“The court denied the motion to dismiss on May 12, 2026. The case remains active and proceeds to discovery. This ruling does not decide who ultimately wins.”

### Ambiguity

If events conflict, target scope is unclear, appeal effect is uncertain or a rule pack lacks coverage:

- do not update to a guessed state;
- publish “Status needs review” or “Status not verified”;
- expose relevant source conflict when lawful;
- create a prioritized review task;
- preserve prior verified state separately.

## 6. Publication model

A publication decision is separate from source existence.

Decision dimensions:

- publicly displayable;
- indexable;
- machine/API accessible;
- downloadable;
- summary eligible;
- alert eligible;
- reason/rule version;
- review/expiry date.

Quality thresholds consider uniqueness, source rights, extraction confidence, identity confidence, sensitivity, completeness and demand.

## 7. Privacy projection

Canonical source records remain restricted and immutable where legally permitted. Versioned privacy directives produce allowed public projections.

A directive scopes entity/field/case/document and remedy, then invalidates:

- rendered pages;
- source derivatives;
- search/autocomplete;
- metadata/JSON-LD;
- APIs/feeds/exports;
- caches/sitemaps;
- embeddings/RAG;
- summaries/alerts;
- sensitive analytics dimensions.

Opaque IDs remain stable. Suppressed names never appear in public logs, metadata or generated content.

## 8. Database implementation rules

- PostgreSQL UUID primary keys internally; opaque public IDs unique and separately indexed;
- foreign keys and check constraints for invariant enforcement;
- append-only event/version tables for legal history;
- soft deletion only where audit is required;
- row-level security for user/team/admin data;
- partition only high-volume append tables when measurements justify it;
- JSONB for provider payloads and evolving evidence, not core relational fields;
- transactional outbox for search, cache, alert and analytics projections;
- idempotency keys on ingestion and externally triggered writes.

## 9. Required schema tests

- duplicate provider events do not duplicate canonical records;
- merge/split is reversible;
- status replay produces identical output;
- source correction supersedes without erasing history;
- privacy directive removes identity from every projection;
- sealed document cannot be downloaded, indexed or embedded;
- public ID reveals no sequence and is never reused;
- a party argument cannot enter a finding field;
- mixed judgment preserves claim-level outcomes.
