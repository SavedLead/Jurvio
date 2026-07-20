# Jurvio

Jurvio makes public litigation searchable, understandable, and connected.

## Current scope

This branch implements approved Milestones M0 and M1:

- typed Next.js modular-monolith foundation;
- PostgreSQL canonical schema and migrations;
- deterministic, versioned case-status engine;
- immutable source-artifact storage contract;
- CourtListener/RECAP docket ingestion vertical slice;
- publication controls, outbox events, health endpoint, and CI.

Ingested records remain **draft**. Ingestion never makes a record public automatically.

## Local setup

1. Install Node.js 22 and pnpm 10.13.1.
2. Copy `.env.example` to `.env.local`.
3. Start PostgreSQL with `docker compose up -d postgres`.
4. Run `pnpm install`.
5. Run `pnpm db:migrate`.
6. Run `pnpm dev`.

Run all checks with `pnpm verify`.

The production container is defined in `Dockerfile`. Deployment sequencing, readiness checks, backups, rollback, and cost gates are documented in `docs/33-staging-deployment-runbook.md`.

## CourtListener ingestion

Set `COURTLISTENER_TOKEN` when required, then run `pnpm ingest:docket <courtlistener-docket-id>`.

The adapter stores the unmodified response, records its hash and provenance, normalizes only supported fields, and emits a transactional `case.changed` outbox event.

## Internal publication console

`/internal/publication` is protected by Cloudflare Access JWT validation and Jurvio role-based authorization. Bootstrap authorized staff with `pnpm internal:user <email> <role>` after applying migrations. See `docs/32-internal-access-runbook.md` for setup and verification.

## Architectural invariants

- PostgreSQL is canonical; search and AI outputs are rebuildable projections.
- Raw source artifacts are immutable and content-addressed.
- Unknown facts remain unknown.
- Status is deterministic and source-backed.
- AI cannot determine status, publication, privacy, or identity.
- Public routes return only records approved for publication.

See `docs/30-final-architecture-approval-index.md`.
