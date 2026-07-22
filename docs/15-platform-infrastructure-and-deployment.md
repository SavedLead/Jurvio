# Jurvio Gate 7A: Platform, Infrastructure, and Deployment Architecture

**Status:** Approved  
**Date:** 2026-07-19  
**Depends on:** Approved Gates 1–6

## 1. Decision summary

Use DigitalOcean as Jurvio's primary application and managed-data cloud, with Cloudflare as the public edge and object-storage layer. Run the application and workers as portable OCI containers on DigitalOcean App Platform. Use DigitalOcean Managed PostgreSQL and Managed OpenSearch, Cloudflare R2, and an initially PostgreSQL-backed durable job queue.

AWS remains a future migration option, not a launch dependency. This is a modular monolith with independently scalable process types, not microservices and not a single all-in-one web process.

## 2. Approved technology direction

| Layer | Recommendation | Rationale |
|---|---|---|
| Web application | Next.js + React + TypeScript | Server-rendered public pages, shared types and strong ecosystem |
| Styling/UI | Tailwind CSS with Jurvio-owned design tokens/components | Fast implementation without surrendering design control |
| Runtime | Current supported Node.js LTS | Stable production support; pin and upgrade deliberately |
| Packaging | OCI/Docker containers | Portability across local, CI and cloud environments |
| Compute | DigitalOcean App Platform | Managed web services, workers, jobs, scaling and OS patching without Kubernetes |
| Canonical database | DigitalOcean Managed PostgreSQL | Managed backups, failover and simpler predictable operations |
| Object storage | Cloudflare R2 | S3-compatible storage with no ordinary internet-egress charge; suited to document delivery |
| Queue | PostgreSQL-backed durable job queue initially | Transactional outbox, leases, retries and DLQ behavior without another launch dependency |
| Search | DigitalOcean Managed OpenSearch | Managed implementation of the approved search architecture |
| Edge | Cloudflare DNS/CDN/WAF/rate limiting/bot controls | Performance, protection and verified-crawler policy |
| Email | Transactional email provider selected by benchmark | Keep provider behind an adapter; separate transactional and marketing consent |
| SMS | Deferred; provider adapter later | Costly and regulated; not required for initial alerts |
| Payments | Stripe Billing/Checkout/Customer Portal | Avoid storing card data and building billing UI |
| Infrastructure | Terraform | Reviewable, repeatable cloud configuration without console drift |
| CI/CD | GitHub Actions + DigitalOcean Container Registry/App Platform | Fits the repository and portable container architecture |

DigitalOcean App Platform supports container deployments, workers, jobs, scaling, patching, metrics and log forwarding ([App Platform](https://docs.digitalocean.com/products/app-platform/)). Cloudflare R2 exposes an S3-compatible API and does not charge ordinary internet egress ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)).

## 3. Runtime topology

```text
Internet and verified crawlers
        ↓
Cloudflare DNS / CDN / WAF / rate controls
        ↓
DigitalOcean App Platform
  ├─ web: Next.js public pages and account UI
  ├─ api: public/internal REST endpoints
  ├─ worker-ingest / normalize / enrich / index
  └─ scheduler/control process
        ↓
Managed PostgreSQL · Managed OpenSearch · Cloudflare R2
```

The initial implementation may package web and API from one codebase. Separate App Platform components/process commands allow scaling and security policies without creating separate product repositories.

## 4. Network architecture

- Separate DigitalOcean projects for production and non-production.
- Private VPC connectivity for application components, PostgreSQL and OpenSearch where supported.
- PostgreSQL and OpenSearch allow only required application and administrative paths.
- Cloudflare is the only intended public ingress for production web traffic; origin-bypass paths are restricted.
- Administrative access uses named, MFA-protected accounts and audited role-based access, never shared credentials.
- Dedicated egress IPs are added only for providers that require allowlisting.
- Terraform manages DigitalOcean and Cloudflare configuration to prevent console drift.
- Cross-provider traffic and egress are measured explicitly.

## 5. Database availability

- Development may use a smaller single-AZ database.
- Public beta production uses a high-availability DigitalOcean Managed PostgreSQL configuration.
- Enable encrypted automated backups and point-in-time recovery.
- Apply connection pooling; workers cannot open unbounded connections.
- Read replicas are introduced only after measured read pressure.
- Schema changes use backward-compatible expand/migrate/contract deployments.
- Search and analytics workloads do not run expensive scans against the canonical production database.


## 6. Object-storage architecture

Cloudflare R2 buckets are separated by purpose and environment:

- immutable source artifacts;
- processed text/layout/passages;
- public document delivery derivatives;
- private exports;
- analytics/event lake;
- backups and disaster-recovery exports.

Requirements:

- encryption by default;
- versioning where appropriate;
- object checksums and content-addressed keys;
- lifecycle transitions/expiration by rights and retention class;
- blocked public bucket access;
- signed or application-authorized URLs for restricted objects;
- CDN only for public-approved derivatives;
- access logs and policy-change auditing.

## 7. Queue and worker architecture

Start with a PostgreSQL-backed durable job system using the approved transactional outbox pattern. It uses explicit workload classes for acquisition, OCR, normalization, enrichment, indexing, invalidation, alerts and analytics.

Requirements:

- `FOR UPDATE SKIP LOCKED` or equivalent safe claims;
- leases, heartbeats and abandoned-job recovery;
- idempotency keys and at-least-once processing semantics;
- bounded retries, dead-letter tables, alarms and controlled redrive;
- separate concurrency and budget limits by workload;
- short operational retention so queue history does not become an analytics store;
- metrics for age, depth, throughput, failure and saturation.

Migrate behind the queue adapter to a managed queue when measured throughput, database contention or recovery needs justify it. Do not add Kafka, Kubernetes, Redis or a workflow orchestrator at launch.

## 8. OpenSearch deployment

- Use DigitalOcean Managed OpenSearch after workload and cost benchmarking.
- Restrict it through private networking and least-privilege credentials.
- Use encryption, least-privilege roles, audit logging and versioned aliases.
- Benchmark shard count, passage volume, facets, refresh interval and hybrid-search requirements.
- Maintain full rebuild capability from PostgreSQL/R2.
- Do not use the same cluster as the sole observability log store.


## 9. CDN and cache strategy

- Cloudflare caches anonymous public entity pages and public document assets.
- Cache key excludes tracking parameters and uncontrolled variants.
- Authentication/account/API responses are private/no-store unless explicitly safe.
- Canonical updates publish targeted purge/invalidation events.
- Serve stale public content briefly during origin failures only when policy permits.
- Display source freshness independently from CDN age.
- No Redis at launch unless measured workloads require distributed locks, hot data or cache behavior that existing services cannot provide.

## 10. Deployment architecture

### Environments

- local development;
- shared non-production/staging;
- production.

Production uses a separate DigitalOcean project and separate Cloudflare resources, secrets, data and identity configuration. No production data is copied into development without an approved sanitization process.

### Delivery pipeline

1. pull request checks;
2. dependency/security scan;
3. unit, integration, contract, accessibility and selected end-to-end tests;
4. reproducible container build with immutable digest/SBOM;
5. push to DigitalOcean Container Registry;
6. deploy database-compatible release to staging;
7. smoke/synthetic checks;
8. production deployment with health gates;
9. post-deploy verification and rollback readiness.

- Migrations are a separate controlled step.
- Application rollback never depends on reversing a destructive migration.
- Deploy by immutable image digest, not mutable tags.
- Infrastructure changes require plan review.
- Production promotion requires recorded approval until the team establishes a safe automated release policy.

## 11. Scaling strategy

- Scale public web tasks by request load and latency.
- Scale workers by queue age/depth and task cost.
- Isolate OCR/AI workers from latency-sensitive web services.
- Precompute public projections instead of joining the knowledge graph on every page view.
- Cache high-demand public pages at the edge.
- Add read replicas, table partitioning and specialized services only after measured bottlenecks.
- Preserve an escape path from App Platform to DigitalOcean Droplets, Hetzner batch compute or another OCI-compatible platform if compute economics require it.

## 12. Alternatives considered

| Alternative | Why not recommended now | Reconsider when |
|---|---|---|
| AWS | Broad and mature, but greater billing, networking and operational complexity than Jurvio needs at launch | Enterprise requirements or measured scale justify migration |
| Hetzner as primary platform | Excellent compute economics but would force more self-management or vendor fragmentation for PostgreSQL and OpenSearch | Stateless batch workloads dominate cost or the team can operate the data plane safely |
| Render/Railway | Strong developer experience but no first-party managed OpenSearch and less attractive document/search economics | Product scope remains much smaller than projected |
| Kubernetes | Too much operational surface for the initial team | Service count/team/platform needs justify it |
| Serverless functions for all processing | Poor fit for long document/OCR/enrichment jobs | Small event-driven endpoints only |
| Microservices | Premature contracts, deployment and distributed-data overhead | Clear team/domain/scaling boundaries emerge |

## 13. Gate 7A approved decisions

1. DigitalOcean is the primary application and managed-data cloud; Cloudflare is the public edge and object-storage layer.
2. Next.js/API/workers run as portable containers on DigitalOcean App Platform.
3. Use DigitalOcean Managed PostgreSQL, DigitalOcean Managed OpenSearch and Cloudflare R2.
4. Use a PostgreSQL-backed durable job queue initially behind a provider-neutral adapter.
5. Keep the modular monolith with independently scalable process types.
6. Use Terraform and GitHub Actions with immutable container deployments.
7. Do not adopt Kubernetes, Kafka, Redis or microservices until measured triggers exist.

