# Jurvio Gate 2A: Launch Corpus Specification

**Status:** Approved  
**Date:** 2026-07-19  
**Depends on:** Approved Gate 1 strategy

## 1. Purpose

This specification defines what Jurvio will ingest, normalize, enrich, publish, index, and update for its first public release. Its purpose is to prevent an unbounded “all court records” launch from creating unreliable coverage, uncontrolled costs, thin SEO pages, or misleading summaries.

## 2. Launch principle

Jurvio will maintain broader data coverage than AI-enrichment coverage.

- **Ingest broadly:** legally reusable federal opinions and connected metadata.
- **Publish selectively:** only records meeting source, identity, and minimum-content requirements.
- **Enrich selectively:** prioritize decisions that create user value or search demand.
- **Index deliberately:** every indexable URL must provide independent informational value.
- **Update incrementally:** recompute only what changed.

## 3. Jurisdiction scope

### Included in v1

- United States Supreme Court.
- United States Courts of Appeals.
- United States District Courts.
- United States Bankruptcy Courts when a substantive written opinion is available.
- Selected federal specialty courts when reliable source coverage exists.

### Excluded from v1

- State courts.
- International courts.
- Administrative adjudications without an approved source.
- PACER-wide document acquisition.
- Court calendars as a primary product.

State and international entities may exist internally as citation targets, but they will not be represented as covered jurisdictions.

## 4. Record classes

| Class | Examples | Ingest | Publish | AI enrich | Index |
|---|---|---:|---:|---:|---:|
| Judicial decision | Opinion, memorandum opinion, published decision | Yes | Yes when text is reliable | Priority based | Yes |
| Substantive order | Dismissal, summary judgment, injunction, sanctions, remand | Yes | Yes when text is reliable | Priority based | Yes |
| Administrative docket event | Scheduling notice, appearance, routine minute entry | Yes when connected | On case timeline | Usually no | No standalone page initially |
| Complaint | Initial pleading | Metadata initially; selected documents later | Only in approved categories | Selected | Only with substantive context |
| Motion/brief | Motion to dismiss, summary judgment brief | Metadata initially; selected documents later | Only when needed to explain case | Selected | Only with substantive context |
| Exhibit | Attachment, evidence exhibit | Reference only initially | Rare | No | No |
| Party occurrence | A party in one case and role | Yes | Yes when case page qualifies | Deterministic first | Yes subject to safeguards |
| Canonical person | Verified same person across occurrences | Candidate only | Not in initial launch by default | No automatic merge | Only after separate approval |
| Organization | Company or public body in one or more cases | Yes | Yes when evidence threshold met | Selected summary | Yes |
| Attorney/judge/firm | Professional participant | Yes | Publish after minimum-content threshold | Selected | Yes after threshold |

## 5. Source hierarchy

Jurvio will preserve source provenance and apply the following default precedence:

1. Official court or government source.
2. PACER/ECF record.
3. CourtListener/RECAP source record.
4. Approved public-domain case-law dataset.
5. Approved licensed provider.
6. Secondary publisher for discovery only, not as controlling authority.

Every ingested object must store:

- provider and provider record ID;
- source URL;
- retrieved timestamp;
- source publication/update timestamp when available;
- checksum and MIME type;
- rights/terms-policy identifier;
- parser and transformation versions;
- parent case/document relationships;
- replacement, withdrawal, sealing, or redaction status;
- raw immutable payload location.

No provider-specific field becomes the Jurvio canonical value without passing through normalization and conflict rules.

## 6. Historical coverage

### Broad source layer

Ingest all legally reusable federal opinions available from approved bulk sources, regardless of date, when a stable court and decision identity can be established.

### Launch enrichment layer

Prioritize AI enrichment for:

1. Decisions issued from January 1, 2020 forward.
2. Dispositive district-court decisions.
3. Appellate decisions with reliable full text.
4. Cases already receiving meaningful search traffic.
5. Cases involving frequently searched organizations or public-interest topics.
6. Older decisions requested by users or linked from high-value pages.

The initial enrichment target is 25,000 to 50,000 decisions. The initial AI-processing budget target is $500 to $2,000, excluding OCR, document acquisition, and human review.

## 7. Enrichment tiers

### Tier 0: Source-only

- Canonical identifiers.
- Court and dates.
- Caption and citation.
- Source text where rights permit.
- Document checksum and provenance.

### Tier 1: Deterministic structure

- Party occurrences and roles.
- Counsel and judge relationships.
- Docket number and nature-of-suit codes.
- Cited statutes and cases.
- Filing and decision dates.
- Disposition phrases where explicit.
- Document headings and paragraph/page anchors.

### Tier 2: Economy AI

- Document classification.
- Topic labels.
- Event candidates.
- Importance score.
- Sensitive-content and review-risk signals.
- Relationship candidates that remain unverified.

### Tier 3: Public summary

- What the case is about.
- Procedural posture.
- What the court decided.
- Reasoning summary.
- Outcome and unresolved issues.
- Important timeline events.
- Material sentence-to-source support.

### Tier 4: Premium/reviewed enrichment

Reserved for complex, contradictory, sensitive, or high-traffic decisions. It may include a stronger model pass and/or human review.

## 8. AI summary eligibility

A decision may receive a public AI summary only when:

- sufficient source text is available;
- source identity is stable;
- text quality passes extraction thresholds;
- the document type is supported;
- controlling document status is not sealed, withdrawn, or superseded without clear treatment;
- the model can identify material supporting passages;
- the result passes structural, citation, and language checks.

If these conditions fail, Jurvio publishes source metadata and states that a reliable summary is not yet available. It must never manufacture completeness.

## 9. Publishing thresholds

### Case page

An indexable case page requires:

- stable court and case identifier;
- canonical or source-supported caption;
- at least one substantive source or sufficient docket context;
- visible provenance and last-checked information;
- no known sealing/redaction conflict;
- enough unique information to be useful without a subscription.

### Case-party occurrence page

An indexable occurrence page requires:

- direct relationship to a qualifying case;
- party role from a source record;
- case caption, court, docket number, date, and procedural context;
- same-name warning where ambiguity is possible;
- no speculative address or social-profile publication;
- no page design whose primary function is to sell access to the name’s record.

### Name disambiguation page

An indexable name page requires at least two distinct qualifying occurrences or one occurrence plus sufficient contextual information. It must not imply that occurrences represent the same person.

### Judge, attorney, and firm pages

Index only after a configurable minimum number of verified relationships or sufficient biographical/official context. Empty directory shells remain `noindex`.

## 10. Update and invalidation rules

- Source records are immutable snapshots; later versions create new revisions.
- Canonical entities reference the active revision.
- New docket events do not automatically regenerate the entire case summary.
- Only affected events, status fields, and summary sections are recomputed.
- Source checksum changes trigger parser and enrichment review.
- Sealing, redaction, withdrawal, or expungement signals create an immediate publication hold.
- AI summaries are versioned by source set, prompt, model, and policy version.
- Human corrections create an auditable override and do not alter raw source data.

## 11. Freshness targets

These are launch targets, not public promises until measured:

| Content | Internal target |
|---|---:|
| New appellate opinions from active source | Within 24 hours |
| New district opinions/orders from active source | Within 24–72 hours |
| Metadata correction propagation | Within 24 hours after verification |
| Sealing/redaction hold | As soon as detected, prioritized immediately |
| AI enrichment for eligible new decisions | Within 24–72 hours |

Jurvio will publish measured freshness and coverage by court/source instead of claiming universal completeness.

## 12. Cost controls

- Batch/flex AI for offline enrichment.
- Deduplicate source documents before processing.
- Never re-summarize an unchanged source set.
- Use deterministic extraction before AI.
- Enrich older documents based on traffic, importance, or request.
- Cap AI output schemas and token budgets.
- Do not purchase missing PACER documents automatically.
- Do not OCR documents already containing usable text.
- Maintain per-provider, per-court, per-document, and per-enrichment cost ledgers.
- Add circuit breakers for daily AI, PACER, OCR, email, and SMS spend.

## 13. AI-discovery representation

Each published entity uses one canonical data record to render:

- server-rendered human-readable HTML;
- embedded JSON-LD matching visible page facts;
- a versioned machine-readable JSON endpoint;
- stable heading and source-passage anchors;
- XML sitemap entries;
- internal graph links;
- visible update and source dates.

A site-level AI/crawler policy may explain Jurvio’s data model and permitted use. Jurvio will not create duplicative per-entity text files solely for AI crawlers.

## 14. Exclusions and exceptional review

Publication policies must separately address:

- minors;
- sealed, expunged, withdrawn, or redacted records;
- social security, financial-account, medical, home-address, and other sensitive information;
- family and immigration matters;
- crime victims and witnesses;
- mistaken identity;
- source-provider correction or deletion notices;
- documents whose public availability changes after ingestion.

The exact exceptional-publication policy requires outside counsel before launch.

## 15. Launch acceptance criteria

The corpus is ready for a public beta only when:

1. Approved source rights are documented.
2. Import runs are repeatable and idempotent.
3. Raw source payloads and provenance are retained.
4. Duplicate rates and identity conflicts are measured.
5. At least 10,000 representative summaries pass automated validation.
6. A stratified human audit establishes acceptable summary and citation accuracy.
7. Coverage and freshness dashboards exist internally.
8. Sealing/redaction and correction holds can stop publication.
9. Every indexable template passes minimum-content rules.
10. Costs are measured per published and enriched entity.

## 16. Gate 2 decisions requested

1. Approve broad ingestion of usable federal opinions across all available years.
2. Approve January 1, 2020 as the initial default AI-enrichment priority date.
3. Approve a 25,000–50,000 decision enrichment target for launch.
4. Approve opinions and substantive orders as v1’s primary documents.
5. Approve selected complaints/motions only when necessary for case understanding or an approved monitored category.
6. Approve measured court/source coverage rather than an “all cases” claim.
