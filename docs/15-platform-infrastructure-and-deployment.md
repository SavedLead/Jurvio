# Jurvio Gate 7A: Platform, Infrastructure, and Deployment Architecture

**Status:** Decision draft  
**Date:** 2026-07-19  
**Depends on:** Approved Gates 1–6

## 1. Decision summary

Use AWS as Jurvio's primary cloud and Cloudflare as its public edge. Run the application and workers as portable containers on Amazon ECS with Fargate. Use managed AWS data services for PostgreSQL, object storage, queues and OpenSearch.

This is a modular monolith with independently scalable process types, not microservices and not a single all-in-one web process.

## 2. Approved technology direction

| Layer | Recommendation | Rationale |
|---|---|---|
| Web application | Next.js + React + TypeScript | Server-rendered public pages, shared types and strong ecosystem |
| Styling/UI | Tailwind CSS with Jurvio-owned design tokens/components | Fast implementation without surrendering design control |
| Runtime | Current supported Node.js LTS | Stable production support; pin and upgrade deliberately |
| Packaging | OCI/Docker containers | Portability across local, CI and cloud environments |
| Compute | Amazon ECS on Fargate | Scalable containers without Kubernetes/EC2 cluster management |
| Canonical database | Amazon RDS for PostgreSQL | Managed backups, failover and operational maturity |
| Object storage | Amazon S3 | Raw artifacts, PDFs, extracted text, exports and analytics events |
| Queue | Amazon SQS + dead-letter queues | Durable at-least-once work delivery and simple operations |
| Search | Amazon OpenSearch Service | Managed implementation of the approved search architecture |
| Edge | Cloudflare DNS/CDN/WAF/rate limiting/bot controls | Performance, protection and verified-crawler policy |
| Email | Transactional email provider selected by benchmark | Keep provider behind an adapter; separate transactional and marketing consent |
| SMS | Deferred; provider adapter later | Costly and regulated; not required for initial alerts |
| Payments | Stripe Billing/Checkout/Customer Portal | Avoid storing card data and building billing UI |
| Infrastructure | Terraform | Reviewable, repeatable cloud configuration without console drift |
| CI/CD | GitHub Actions + Amazon ECR/ECS deployment | Fits the repository and container architecture |

AWS documents Fargate as running ECS containers without managing EC2 servers or clusters ([AWS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)).

## 3. Runtime topology

```text
Internet and verified crawlers
        ↓
Cloudflare DNS / CDN / WAF / rate controls
        ↓
AWS Application Load Balancer
        ↓
ECS Fargate services
  ├─ web: Next.js public pages and account UI
  ├─ api: public/internal REST endpoints
  ├─ worker-ingest
  ├─ worker-normalize
  ├─ worker-enrich
  ├─ worker-index
  └─ scheduler/control process
        ↓
RDS PostgreSQL · S3 · SQS · OpenSearch
```

The initial implementation may package web and API from one codebase. Separate ECS services/process commands allow scaling and security policies without creating separate product repositories.

## 4. Network architecture

- One AWS organization with separate production and non-production accounts.
- VPC per environment across at least two Availability Zones.
- Public subnets contain only load balancers/NAT where necessary.
- ECS tasks, RDS and OpenSearch use private subnets.
- RDS and OpenSearch have no public endpoint.
- Security groups allow only required service-to-service paths.
- Use VPC endpoints for high-volume AWS services when cost/traffic supports them.
- Administrative access uses audited identity-aware AWS access, not shared SSH keys or bastion passwords.

## 5. Database availability

- Development may use a smaller single-AZ database.
- Public beta production uses RDS PostgreSQL Multi-AZ.
- Enable encrypted automated backups and point-in-time recovery.
- Apply connection pooling; workers cannot open unbounded connections.
- Read replicas are introduced only after measured read pressure.
- Schema changes use backward-compatible expand/migrate/contract deployments.
- Search and analytics workloads do not run expensive scans against the canonical production database.

AWS Multi-AZ provides standby/failover options, while some configurations can also serve read traffic ([RDS Multi-AZ](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html)).

## 6. Object-storage architecture

S3 buckets are separated by purpose and environment:

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

Use SQS queues by workload class rather than one global queue:

- acquisition;
- parsing/OCR;
- normalization/resolution;
- AI enrichment;
- search projection;
- sitemap/cache invalidation;
- alerts/notifications;
- analytics processing.

Each queue has idempotent consumers, visibility-timeout/heartbeat policy, bounded retries, DLQ, alarm and controlled redrive. AWS recommends DLQs to isolate messages that repeatedly fail processing ([SQS dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)).

Do not add Kafka, Kubernetes, a service mesh or workflow orchestrator at launch. Reconsider a workflow engine only when multi-day dependencies and manual recovery become operationally costly.

## 8. OpenSearch deployment

- Use a managed OpenSearch domain or Serverless collection after workload/cost benchmarking.
- Keep it inside private network controls.
- Use encryption, least-privilege roles, audit logging and versioned aliases.
- Benchmark shard count, passage volume, facets, refresh interval and hybrid-search requirements.
- Maintain full rebuild capability from PostgreSQL/S3.
- Do not use the same cluster as the sole observability log store.

Amazon OpenSearch Service is managed for deployment, operation and scaling; AWS still recommends continuous workload-specific testing and tuning ([service overview](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html), [operational guidance](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp.html)).

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

Production uses a separate AWS account, secrets, data and identity configuration. No production data is copied into development without an approved sanitization process.

### Delivery pipeline

1. pull request checks;
2. dependency/security scan;
3. unit, integration, contract, accessibility and selected end-to-end tests;
4. reproducible container build with immutable digest/SBOM;
5. push to ECR;
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
- Preserve an escape path from Fargate to ECS on EC2 or another container platform if compute economics require it.

## 12. Alternatives considered

| Alternative | Why not recommended now | Reconsider when |
|---|---|---|
| Vercel web + multiple backend clouds | Excellent developer experience but splits operations, networking and cost controls | Benchmark shows large delivery advantage without harmful fragmentation |
| Kubernetes/EKS | Too much operational surface for the initial team | Service count/team/platform needs justify it |
| Serverless functions for all processing | Poor fit for long document/OCR/enrichment jobs and connection control | Small event-driven endpoints only |
| Self-managed EC2 | More patching/capacity work | Sustained Fargate cost makes EC2 clearly cheaper |
| Supabase as production platform | Useful product, but Jurvio's scale/security architecture benefits from one AWS foundation | Reassess for noncritical internal tools |
| Microservices | Premature contracts, deployment and distributed-data overhead | Clear team/domain/scaling boundaries emerge |

## 13. Gate 7A decisions requested

1. Approve AWS as primary cloud and Cloudflare as public edge.
2. Approve containerized Next.js/API/workers on ECS Fargate.
3. Approve RDS PostgreSQL, S3, SQS and managed OpenSearch.
4. Approve modular-monolith codebase with independently scalable process types.
5. Approve Terraform and GitHub Actions with immutable container deployments.
6. Approve no Kubernetes, Kafka, Redis or microservices until measured triggers exist.

