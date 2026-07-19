# Jurvio Gate 7B: API, Authentication, Subscriptions, and Security

**Status:** Approved  
**Date:** 2026-07-19  
**Depends on:** Gate 7A platform architecture

## 1. API design

### Public entity API

- Base: `/api/v1`.
- Resource-oriented JSON for cases, decisions, documents, parties, organizations, professionals, courts, authorities and topics.
- Opaque Jurvio IDs and canonical URLs.
- Cursor pagination, explicit sorting and documented filters.
- Stable error envelope and request ID.
- `ETag`/conditional responses where useful.
- Source, update, coverage, evidence and publication fields.
- Sparse fieldsets/expansions only for approved bounded relationships.
- No provider-specific schema leakage.

Machine-readable entity endpoints support public discovery but are not an unlimited free bulk-export API. Anonymous and authenticated usage receive separate rate/field limits.

### Internal API

Internal administrative and worker operations use separately authenticated routes/services, never hidden public endpoints protected only by obscurity. Mutation endpoints require authorization, validation, idempotency and audit events.

### Webhooks and future customer API

- Signed webhook payloads with timestamp/replay protection.
- At-least-once delivery and unique event IDs.
- Customer endpoint verification, retry policy, DLQ and delivery history.
- API keys are shown once, stored hashed, scoped, named, expirable and revocable.
- OAuth/client-credential support is added for enterprise integrations when needed.
- OpenAPI is the contract for external APIs; SDKs follow demonstrated demand.

## 2. Authentication decision

Use a managed OIDC identity provider. Recommend WorkOS AuthKit as the initial choice, subject to a procurement/security/exit benchmark against Auth0, Clerk and Amazon Cognito before implementation.

Reasons:

- consumer authentication now;
- organizations, SSO, SCIM and enterprise policies later;
- reduced password/session security burden;
- standards-based integration and a practical migration boundary.

WorkOS documents organization policies, SSO/SCIM and role capabilities; Jurvio still owns authorization and entitlements ([WorkOS organization policies](https://workos.com/docs/authkit/organization-policies), [roles and permissions](https://workos.com/docs/authkit/roles-and-permissions)).

Requirements:

- email verification;
- secure hosted or provider-managed login;
- passkeys/social login may be enabled after UX/security review;
- MFA required for staff/admins and available for users;
- enterprise SSO/SCIM in future tiers;
- short sessions and step-up authentication for sensitive actions;
- provider user ID mapped to internal Jurvio principal ID;
- account recovery and email-change events audited;
- emergency provider migration/export procedure.

## 3. Authorization model

Authentication proves identity; Jurvio decides access.

Core objects:

- principal/user;
- organization/workspace;
- membership;
- role;
- permission;
- plan/entitlement;
- resource ownership/scope;
- policy decision and audit event.

Initial roles:

- anonymous;
- registered user;
- workspace member;
- workspace admin;
- Jurvio reviewer;
- Jurvio support;
- Jurvio administrator;
- service account.

Rules:

- deny by default;
- server-side checks on every protected operation;
- staff access separated from customer roles;
- support impersonation only if later built with user-visible/audited controls;
- highly privileged operations require MFA and reason capture;
- database credentials never encode end-user authorization as the sole control;
- tenant tables may add RLS as defense in depth, with automated cross-tenant tests.

## 4. Free-first account model

Public reading and basic search require no account. A free account later unlocks limited saves/watches and digests.

Suggested entitlement progression:

| Capability | Anonymous | Free account | Future paid | Enterprise/API |
|---|---:|---:|---:|---:|
| Core case/entity reading | Yes | Yes | Yes | Yes |
| Basic search | Yes, limited abuse controls | Yes | Yes | Yes |
| Save/watch | No | Limited | Expanded | Team-wide |
| Digest alerts | No | Limited | Configurable | Configurable |
| Immediate alerts | No | No | Yes | Yes |
| Advanced/Boolean search | No | Limited/preview | Yes | Yes |
| Exports | No | No | Limited | Bulk governed |
| AI research | No/preview | Limited later | Usage allowance | Contracted |
| API/webhooks | Public entity limits | No | Add-on later | Contracted |

Exact limits and pricing remain product configuration, not hard-coded authorization logic.

## 5. Subscription and entitlement architecture

Stripe handles checkout, payment methods, invoices, subscription lifecycle and customer self-service. Jurvio maintains an internal, auditable entitlement projection.

```text
Stripe event
  → verified/idempotent webhook inbox
  → billing state projection
  → entitlement computation
  → account/workspace access
  → audit + reconciliation
```

- Never provision solely from a browser redirect.
- Verify Stripe webhook signatures and process duplicate/out-of-order events safely.
- Store Stripe customer/subscription/product/price IDs, not card details.
- Use a grace policy for payment failures rather than instant destructive revocation.
- Reconcile Stripe and Jurvio subscription state on a schedule.
- Keep historical entitlement/audit records.
- Coupons, trials, grandfathering and enterprise overrides are explicit records.
- Stripe is billing authority; Jurvio is product-access authority.

Stripe recommends webhook-based handling for subscription/payment state changes and supports active entitlements tied to subscriptions ([subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [subscription overview](https://docs.stripe.com/billing/subscriptions/overview)).

## 6. Security architecture

### Identity and access

- DigitalOcean Teams and Cloudflare role-based access with mandatory staff MFA.
- No shared accounts, shared API tokens or long-lived human credentials.
- Least-privilege application credentials per process type.
- Separate production and non-production projects, resources and identities.
- Quarterly access reviews and immediate offboarding.

### Secrets and encryption

- DigitalOcean App Platform encrypted secrets plus narrowly scoped Cloudflare and database credentials; no secrets in GitHub, images or logs.
- Provider-managed encryption for Managed PostgreSQL, Managed OpenSearch, R2, backups and sensitive exports.
- TLS externally and internally where service support provides it.
- Key rotation and break-glass procedures.

### Application security

- Secure cookies, CSRF protection and strict session validation.
- Parameterized database access and output encoding.
- Content Security Policy and safe document rendering.
- File type/size validation and malware scanning before processing.
- Retrieved legal/web content is untrusted data and cannot issue model/tool instructions.
- Dependency, container and IaC scanning.
- SBOM and signed/provenance-aware release artifacts where supported.
- Security headers and controlled CORS.

### Edge/API protection

- Cloudflare managed WAF and bot controls.
- Rate limits by route, identity, API key and behavior.
- Preserve access for verified approved search/AI crawlers.
- Do not globally allow an IP in a way that bypasses all WAF controls.
- Quotas and complexity limits for search, exports and AI.
- Abuse detection for enumeration, scraping, credential stuffing and correction-form spam.

Cloudflare warns that rate-limiting verified bots can harm discovery, so crawler-aware policy must be tested rather than applied indiscriminately ([Cloudflare rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/)).

## 7. Audit logging

Audit:

- login/MFA/recovery and identity-provider changes;
- role, membership and entitlement changes;
- API key creation/revocation;
- staff access and administrative reads of sensitive material;
- publication holds, corrections, identity decisions and source overrides;
- billing overrides/refunds/credits affecting access;
- secrets/infrastructure/policy changes;
- export creation/download;
- AI prompt/model/policy publication changes.

Audit records are append-only, access-controlled, timestamped and correlated with actor, request and reason. Product analytics is not the audit log.

## 8. Privacy and data lifecycle

- Maintain a data inventory by source, purpose, rights and sensitivity.
- Minimize account/profile collection.
- Separate public legal records from customer account/workspace data.
- Define retention/deletion for sessions, analytics, support, exports and AI inputs.
- Protect search queries because they may contain sensitive names/facts.
- Provide account deletion/export workflows consistent with legal obligations.
- Legal holds override ordinary deletion only through documented policy.
- No sale or cross-company use of customer behavior without an explicit lawful policy.
- Outside counsel reviews public-record, privacy, minors, sealed/expunged and state-law policies before launch.

## 9. Security release criteria

Before public beta:

1. threat model and data-flow review completed;
2. staff MFA and least privilege enforced;
3. secrets and production accounts separated;
4. dependency/container/IaC scans in CI;
5. WAF/rate limits tested without blocking approved crawlers;
6. backup restoration exercised;
7. cross-tenant authorization tests pass;
8. publication holds and correction controls tested;
9. incident response and contact tree documented;
10. independent penetration test or scoped expert review completed before paid/API expansion.

## 10. Gate 7B approved decisions

1. Use REST/JSON `/api/v1`, OpenAPI contracts and cursor pagination.
2. Use managed OIDC authentication, with WorkOS AuthKit as the benchmark-leading candidate.
3. Jurvio owns roles, permissions and entitlements rather than delegating authorization solely to a provider.
4. Preserve free public reading and configurable future feature entitlements.
5. Use Stripe for billing with an internal webhook-derived entitlement projection.
6. Apply the security, privacy and audit boundaries described above.

