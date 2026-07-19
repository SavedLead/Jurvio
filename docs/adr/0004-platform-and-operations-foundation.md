# ADR 0004: Platform and Operations Foundation

**Status:** Proposed  
**Date:** 2026-07-19

## Context

Jurvio needs millions of public pages, large document pipelines, search, AI workers, future accounts and APIs, while remaining manageable by a small engineering team.

## Decision

- Use AWS as primary cloud and Cloudflare as public edge.
- Run portable containers on ECS Fargate.
- Use RDS PostgreSQL, S3, SQS and Amazon OpenSearch Service.
- Keep a modular monolith with independent web/API/worker process types.
- Use Terraform, GitHub Actions and immutable container releases.
- Use managed OIDC authentication, with WorkOS AuthKit as the leading candidate pending procurement/security benchmark.
- Use Stripe for billing and Jurvio-owned entitlements.
- Instrument with OpenTelemetry and initially use AWS-centered operations tooling.
- Implement Demand Intelligence through first-party events, S3/columnar storage and SQL aggregates before a heavy analytics platform.

## Consequences

The architecture provides one accountable cloud boundary, managed durability, portable application containers, scalable workers and fewer specialist systems. Costs include AWS/network expertise, Terraform discipline, managed-search expense, projection consistency and reliance on managed identity/payment vendors behind documented exit boundaries.

## Alternatives

- Multi-platform Vercel/AWS architecture: excellent front-end convenience but greater networking, deployment and cost fragmentation.
- Kubernetes: unjustified operational complexity for the initial team.
- Cognito-only identity: strong AWS alignment but currently less attractive product/enterprise UX than specialist providers; retain as benchmark candidate.
- Raw analytics in canonical PostgreSQL: risks performance and storage contention.
- Immediate warehouse/CDP stack: premature before event volume and decision workflows are proven.

## Reconsideration triggers

- Fargate or OpenSearch costs materially exceed equivalent managed alternatives.
- Vercel or another platform proves a meaningful full-lifecycle delivery advantage.
- Identity-provider pricing, portability or security fails procurement review.
- Analytics volume or latency makes S3/SQL aggregates insufficient.
- Team/service scale justifies Kubernetes or service extraction.

## Approval

This ADR becomes Accepted when Gate 7 is explicitly approved.
