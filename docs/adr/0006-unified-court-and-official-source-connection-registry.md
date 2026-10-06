# ADR 0006: Unified Court and Official-Source Connection Registry

**Status:** Proposed  
**Date:** 2026-08-17

## Context

Jurvio already has federal-court ingestion and a 108-court heartbeat. The product now needs to acquire official agency documents as they are published, detect missing opening documents, track secondary coverage, and visibly prove that every connection is working.

## Decision

Use a single registry and health contract for court, agency, archive, and coverage connections. Court intake remains canonical for case identity. Official agency records enrich cases; RECAP bridges free public documents; PACER is a narrowly budgeted reconciliation lane; web material is attributed secondary coverage.

## Benefits

- One visible control plane prevents silent coverage gaps.
- Preserves authority boundaries between court record, agency assertion, and reporting.
- Reuses current heartbeat and ingestion patterns.
- Enables incremental expansion without hidden one-off watchers.

## Costs and risks

- Requires new registry/checkpoint data and adapters.
- Source formats and availability vary.
- PACER needs explicit cost and credential controls.
- Automatic name matching can create false links without confidence thresholds.

## Reconsideration trigger

Reconsider the modular-monolith implementation only when polling, matching, or document processing cannot meet defined freshness targets with isolated jobs and a shared database queue.
