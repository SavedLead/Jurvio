-- Milestone M4, Phase A: public end-user accounts foundation (ADR 0077).
--
-- This is the first implementation increment of the approved accounts/monitoring/alerts
-- milestone. It introduces PUBLIC customer identity, kept deliberately SEPARATE from staff
-- identity (internal_user / internal_session, migrations 0008/0101) per Gate 7B §6 "staff access
-- separated from customer roles". Nothing here touches the public legal-record tables, and no
-- customer row can alter any case fact (docs/18 §3).
--
-- Authorization is Jurvio-owned (docs/16 §3): the identity provider (WorkOS AuthKit) proves who a
-- user is; plan/entitlements and roles live here. `plan` drives the config-based entitlement
-- limits in src/modules/accounts/domain/entitlements.ts -- limits are configuration, not policy,
-- so they can change without a migration.
--
-- Later M4 increments add watches + change_event (Phase B), notifications/delivery (Phase C) and
-- Stripe billing projection + entitlement overrides (Phase D) in their own migrations.

BEGIN;

CREATE TYPE account_plan AS ENUM ('free', 'plus', 'professional', 'team');
CREATE TYPE account_status AS ENUM ('active', 'suspended', 'closed');
CREATE TYPE workspace_role AS ENUM ('member', 'admin');

-- A public, self-service customer principal. Mapped 1:1 to a provider identity (WorkOS user id)
-- while keeping an internal id as the stable Jurvio principal (provider-independent, so the auth
-- provider can be migrated without rewriting ownership). Email is stored lower-cased by the app.
CREATE TABLE account_principal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'workos',
  provider_user_id text UNIQUE,
  email text NOT NULL UNIQUE,
  display_name text,
  plan account_plan NOT NULL DEFAULT 'free',
  status account_status NOT NULL DEFAULT 'active',
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_authenticated_at timestamptz
);

-- App-owned session, mirroring internal_session so session handling is consistent across the
-- staff and customer surfaces. The raw token is never stored; only its SHA-256 hash.
CREATE TABLE account_session (
  token_hash text PRIMARY KEY,
  principal_id uuid NOT NULL REFERENCES account_principal(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX account_session_principal_idx ON account_session (principal_id);
CREATE INDEX account_session_expiry_idx ON account_session (expires_at);

-- Workspaces back the Team tier (shared watchlists, seats, administration). An individual
-- Free/Plus/Professional account needs no workspace; one is created when a user upgrades to Team.
CREATE TABLE workspace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan account_plan NOT NULL DEFAULT 'team',
  owner_principal_id uuid NOT NULL REFERENCES account_principal(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_membership (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES account_principal(id) ON DELETE CASCADE,
  role workspace_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, principal_id)
);

CREATE INDEX workspace_membership_principal_idx ON workspace_membership (principal_id);

-- Append-only audit of account/entitlement/billing-affecting actions (Gate 7B §7). Product
-- analytics is not the audit log; this is the audit log.
CREATE TABLE account_audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_principal_id uuid REFERENCES account_principal(id),
  action text NOT NULL,
  target_type text,
  target_id uuid,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX account_audit_actor_date_idx
  ON account_audit_event (actor_principal_id, occurred_at DESC);

COMMIT;
