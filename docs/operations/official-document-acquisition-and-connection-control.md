# Official document acquisition and connection-control architecture

**Status:** Proposed for Data, Platform, and Execution approval  
**Owner direction recorded:** David Rosenberg, August 17, 2026 (Eastern Time)  
**Scope:** Court intake, official-source document enrichment, public-web coverage discovery, and the z.jurvio.com connection control plane.

## Decision

Jurvio will operate one source registry and one acquisition queue.

- **Court is the canonical intake lane.** Every supported court produces the case shell and docket identity. The existing 108-court fleet remains the federal baseline: Supreme Court, 13 circuits, and 94 districts.
- **Official sources enrich the case.** DOJ/USAO, SEC, FTC, CFTC, CFPB, FBI, IRS-CI, agency components, and later state/international sources are separate source rows, not substitute courts.
- **RECAP is the free document bridge.** It is used for public docket/documents and reconciliation, never as proof of complete real-time coverage.
- **PACER is the targeted official gap-fill.** It is queried only where the opening-document package or case-changing document is absent from the free lanes, and never for sealed or restricted material.
- **Web coverage is a separate evidence class.** Once daily per active case, Jurvio checks reputable public web sources and publicly accessible PDFs. It may enrich a Coverage timeline, but cannot overwrite court or agency facts.

## Source registry

Every connection, including future ones, must be a row in a registry with:

| Field | Meaning |
|---|---|
| source kind | court, agency, agency component, document archive, web-coverage source |
| connection method | official API, RSS/Atom, sitemap/change feed, official HTML index, RECAP API, authenticated PACER reconciliation |
| cadence | target polling interval and daily-reconciliation schedule |
| cursor | stable source-specific checkpoint |
| health | healthy, delayed, degraded, failing, disabled, or not configured |
| proof | latest successful retrieval, latest discovered item, latest published case, failure count and last error category |
| coverage | supported court/agency, event and document types, known exclusions |
| authority | primary court record, official agency, or secondary coverage |

A connection is healthy only after it has retrieved successfully within its source-specific freshness window. A failed feed is never interpreted as “no new case.”

## Acquisition lifecycle

1. Court lane discovers or reconciles a case and creates/updates its shell.
2. Case identity triggers parallel official-source matching.
3. Documents are downloaded once, hashed, stored as immutable artifacts, classified and source-linked.
4. Deterministic extraction reads docket number, court, event date, parties, judge, agencies, statutes, document type, stage, and document relationships.
5. High-confidence matches attach to the case; ambiguous matches enter review.
6. Missing opening material creates a targeted RECAP/PACER document-gap task.
7. The active case receives a daily web-coverage sweep; matched items are clearly labeled secondary coverage.
8. Any new document queues incremental case-intelligence enrichment, never a full expensive re-run.

## z.jurvio.com: Connection Control

Create a private **Connection Control** page, grouped and color-coded by jurisdiction/source group:

- Federal courts: SCOTUS, circuits, districts
- Article I / specialized federal tribunals
- Immigration courts and Board of Immigration Appeals
- International courts and tribunals
- Federal agencies and components
- Later: state courts and state agencies

One row per court or source, with:

| Column | Definition |
|---|---|
| Group / connection | color-coded group and exact court/agency name |
| Cases published | count published from that court or linked to that agency |
| Last published case | caption/docket link plus Eastern timestamp |
| Last source item | latest discovered docket/document/release |
| Health | healthy, delayed, degraded, failing, disabled, not configured |
| Connection method | official RSS/API, official index, RECAP, PACER reconciliation, sitemap, or web discovery |
| Cadence | expected poll/reconciliation interval |
| Gap / action | short actionable reason, e.g. `opening_document_missing`, `feed_timeout`, `review_required` |

The page is read-only initially. It shows real state rather than green placeholders. It must also surface every unconfigured future connection so no coverage expansion can become invisible.

## Initial implementation order

1. Extend the existing court heartbeat into the unified connection registry and Connection Control page.
2. Add DOJ/USAO and SEC official-source adapters, including document-link collection and health checkpoints.
3. Add RECAP-to-case document matching and opening-document gap detection.
4. Add PACER reconciliation only after credentials, cost ceiling, rate limits, and audit log are configured.
5. Add daily web-coverage discovery with attribution, source type, deduplication, and no factual promotion to the Case Record.
6. Add the remaining Tier 1 agencies, then Article I, immigration, international, and state registries.

## Alternatives considered

| Alternative | Why not selected | Reconsideration trigger |
|---|---|---|
| Court-only intake | Misses official complaints/informations and agency context | Never as sole strategy |
| Agency-only monitoring | Agencies are parties/issuers, not comprehensive court dockets | Never as sole strategy |
| Generic web search as primary source | Slow, incomplete, and cannot prove filing status | Only as a secondary coverage layer |
| Download every PACER document | Unbounded cost and needless processing | Only for a future opt-in, budgeted research product |
| Separate system per agency | Fragmented health and duplicate matching | Reconsider only at demonstrated scale |

## Acceptance criteria

- Every supported court/source appears in Connection Control, including disabled/not-configured rows.
- Each row has a method, cadence, health state, last successful check, and published-case count.
- A source failure creates a visible actionable state and reconciliation task.
- No public page calls an agency allegation a court finding.
- Every document preserves original URL, retrieval time in Eastern Time, hash, source classification, and case-match confidence.
- The Leor Moshe pattern is handled end-to-end: a court/agency case shell, DOJ Information, SEC complaint, linked parallel matters, and separately labeled press coverage.
