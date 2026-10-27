# ADR 0077: Accounts, Monitoring and Alerts (Milestone M4) — Implementation Architecture

**Status:** Accepted — approved by David Rosenberg on 2026-10-27 (phases A–E)
**Date:** 2026-10-27
**Milestone:** M4 "accounts and monitoring" (docs/29 §2)
**Depends on:** Gate 7.5 Monetization (docs/18), Gate 7B API/Auth/Subscriptions/Security (docs/16),
ADR 0005 (Monetization and Understanding Moat), Final PRD Package A (docs/26)

> This ADR exists to be approved *before* any production code is written for paid features,
> per AGENTS.md ("Application implementation begins only after the relevant architecture
> package is explicitly approved"). It turns the already-approved monetization *strategy* into
> a concrete, phased *build plan*. It introduces no code by itself.

---

## 1. Context

### 1.1 What is already decided (do not relitigate)

The monetization strategy is already approved and binding:

- **Free / paid boundary** (docs/18 §3, docs/26 §3): public reading, basic keyword search,
  limited follows and a weekly digest are **always free**. Paid value is *higher-frequency and
  immediate alerts, larger watch capacity, cross-entity monitoring, "what changed" intelligence,
  saved/advanced search, reports/exports, team workflow, and governed API/webhooks*.
- **First paid product** (docs/18 §4): *"Monitor any case, person, company, attorney, law firm,
  judge, policy or legal topic and receive a readable, sourced explanation whenever something
  important changes."* Every alert must say **what happened, why it matters, what changed, what
  remains unresolved, and what may happen next.** Raw docket-entry pings are explicitly *not*
  sufficient differentiation.
- **Pricing ladder to test** (docs/18 §2): Free · Plus $29/mo · Professional $99/mo ·
  Team $299/mo · one-time Litigation Report $19–49 · API/Enterprise later. Prices and limits are
  **configuration, not hard-coded policy.**
- **Authentication** (docs/16 §2): managed OIDC, **WorkOS AuthKit** as the leading candidate,
  with Jurvio owning authorization/entitlements.
- **Billing** (docs/16 §5): **Stripe** for checkout/subscription lifecycle; Jurvio keeps an
  internal, auditable **entitlement projection** built from verified webhooks; never provision
  access from a browser redirect.
- **Release gating** (docs/26 §8): paid Plus is tested **only after monitoring value is reliable**;
  Professional/Team/API/exports are General Availability, later.

### 1.2 Current state of the codebase (what exists today)

- **Only staff authentication exists.** `src/modules/identity/cloudflare-access` +
  `src/middleware.ts` gate an internal "command center" on `z.jurvio.com`; the public site 404s
  all private paths. There is **no public end-user account system**.
- **No watch / follow / saved-search / alert / notification / billing / entitlement** domain
  exists. All of M4's product surface is net-new.
- **The content and status foundation M4 depends on already exists:** the canonical case/entity
  model, the deterministic status engine (`src/modules/cases/domain/status.ts`), quality-gated
  publication, the ingestion outbox, and the federal corpus (hundreds of thousands of cases
  published and growing). This is the raw material alerts are built from.

### 1.3 The honest dependency: monitoring is only as good as freshness

A monitoring product's value is **timely, trustworthy change detection on the entities a user
watches.** That depends on two things that are still maturing:

1. **Corpus breadth** — in progress (federal backlog still draining).
2. **Ingestion freshness on watched entities** — we currently run *bulk snapshot* ingestion plus
   some incremental lanes. Monitoring needs *reliable, reasonably prompt* updates for watched
   cases/entities, not just a one-time bulk load.

**We can and should build M4 in parallel with finishing the corpus, but paid Plus should not
launch until change detection is demonstrably timely and correct** (consistent with docs/26 §8).
This ADR calls that out so revenue is sequenced honestly, not so it blocks building.

---

## 2. Decision — phased M4 build

Build M4 in five phases. Phases A–C deliver a **free** follow-to-digest workflow with *zero*
payment surface; D adds billing/entitlements; E adds the premium real-time + AI layer. Each phase
is independently shippable and testable, and maps to M4's exit criterion ("reliable
follow-to-notification workflow and measurable conversion").

### Phase A — Public identity and free accounts
- Integrate **WorkOS AuthKit** (OIDC) for *public* users, on the public host, **entirely separate
  from the staff Cloudflare-Access command center** (docs/16 §6: staff access separated from
  customer roles).
- Map each WorkOS user to an internal **Jurvio principal** id. Jurvio owns roles/entitlements
  (docs/16 §3). Email verification required; MFA available to users, required for staff (unchanged).
- Default every new account to the **free entitlement** (limited watches + weekly digest).
- Public reading and basic search **keep working with no account** — accounts only *add* capability.

### Phase B — Watches and change detection
- **Watch model:** a user can watch a `case`, `party`, `organization`, `attorney`, `law_firm`,
  `judge`, `court`, `nature_of_suit/topic`, or a **saved search**. One generic, typed watch table.
- **Change-event log:** derive a durable, append-only `change_event` stream from the existing
  ingestion **outbox** and deterministic **status transitions** (new opinion/order/judgment, status
  change, new docket entry of a watched type, new party/attorney, citation events). This is a
  *projection off data we already produce* — not a new scraper.
- **Readable, sourced change summary (deterministic first):** each change_event renders the
  required narrative (what happened / why it matters / what changed / unresolved / next) from the
  **existing deterministic status engine + templates**, with source links. AI narrative is deferred
  to Phase E and is additive, never the source of a status claim (docs/26 §5).

### Phase C — Delivery and preferences (free tier complete)
- Transactional **email delivery** with a daily/weekly **digest** of change_events across a user's
  watches; notification preferences (cadence, channel, per-watch mute).
- Free limits enforced as **configuration** (e.g. N watches, digest cadence). Abuse/rate controls
  on account creation and watch volume (docs/16 §6).
- **Exit of C = the free follow→digest loop works end to end.** This is the "monitoring value" the
  release gate requires us to prove *before* charging.

### Phase D — Billing and entitlements (turns on paid)
- **Stripe** subscriptions for Plus/Professional/Team. Flow is exactly docs/16 §5:
  `Stripe event → verified, idempotent webhook inbox → billing-state projection → entitlement
  computation → account/workspace access → audit + reconciliation`.
- **Never provision from a browser redirect;** verify webhook signatures; handle duplicate/
  out-of-order events; store Stripe customer/subscription/price IDs (never card data); grace policy
  on payment failure; scheduled Stripe↔Jurvio reconciliation.
- Entitlements gate **watch capacity, alert frequency (immediate vs digest), advanced search,
  exports** — all as config-driven limits, not hard-coded authorization.
- **Requires the Stripe connector to be authorized in claude.ai settings** before implementation.

### Phase E — Premium real-time + intelligence + teams
- **Immediate / high-frequency alerts** for paid tiers (near-real-time delivery off the
  change_event stream).
- **AI "what changed" narrative** layered on the deterministic summary, **within the approved
  $500/mo AI/OCR cap** (docs/29 §5): deterministic-first, cached by content hash, versioned, bounded
  context, cost ledger + budget breaker, no per-view generation.
- **Team workspaces/seats** (Team tier): shared watchlists, membership, workspace admin
  (docs/16 §3), RLS tenant isolation as defense in depth with cross-tenant tests.

---

## 3. Data model additions

New tables, kept **separate from the public legal-record tables** (docs/16 §8). Illustrative, not
final DDL:

| Table | Purpose |
|---|---|
| `account_principal` | internal user id ↔ WorkOS user id, email, status |
| `workspace`, `workspace_membership`, `role` | teams, seats, RBAC (docs/16 §3) |
| `entitlement` | computed plan → limits projection (config-driven) |
| `watch` | typed subscription to an entity or saved search |
| `saved_search` | stored query + cadence |
| `change_event` | append-only derived change stream (the alert source of truth) |
| `notification`, `notification_delivery` | rendered alerts + per-channel delivery/audit |
| `billing_customer`, `billing_subscription`, `webhook_inbox` | Stripe projection |
| `audit_event` | append-only audit (docs/16 §7) |

All mutations: authorization + validation + idempotency + audit (docs/16 §1 internal API rules).

---

## 4. Alternatives considered (per AGENTS.md)

| Decision | Chosen | Alternatives | Why chosen / trade-off |
|---|---|---|---|
| Public auth | **WorkOS AuthKit** | Auth0, Clerk, roll-our-own | Already the Gate 7B benchmark leader; orgs/SSO/SCIM path for Team/Enterprise; least session-security burden. Cost/lock-in risk → keep provider id mapped to internal principal for exit. |
| Billing | **Stripe + internal entitlements** | Paddle/LemonSqueezy (merchant-of-record, handles sales tax/VAT), manual invoicing | Stripe is the approved choice and most flexible; **cost:** we own tax handling. Reconsider toward a merchant-of-record if cross-border tax burden proves heavy. |
| Change detection | **Projection off ingestion outbox + status transitions** | Periodic snapshot-diff of each watched entity; per-watch polling of CourtListener | Reuses data we already emit; cheapest and most consistent. **Risk:** only as fresh as ingestion — the core dependency in §1.3. |
| Alert narrative | **Deterministic templates first, AI later (bounded)** | AI-generated from day one | Keeps AI subordinate to sources, inside the $500 cap, and avoids launch-blocking on AI quality. |
| Entitlement authority | **Jurvio-owned projection** | Stripe Entitlements as source of truth | Jurvio must own product access (docs/16 §5); Stripe stays billing authority only. |
| Email | **Transactional provider (e.g. Postmark/SES/Resend)** | Self-hosted SMTP | Deliverability + bounce/complaint handling; new but anticipated cost line (docs/29 §5). |

---

## 5. Consequences

**Benefits**
- Unlocks the approved **first revenue** product on top of the corpus we are already building.
- Builds the strategic "Litigation Change Intelligence and alert graph" crown jewel (docs/18 §7).
- Phases A–C ship real user value (free monitoring) with **no payment-security exposure** until D.

**Costs**
- New recurring line items: WorkOS, Stripe fees, email delivery, plus optional AI narrative within
  the existing $500 cap. Must stay inside the approved **$250/mo infra · $500/mo AI/OCR** envelope
  (docs/29 §5) and the "infra < 20% of recurring revenue" target (docs/18 §10).
- New security/privacy surface: customer PII, billing, tenant isolation → the full docs/16 §§6–9
  controls apply, and docs/29 §3 requires a **penetration test before paid/API launch**.

**Risks** (owners/controls tracked in the M4 risk register)
- Freshness insufficient to make alerts timely (§1.3) — *control:* gate paid launch on measured
  change-latency, keep free digest shipping meanwhile.
- Low willingness to pay — *control:* test Plus only after free monitoring proves engagement.
- Email deliverability/cost; notification fatigue/quality.
- Payment-webhook correctness (duplicate/out-of-order) — *control:* idempotent inbox + reconciliation.
- Tenant data leakage — *control:* deny-by-default + RLS + automated cross-tenant tests.

**Reconsideration triggers** (extending ADR 0005)
- Users will not pay for monitoring/change intelligence after a fair free-tier test.
- Change detection cannot be made timely/correct within the cost envelope.
- Billing/tax or email-compliance burden outweighs early revenue.
- A different workflow (e.g. reports, API) shows materially stronger retention/strategic value.

---

## 6. What this ADR does NOT authorize

- No General Availability; no Professional/Team/API/exports at first paid launch (docs/26 §8).
- No outcome prediction, ratings, or any payment-driven change to facts/rankings/explanations
  (docs/18 §3, docs/26 §4).
- No change to the **staff** auth boundary; staff and customer access stay separate.
- No AI spend beyond the approved $500/mo cap without a separate approval.

---

## 7. Testing and acceptance (mapped to M4 exit)

- Unit/property: entitlement + rate-limit logic, watch/change-event derivation, free-limit config.
- Contract: Stripe webhooks, notification delivery, OpenAPI for any new public endpoints (docs/29 §3).
- End-to-end: raw artifact → … → **change_event → notification → delivery**, plus privacy/sealing
  propagation into alerts (a sealed/privacy-held record must not surface via a watch).
- Nonfunctional: cross-tenant RBAC isolation; email deliverability; **penetration test before any
  paid launch** (docs/29 §3, docs/16 §9).
- **Launch gate:** free follow→digest reliable (Phase C) and change-latency measured **before**
  enabling Stripe/paid Plus.

---

## 8. Requested approval

> *"Approved ADR 0077. Begin M4 implementation in phase order A→B→C (free monitoring) first; D and E
> (billing and premium/AI/teams) proceed after the free monitoring loop is reliable and I have
> authorized the Stripe connector."*

**Approval recorded:** David Rosenberg approved phases A–E on 2026-10-27. Implementation is
authorized in phase order **A→B→C→D→E**. Two conditions from this ADR still hold: billing (Phase D)
cannot be wired until the **Stripe connector is authorized** in claude.ai settings, and **paid Plus
launch remains gated on demonstrated change-alert timeliness** (§1.3, §7) — building proceeds now,
charging follows proof. Material changes to this plan will be recorded as an amendment to this ADR.
