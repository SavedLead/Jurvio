# ADR 0003: AI Intelligence Foundation

**Status:** Proposed  
**Date:** 2026-07-19

## Context

Jurvio needs inexpensive, understandable legal explanations without allowing probabilistic systems to become the source of legal facts. Models, prices and provider policies will change, while public claims must remain reproducible and correctable.

## Decision

- Use deterministic parsing, timelines and explicit relationships before AI.
- Store material generated statements as evidence-linked versioned assertions.
- Use a provider-neutral model gateway with task-based quality/cost routing.
- Publish source-only records when AI reliability is insufficient.
- Introduce related cases through explicit relationships before embeddings.
- Introduce cited, bounded RAG only after retrieval and answer evaluations pass.
- Use Demand Intelligence to prioritize eligible enrichment, not to lower truth or safety thresholds.
- Keep human approval over legal facts, publication policy and material product changes.

## Consequences

Jurvio gains provider portability, lower reprocessing cost, explainable summaries, safer corrections and measurable AI quality. It must invest in passage alignment, evaluation datasets, versioning, review operations and a model gateway before offering broad conversational research.

## Alternatives

- One-model/provider integration: simpler initially but creates lock-in and brittle lineage.
- AI-first document processing: faster demos but weaker accuracy, cost and reproducibility.
- Uncited prose summaries: cheaper to display but inconsistent with Jurvio's trust proposition.
- Vector-first related cases: produces plausible similarity without enough legal explanation.
- Immediate open-ended research assistant: premature before corpus and retrieval quality are measured.

## Reconsideration triggers

- A provider-neutral layer materially prevents use of a uniquely valuable capability.
- Evaluation shows a simpler single-pass process meets quality/cost targets.
- User demand and retrieval metrics justify accelerating a bounded research assistant.
- Human-review volume or critical error rates exceed launch thresholds.

## Approval

This ADR becomes Accepted when Gate 6 is explicitly approved.
