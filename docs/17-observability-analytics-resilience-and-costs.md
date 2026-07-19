# Jurvio Gate 7C: Observability, Analytics, Resilience, and Cost Operations

**Status:** Decision draft  
**Date:** 2026-07-19  
**Depends on:** Approved Demand Intelligence and Gate 7A–7B

## 1. Observability decision

Instrument Jurvio with OpenTelemetry so traces, metrics and logs remain portable. Use AWS CloudWatch/X-Ray-compatible services initially, with Sentry or another focused error tool only if its measured workflow value justifies the added vendor.

OpenTelemetry is a vendor-neutral framework for traces, metrics and logs, which preserves backend choice ([OpenTelemetry documentation](https://opentelemetry.io/docs/what-is-opentelemetry/)).

## 2. Required signals

### Public web/API

- request rate, status and latency by route/template;
- cache hit/miss, origin load and edge status;
- crawler/platform classification;
- search and API quota/rate-limit outcomes;
- Core Web Vitals/synthetic availability;
- source-document delivery errors.

### Data pipeline

- queue age/depth, throughput, retry and DLQ count;
- provider freshness/checkpoint lag;
- parse/OCR/normalization/enrichment/index success;
- duplicate/conflict/hold rates;
- canonical-to-search projection lag;
- sitemap and cache invalidation lag.

### AI/search

- task/model/prompt/schema version;
- cost, tokens, cache use, latency and failure;
- validation/review/publication outcome;
- search p50/p95, zero results and relevance metrics;
- summary correction and unsupported-claim rates.

### Business/product

- Demand Intelligence event and recommendation metrics;
- saves, watches, alerts, retention and conversion;
- billing/entitlement webhook lag and reconciliation differences;
- cost per useful page, summary, returning user and alert.

## 3. Logging rules

- Structured JSON logs with timestamp, environment, service, severity, trace/request/job/entity IDs and safe error code.
- Never log passwords, tokens, session cookies, payment details or full sensitive documents.
- Search queries, source URLs and model prompts/responses use explicit redaction and restricted sampling/retention.
- Correlate logs, traces and metrics through OpenTelemetry context.
- Separate security/audit, application, access and product-analytics streams.
- Production debug logging is time-bounded and approval-controlled.

## 4. Service objectives

Initial internal targets, not public promises:

| Capability | Target |
|---|---:|
| Cached public pages monthly availability | 99.9% |
| Public API/web p95, excluding heavy search/document work | < 750 ms at origin target |
| Exact identifier search p95 | < 500 ms target |
| General search p95 | < 1.5 s target |
| High-priority source freshness | Gate 2 targets |
| Publication hold propagation | Urgent, monitored minutes-level target |
| Search projection lag | < 5 minutes normal target |
| Billing entitlement propagation | < 5 minutes normal target |

Set error budgets and revise targets using measured beta performance. Public cached availability is distinct from ingestion freshness.

## 5. Alerting

Page immediately for:

- widespread public outage;
- database failover/exhaustion or data-integrity risk;
- security incident or credential exposure;
- publication hold/correction failure;
- critical provider spend circuit-breaker breach;
- billing/access system failure causing broad incorrect entitlement;
- irrecoverable queue/index corruption.

Ticket/working-hours alerts for isolated jobs, ordinary DLQ growth, individual provider lag and noncritical SEO drift. Alerts require owner, runbook, severity, deduplication and post-incident follow-up.

## 6. Demand Intelligence analytics implementation

### Initial architecture

```text
Server/edge/search/API events
  → validated event collector
  → durable queue/buffer
  → encrypted S3 event lake (partitioned, columnar)
  → scheduled SQL/Athena analysis
  → small aggregate/recommendation tables
  → internal dashboards and weekly recommendations
```

- Do not put unlimited raw clickstream rows in the canonical PostgreSQL tables.
- Server-side events are authoritative for page/API/search outcomes.
- Minimal client events cover interactions unavailable server-side.
- Canonical entity IDs enable analysis by court, state, case type, topic, party and professional.
- Verified-crawler registry classifies machine demand.
- Search Console, Bing Webmaster, referrals and approved external voice-of-customer sources join through source-specific adapters.
- AI clustering summarizes demand only after evidence volume supports it.

### Reconsideration trigger

Adopt ClickHouse Cloud, a product-analytics platform or another warehouse when event volume, interactive analysis or team needs make S3/Athena/aggregates operationally inadequate. Procurement must preserve raw first-party export and metric ownership.

## 7. Backup and recovery

- RDS Multi-AZ plus encrypted automated backups and point-in-time recovery.
- Scheduled snapshots and policy-driven cross-region copy/export.
- S3 versioning/lifecycle and replication for irreplaceable approved artifacts as required.
- Terraform and deployment configuration in version control.
- OpenSearch is rebuilt from canonical data; snapshots may shorten recovery but are not sole backup.
- Queue/event idempotency enables replay.
- Auth/billing provider configurations are documented/exported where supported.
- Restoration tests occur at least quarterly before launch maturity.

Initial recovery objectives:

| Asset | RPO | RTO |
|---|---:|---:|
| Canonical PostgreSQL | ≤ 15 minutes target | ≤ 4 hours target |
| Immutable source artifacts | Near-zero for durably acknowledged ingestion | ≤ 8 hours target |
| Public search index | Rebuildable | Degraded exact navigation quickly; full recovery ≤ 24 hours target |
| Account/billing projection | Replay/reconcile from provider events | ≤ 4 hours target |
| Analytics events | ≤ 24 hours initially | ≤ 48 hours target |

These are internal design targets and require restoration tests before being treated as commitments.

## 8. Incident management

- Severity definitions and one incident commander.
- Security/privacy, publication/legal and availability incidents have distinct escalation paths.
- Preserve evidence and timeline.
- User/status communication templates exist before launch.
- Blameless postmortem for material incidents.
- Track remediation to completion.
- Maintain a public status page when beta usage warrants it.

## 9. Cost controls

Tag and allocate costs by environment, service and workload. Maintain dashboards for:

- RDS storage/IO/compute;
- Fargate CPU/memory/task hours;
- OpenSearch capacity/storage;
- S3 storage, requests and egress;
- Cloudflare/CDN traffic;
- SQS requests/queue age;
- OCR, AI and embeddings;
- email/SMS;
- source/PACER/licensing;
- observability and analytics.

Controls:

- budgets and anomaly alerts;
- per-task/provider circuit breakers;
- non-production schedules and retention limits;
- S3 lifecycle policies;
- CDN caching and compressed derivatives;
- autoscaling minimum/maximum bounds;
- cost-per-entity and cost-per-engaged-page reporting;
- quarterly reserved-capacity/Savings Plans review after stable baselines;
- no automatic expensive acquisition/enrichment based only on bot traffic.

## 10. Initial cost envelope

Before measured sizing, maintain the previously approved directional target of approximately **$1,000–$5,000 per month** for early production infrastructure excluding payroll, legal review, major licensing/PACER acquisition and exceptional OCR/AI campaigns.

The lower end may require single-AZ/non-production compromises and careful OpenSearch sizing; public-beta production Multi-AZ, managed search and growing document traffic will move toward or beyond the upper end. A pre-build load/storage model must replace this directional range before procurement.

## 11. Gate 7C decisions requested

1. Approve OpenTelemetry with an initially AWS-centered observability backend.
2. Approve separate audit, application, security and product-analytics streams.
3. Approve S3/columnar event lake + SQL aggregates as the first Demand Intelligence implementation.
4. Approve internal SLOs, runbooks, severity rules and restoration testing.
5. Approve the initial RPO/RTO targets as design goals subject to testing.
6. Approve cost allocation, budgets, anomaly detection and workload circuit breakers.

