# Jurvio Gate 6A: AI Enrichment and Summary Architecture

**Status:** Decision draft  
**Date:** 2026-07-19  
**Depends on:** Approved Gates 1–5 and the Gate 6 Demand Intelligence foundation

## 1. Objective

Jurvio uses AI to make litigation understandable while preserving the court record as authority. AI output is derived content: sourced, typed, versioned, reproducible, correctable and removable without affecting source evidence.

## 2. Task allocation

### Deterministic by default

- court, docket, filing and decision identifiers;
- explicit dates and docket sequence;
- document checksums, page/block anchors and headings;
- exact citations and statute references;
- known party/professional roles from structured records;
- explicit disposition phrases where safely mapped;
- source precedence, freshness and publication policy;
- unchanged-input detection and cache keys;
- cost, lineage and processor-version tracking.

### AI-assisted

- plain-language case and decision summaries;
- procedural-posture explanations;
- issue, reasoning, result and remaining-matter extraction;
- document classification when source labels are insufficient;
- importance ranking of docket events;
- topic and doctrine candidates;
- relationship and identity candidates;
- external-conversation clustering;
- complex query interpretation and grounded answers later.

AI may propose but may not verify identity merges, override source records, remove publication holds, determine legal advice, or manufacture an outcome from an administrative status.

## 3. Enrichment pipeline

```text
Eligible canonical document revision
  → freeze source set and policy version
  → deterministic text/layout/passages
  → quality and sensitive-content checks
  → document and section classification
  → structured fact candidates
  → summary generation
  → evidence alignment
  → deterministic validators
  → independent model verifier when warranted
  → risk/quality gate
  → public assertion versions or review queue
```

Every stage is idempotent and addressable by source-set hash, processor/prompt version, model deployment, taxonomy version and policy version.

## 4. Summary product schema

### Decision summary

- document identity and date;
- deciding court/judge where sourced;
- procedural posture;
- issue or motion before the court;
- result;
- core reasoning;
- effect on claims/parties;
- what remained unresolved;
- appeal/remand/supersession context where known;
- sentence-level evidence links.

### Case overview

- neutral dispute description;
- parties and roles;
- important procedural history;
- latest meaningful documented status;
- controlling decisions;
- known limitations or missing records.

A case overview is assembled from versioned decision/event assertions. It is not a free-form resummary of an ever-growing docket.

## 5. Evidence contract

Every material generated sentence stores:

- assertion/evidence class: allegation, argument, undisputed record fact, court finding, order, disposition or administrative event;
- supporting passage IDs and support role;
- source document revision and source-set ID;
- entailment/coverage validation result;
- generator, prompt and model versions;
- confidence, publication and review state;
- created, superseded and corrected timestamps.

If support cannot be aligned, Jurvio omits the assertion or explicitly states that a reliable explanation is unavailable. A generic link to the beginning of a PDF is not sufficient passage support when alignment is technically available.

## 6. Long-document strategy

- Preserve layout-aware pages, headings, footnotes and paragraph blocks.
- Select relevant sections deterministically using document class and headings.
- Retrieve additional passages for identified issues, claims and outcomes.
- Generate structured section findings before prose.
- Compose the final summary from structured findings and their evidence.
- Run a global consistency pass against the complete document outline and key sections.

Do not summarize arbitrary chunks independently and concatenate them. That loses procedural context, qualifications and cross-section reasoning.

## 7. Timeline architecture

The canonical timeline is deterministic from docket events and decisions. AI may:

- normalize a plain-language event title;
- explain why an event matters;
- group duplicates/attachments as candidates;
- rank significance;
- connect a ruling to the motion it decided.

AI may not invent missing events or treat a filing as granted merely because it requested relief. Important-event selection is versioned independently from the underlying timeline.

## 8. Topic and relationship extraction

- Start with explicit nature-of-suit/cause codes, citations and controlled rules.
- AI proposes topics, doctrines, claim types and relationships using a versioned taxonomy.
- Candidates require evidence passages and confidence.
- High-impact or identity-related relationships require rule or human verification.
- Retain rejected candidates as negative evidence.
- Taxonomy migrations are explicit and reprocessable.

## 9. Provider-neutral model gateway

Jurvio uses an internal model gateway with a capability registry rather than embedding provider-specific model names throughout the system.

Registry fields include:

- provider/deployment and model version;
- approved task classes;
- context/output limits;
- structured-output/tool capabilities;
- region, retention and training-policy configuration;
- measured quality, latency and failure rate;
- input, cached-input and output costs;
- effective and retirement dates;
- fallback eligibility.

Canonical records store Jurvio task/version identifiers plus execution lineage. Provider response IDs remain operational metadata.

## 10. Model routing

### Economy route

Use for classification, topic candidates, importance scoring and low-risk structured extraction.

### Standard route

Use for ordinary supported decisions and evidence-aligned summaries.

### Complex/review route

Use stronger processing and/or human review for long, multi-document, contradictory, sensitive, high-traffic or failed-validation matters.

Routing begins with deterministic complexity/risk signals. The router cannot choose a higher-cost route beyond configured budgets without an approved policy. Provider fallback is allowed only for tasks where evaluation establishes acceptable equivalence.

## 11. Prompt and result management

- Prompts are versioned artifacts with owners, intended tasks, schemas and evaluation baselines.
- Production prompts contain explicit evidence-language and abstention rules.
- Court documents and external webpages are untrusted data, not instructions.
- Structured output is schema validated before persistence.
- Cache key includes normalized input/source-set hash, prompt, model deployment, policy and schema versions.
- Never regenerate unchanged approved output solely because a newer model exists.
- Model upgrades require offline evaluation, shadow processing and controlled rollout.

## 12. Validation and publication gates

Deterministic checks include:

- required fields and allowed evidence classes;
- cited passage existence and revision match;
- date/name/citation consistency;
- prohibited unsupported outcome language;
- allegation/finding distinction;
- sealed/withdrawn/superseded status;
- duplicate or contradictory assertion detection;
- length, readability and unsupported-superlative checks.

High-value summaries may receive a separate verifier pass using different prompts or a different approved model. Model agreement is a signal, not proof. Failed items remain source-only or enter review.

## 13. Corrections and regeneration

- Public corrections create superseding assertion versions.
- A source revision invalidates only dependent claims and summaries.
- A disputed statement can be unpublished immediately without deleting lineage.
- Human-reviewed assertions remain locked unless the new source set materially changes or review is reopened.
- Reprocessing records the reason and before/after evaluation.

## 14. Cost architecture

Track cost by provider, task, source document, case, court, content tier and public page. Include:

- acquisition and OCR;
- input/cached/output tokens;
- verification/retry calls;
- human review;
- embeddings and storage;
- cost per published summary and engaged page.

Controls:

- offline batch processing where supported;
- deterministic extraction before AI;
- content-addressed caching;
- capped output schemas;
- no enrichment for duplicate/unchanged/held content;
- traffic, demand-gap and legal-value prioritization;
- daily/monthly provider and task circuit breakers;
- automatic downgrade to source-only when budgets are exhausted.

## 15. Demand Intelligence integration

The Demand Intelligence Loop may prioritize an eligible enrichment backlog using:

- human search and page demand;
- AI citations/referrals and verified agent/API interest;
- zero-result and coverage gaps;
- jurisdiction/topic growth;
- summary/source engagement;
- estimated cost and risk.

Demand never lowers evidence, identity, privacy or publication thresholds. It changes work order, not truth standards.

## 16. Gate 6A decisions requested

1. Approve deterministic extraction and canonical timelines before AI explanation.
2. Approve structured, sentence-level evidence contracts for material generated claims.
3. Approve a provider-neutral model gateway and evaluated task-based routing.
4. Approve source-only publication when reliable AI output is unavailable.
5. Approve independent validation/review routes based on complexity, risk and traffic.
6. Approve demand-based enrichment priority without relaxing publication standards.

