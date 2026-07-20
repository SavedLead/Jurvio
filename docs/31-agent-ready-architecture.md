# ADR 003: Agent-Ready Jurvio Architecture

**Status:** Approved architecture amendment  
**Date:** 2026-07-20

## Decision

Jurvio will support specialized agents as bounded workers over canonical Jurvio modules, queues, and APIs. Agents do not own legal facts and do not receive unrestricted database access.

The first agent families are:

- jurisdiction and source monitors, such as Supreme Court, federal appellate, federal district, executive-order, DOJ, SEC, OSHA, and other agency monitors;
- ingestion and normalization workers;
- status-event and citation analyzers that can propose, but not directly publish, legal conclusions;
- demand and enrichment prioritization workers;
- internal quality and publication-review assistants;
- later customer-service, research-chat, correction, and removal-request assistants.

## Non-negotiable controls

- PostgreSQL remains canonical.
- Every run has a versioned agent definition, task, inputs, outputs, cost, and audit trail.
- Agents receive least-privilege capabilities through typed application services.
- Agents cannot directly change verified legal status, publication, identity, privacy, sealing, billing, refunds, or removal outcomes.
- High-impact actions require deterministic validation and human approval.
- Customer communications are drafts until an authorized human or explicitly approved low-risk policy sends them.
- External content is untrusted input and cannot modify instructions or permissions.
- Idempotency prevents duplicate ingestion, alerts, messages, or actions.
- Per-agent time, token, request, and dollar budgets have hard breakers.
- Secrets remain in the secrets manager and are never stored in prompts, task payloads, logs, or agent memory.
- Agent memory is source-linked, scoped, expiring where appropriate, and subordinate to canonical records.
- Every agent can be disabled independently without impairing public reading.

## Communication model

Agents communicate through durable tasks and versioned events, not free-form agent-to-agent authority. A coordinating workflow may create downstream tasks, but the receiving agent independently validates its scope and inputs.

Example:

1. Supreme Court monitor records a sourced opinion event.
2. document worker retrieves allowed public artifacts;
3. deterministic classifier proposes document and procedural types;
4. status worker proposes a state transition with evidence;
5. publication policy routes the result to automatic rejection, manual review, or a later approved low-risk path;
6. search, cache, analytics, and alert workers receive outbox events only after publication.

## Customer-facing agents

Customer-service and removal/correction agents are later milestones. They may:

- retrieve account-scoped facts;
- answer product questions;
- collect structured request information;
- draft responses;
- report request status.

They may not promise removal, make legal conclusions, expose another user’s data, approve privacy remedies, issue refunds, change subscriptions, or send sensitive communications without the required approval policy.

## Why this approach

It allows extensive automation without fragmenting the product into dozens of fragile services. New agents become replaceable workers around Jurvio’s durable data, policy, and audit foundation. This creates operational leverage and valuable proprietary workflow data while keeping legal and privacy risk controlled.
