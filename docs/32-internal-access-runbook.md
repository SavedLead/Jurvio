# Internal Access Runbook

Jurvio's internal publication console is protected by two independent controls:

1. Cloudflare Access authenticates an approved email address before the request reaches Jurvio.
2. Jurvio's `internal_user` table authorizes that identity as a viewer, reviewer, or administrator.

There are no application passwords to store or reset.

## 1. Apply the database migration

Set `DATABASE_URL`, then run:

```bash
pnpm db:migrate
```

Migration `0008_internal_access.sql` creates the role, user, and audit tables.

## 2. Create the first administrator

Use the same email address that will authenticate through Cloudflare Access:

```bash
pnpm internal:user owner@example.com administrator
```

The command validates the email and role, then safely creates or reactivates the account. Use `reviewer` for people who may decide publication reviews and `viewer` for read-only access.

## 3. Configure Cloudflare Access

In Cloudflare Zero Trust:

1. Add a self-hosted Access application for the deployed Jurvio hostname.
2. Protect the path `/internal/*`.
3. Add an allow policy containing only approved identities or an approved identity-provider group.
4. Copy the application audience tag (`AUD`).
5. Copy the team domain, such as `https://example.cloudflareaccess.com`.

Set these runtime variables on the Jurvio application:

```text
CF_ACCESS_TEAM_DOMAIN=https://example.cloudflareaccess.com
CF_ACCESS_AUDIENCE=<application-audience-tag>
```

Restart the application after changing runtime variables.

## 4. Verify access

1. Visit `/internal/publication` in a private browser window.
2. Confirm Cloudflare requires authentication.
3. Confirm an allowed, active viewer sees the queue but no decision controls.
4. Confirm a reviewer or administrator can record a review decision.
5. Confirm an unlisted or inactive email receives no console content.
6. Confirm the decision created an `internal_audit_event` record.

## Security rules

- Never bypass Cloudflare Access for `/internal/*` in production.
- Never grant access solely through a Cloudflare allow policy; the Jurvio role is also required.
- Grant the least-privileged role and deactivate departed users immediately.
- Review `internal_audit_event` regularly and retain it as an append-only operational record.
- Do not expose database credentials, Cloudflare secrets, or tokens in GitHub, logs, or support messages.

Cloudflare's JWT is validated server-side for signature, issuer, audience, and algorithm before Jurvio trusts the email claim.
