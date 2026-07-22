# ADR 0001: Canonical Data and Ingestion Foundation

**Status:** Accepted  
**Date:** 2026-07-19

## Context

Jurvio must combine heterogeneous court and commentary sources while preserving provenance, supporting corrections and remaining operable by a small team.

## Decision

- Use PostgreSQL as the canonical transactional store.
- Use S3-compatible object storage for immutable source artifacts.
- Model the initial knowledge graph relationally.
- Use a modular monolith plus independently scalable, idempotent workers.
- Treat search indexes, embeddings, page projections and AI output as rebuildable derivatives.
- Require provider adapters to emit immutable standard source envelopes.
- Introduce a durable managed queue, but not Kafka, for initial workloads.

## Consequences

Benefits include strong integrity, auditable provenance, low operational complexity, provider portability and deterministic replay. Costs include careful schema governance, explicit projection pipelines and possible future migration of specialized graph/search workloads.

## Reconsideration triggers

- PostgreSQL fails measured multi-hop graph latency or scale targets after query/index optimization.
- Queue throughput or consumer topology demonstrably requires a streaming log.
- Independent teams and deployment boundaries make service extraction operationally cheaper than the modular monolith.
- Search benchmarks justify a dedicated OpenSearch cluster.

## Approval

This ADR becomes Accepted when Gate 4 is explicitly approved.
