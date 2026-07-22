# ADR 0004: Platform and Operations Foundation

**Status:** Accepted  
**Date:** 2026-07-19

## Context

Jurvio needs millions of public pages, large document pipelines, search, AI workers, future accounts and APIs, while remaining manageable by a small engineering team.

## Decision

- Use DigitalOcean as the primary application and managed-data cloud, Cloudflare as the public edge and Cloudflare R2 as object storage.
- Run portable OCI containers on DigitalOcean App Platform.
- Use DigitalOcean Managed PostgreSQL and Managed OpenSearch.
- Start with a PostgreSQL-backed durable job queue behind a provider-neutral adapter.
- Keep a modular monolith with independent web/API/worker process types.
- Use Terraform, GitHub Actions and immutable container releases.
- Use managed OIDC authentication, with WorkOS AuthKit as the leading candidate pending procurement/security benchmark.
- Use Stripe for billing and Jurvio-owned entitlements.
- Instrument with OpenTelemetry and initially use DigitalOcean/Cloudflare operations signals.
- Implement Demand Intelligence through first-party events, R2/columnar storage and portable SQL aggregates before a heavy analytics platform.
- Cap combined AI/OCR launch spend at $500 per month and require demand-driven paid document acquisition/enrichment.

## Consequences

The architecture provides a small-team operating model, managed core data services, portable application containers, controlled document egress and fewer specialist systems. Costs include cross-provider discipline, Terraform, managed-search expense, PostgreSQL queue governance, projection consistency and reliance on managed identity/payment vendors behind documented exit boundaries.

## Alternatives

- AWS: broad and mature, but its billing, networking and managed-service complexity are unnecessary at Jurvio's launch stage; retain as a future migration option.
- Hetzner as the primary platform: lower compute prices but too much self-managed data/search/queue responsibility for the initial team.
- Render/Railway: convenient application platforms without the same integrated managed OpenSearch fit.
- Kubernetes: unjustified operational complexity for the initial team.
- Raw analytics in canonical PostgreSQL: risks performance and storage contention.
- Immediate warehouse/CDP stack: premature before event volume and decision workflows are proven.

## Reconsideration triggers

- App Platform or Managed OpenSearch costs materially exceed equivalent managed alternatives.
- Hetzner, AWS, Render or another platform proves a meaningful full-lifecycle advantage after migration costs are included.
- Identity-provider pricing, portability or security fails procurement review.
- Analytics volume or latency makes R2/SQL aggregates insufficient.
- Team/service scale justifies Kubernetes or service extraction.

## Approval

Accepted by explicit Gate 7 approval on 2026-07-19, including the DigitalOcean and Cloudflare amendment.
