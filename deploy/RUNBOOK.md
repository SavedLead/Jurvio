# Jurvio Federal Ingestion — Production Runbook

Operational reference for running Jurvio's always-on federal court ingestion
platform on its own servers. All routine operations run through the self-hosted
GitHub Actions builder over the private VPC — no direct console access required.

## Topology

| Host | Role | Reached by |
|---|---|---|
| `jurvio-web-01` (VPC `10.116.0.2`) | Ingestion + PostgreSQL + raw artifacts. Runs `postgres`, `app`, `worker-core`, `worker-coa`, `worker-entities`, `worker-supervisor` via `docker-compose.production.yml` in `/opt/jurvio`. | self-hosted builder → `DO_USER@10.116.0.2` (private VPC), `sudo -n docker` |
| `jurvio-public-01` | Isolated public Next.js (`docker-compose.public.yml`); artifacts read-only over NFS; DB over VPC. Sitewide `noindex`; `JURVIO_PUBLIC_LAUNCH` disabled. | `deploy-public-web.yml` |
| `jurvio-builder-01` | Self-hosted Actions runner + SSH bastion for the VPC. | GitHub Actions (`[self-hosted, jurvio, builder, trusted]`) |

Raw evidence: DigitalOcean Spaces bucket `jurvio-raw-evidence` (`nyc3`), immutable,
content-addressed. PACER: **disabled**; cost guardrail enforces `$0`.

## Self-hosted runner (must be persistent)

The operator workflows only run when the builder's runner is a persistent,
auto-starting service. If jobs sit `queued` with no runner, on `jurvio-builder-01`:

```bash
sudo systemctl enable --now 'actions.runner.*.service'
# first-time install, from the runner directory:
#   sudo ./svc.sh install <runner-user> && sudo ./svc.sh start
```

`reboot-builder-once.yml` power-cycles the builder but does not install the
service; persistence is a one-time setup.

## Operator workflows (`workflow_dispatch`, run on the builder)

| Workflow | Purpose |
|---|---|
| `ingestion-status.yml` | Read-only corpus + 108-court fleet report (live DB evidence). |
| `operator-audit.yml` | Read-only inventory: runner user, sudo allowlist, compose layout, containers, disk, Spaces/creds presence. |
| `ingestion-ops.yml` | `status` / `logs` / `restart` a single Jurvio service (direct `sudo -n docker`; restart is scoped, never whole-stack). |
| `deploy-ingestion.yml` | Build + push image, deploy to `jurvio-web-01`, run migrations, restart the independent case, appellate, and entity workers, health-check. |
| `federal-ingestion.yml` / `direct-court-ingestion.yml` / `appellate-ingestion.yml` | Ingestion cycles over the VPC route. |
| `outbox-maintenance.yml` | Drain + prune the outbox (daily + on demand). |

## Least-privilege sudo

`deploy/sudoers/jurvio-operator` grants the operator account passwordless sudo
for **only** the Docker/compose commands and read-only `systemctl` status — no
shell, no `NOPASSWD: ALL`. Validate with `visudo -cf` then install to
`/etc/sudoers.d/jurvio-operator` (mode 0440).

## Deploy

1. Merge to `main` (CI `verify` must pass: lint, typecheck, test, `build:jobs`, build).
2. Dispatch `deploy-ingestion.yml`. It builds the image, pushes to GHCR, pulls on
   `jurvio-web-01`, runs `scripts/migrate.mjs` in the compose network, and
   `docker compose up -d` for `app`, `worker-core`, `worker-coa`,
   `worker-entities`, `worker-supervisor`, then health-checks `/api/ready`.
3. Verify with `ingestion-status.yml`.

Rollback: re-deploy the previous image tag; migrations are additive and forward-only.

## Reboot survival

Every stack service is `restart: unless-stopped`; Docker is enabled on boot, so
the full stack (including `worker-supervisor`) resumes automatically after a
reboot. The durable job queue (`ingestion_job`) preserves in-flight work; the
supervisor reaps any lease abandoned across the reboot.

## General ingestion lanes

- `worker-core`: heavy federal and state case discovery, documents, publication, and future PDF-to-text work.
- `worker-coa`: appellate-source ingestion and backfills.
- `worker-entities`: lightweight structured data such as judges, lawyers, law firms, legislators, agencies, and future entity catalogs.
- `worker-supervisor`: shared health, lease recovery, backpressure, and repair reporting.

These are independent long-running server processes. Heavy case/PDF work cannot occupy the entity scheduler, and routine entity refreshes do not block builds or production deployment.

## Self-repair (supervisor)

`worker-supervisor` runs `run-ingestion-supervisor.mjs` continuously. Each tick it
refreshes its heartbeat, reaps expired leases from crashed/stalled workers back
to `pending` (bounded, safe), and records backpressure. Every automatic action is
written to `ingestion_repair_action` (detector / action / reason / outcome) — it
never silently repairs, makes publication/legal judgments, or spends money.

## PACER ($0, disabled)

`PACER_ENABLED` is unset. Even if enabled, the guardrail
(`src/modules/ingestion/domain/pacer-guardrail.ts`) permits only free written
opinions and blocks + halts on any charge signal. Do not store or use PACER
credentials until the $0 enforcement tests pass (they do).

## Backup / restore

- PostgreSQL: `scripts/backup-production.sh` (`pg_dump | gzip`, retains 2). Restore:
  load a dump into a fresh `postgres` volume, then `deploy-ingestion` to migrate.
- Artifacts: immutable in Spaces (`jurvio-raw-evidence`); recovery = re-fetch by
  content-addressed key and verify the stored `x-amz-meta-content-hash`.

## Verification checklist (definition of done)

- [ ] Services survive a reboot (stack auto-resumes; queue intact).
- [ ] TXWD continuously ingesting with durable checkpoints (`ingestion-status`).
- [ ] Induced worker failure → supervisor reaps lease → `ingestion_repair_action` row.
- [ ] Induced source/rate-limit failure → bounded backoff or approved fallback.
- [ ] A Spaces artifact traces (content hash) to a normalized and eligible published record.
- [ ] Court Coverage shows factual timestamps/sources/coverage/holds; unknowns labeled unknown.
- [ ] PACER `$0` (ledger `entries=0`); $0-enforcement tests green.
- [ ] PostgreSQL backup/restore + artifact recovery verified.
