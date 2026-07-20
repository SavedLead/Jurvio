# Low-Cost Staging Deployment Runbook

This runbook prepares Jurvio for staging without publishing legal records or creating infrastructure automatically.

## Recommended launch shape

Start with one small DigitalOcean Droplet for the web container and PostgreSQL, protected by Cloudflare. This is the lowest-cost sensible staging configuration. It is intentionally temporary: before meaningful public traffic, move PostgreSQL to a managed database or a dedicated host.

Do not introduce Kubernetes, multiple application services, OpenSearch, Redis, or a paid vector database at this stage. PostgreSQL remains canonical and is sufficient for the first controlled corpus.

## Required controls

- Cloudflare proxies all public traffic.
- Cloudflare Access protects `/internal/*`.
- SSH accepts keys only; password login and direct root login are disabled.
- PostgreSQL is never exposed publicly.
- The application runs as a non-root container user.
- Secrets live only in the host's protected environment file or secrets manager.
- The deployment runs migrations as a separate, explicit release step.
- Daily encrypted off-host database backups are mandatory.

## Release sequence

1. Build the exact Git commit with `docker build`.
2. Run CI and require all checks to pass.
3. Back up the database and verify that the backup is non-empty.
4. Run `pnpm db:migrate` once from a controlled release container.
5. Start the new web container.
6. Confirm `/api/health` returns HTTP 200.
7. Confirm `/api/ready` returns HTTP 200 and can reach PostgreSQL.
8. Confirm `/internal/publication` requires Cloudflare authentication.
9. Confirm no draft case is reachable through a public route.
10. Retain the previous image for immediate rollback.

## Health semantics

- `/api/health` is a liveness check. It proves the web process can respond.
- `/api/ready` is a readiness check. It proves the web process can reach PostgreSQL.

Neither endpoint exposes credentials, database details, build identifiers, or legal-record counts.

## Backup policy

- Create a compressed, encrypted PostgreSQL dump every day.
- Store it off the Droplet in a separate account or object-storage boundary.
- Retain daily backups for 14 days and monthly backups for 12 months during the early stage.
- Test a restore at least monthly. A backup is not considered valid until a restore test succeeds.
- Record backup and restore results in the operational audit log.

## Rollback

Application rollback uses the previous immutable container image. Database migrations must be additive and backward compatible; never depend on an automatic destructive down migration. If a release fails readiness, restore the previous image and investigate before retrying.

## Cost gates

Scale only when observed demand justifies it:

1. Move PostgreSQL to managed hosting when availability, corpus size, or revenue warrants it.
2. Add a separate worker host when ingestion competes with page-serving resources.
3. Add object storage when raw artifacts outgrow the local encrypted volume.
4. Add OpenSearch only after PostgreSQL search has measurable relevance or latency limitations.
5. Add paid AI capacity only for requested or demand-prioritized enrichment.

## Live-deployment boundary

Creating the Droplet, DNS records, Cloudflare policies, backup destination, or production secrets changes external systems and may create costs. Complete those steps only after the account owner supplies access and approves the specific monthly budget.
