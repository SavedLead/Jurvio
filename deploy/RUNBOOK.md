# Jurvio Federal Ingestion — Production Runbook

Operational reference for running Jurvio's always-on federal court ingestion
platform on its own servers. All routine operations run through the self-hosted
GitHub Actions builder over the private VPC — no direct console access required.

## Topology

| Host | Role | Reached by |
|---|---|---|
| `jurvio-web-01` (VPC `10.116.0.2`) | Ingestion + PostgreSQL + raw artifacts. Runs `postgres`, `app`, `worker-core`, `worker-coa`, `worker-citations`, `worker-supervisor` via `docker-compose.production.yml` in `/opt/jurvio`. | self-hosted builder → `DO_USER@10.116.0.2` (private VPC), `sudo -n docker` |
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
| `deploy-production.yml` | **The single authoritative production deploy for `jurvio-web-01`.** Concurrency-locked (`jurvio-production`, one at a time); the release gate always resolves the current tip of `main` and refuses any older/other commit, and a pre-release guard skips the box changes if `main` advanced during the build — so an older run can never overwrite a newer release. |
| `deploy-ingestion.yml` | **Retired as a release path** — build-only preflight (`docker build`, no push, never touches the box). Use `deploy-production.yml` to release. |
| `verify-spaces-trace.yml` | Read-only: proves a Spaces artifact traces by content hash to a published record. |
| `federal-ingestion.yml` / `direct-court-ingestion.yml` / `appellate-ingestion.yml` | Ingestion cycles over the VPC route. |
| `outbox-maintenance.yml` | Drain + prune the outbox (daily + on demand). |

## Least-privilege sudo

`deploy/sudoers/jurvio-operator` grants the operator account passwordless sudo
for **only** the Docker/compose commands and read-only `systemctl` status — no
shell, no `NOPASSWD: ALL`. Validate with `visudo -cf` then install to
`/etc/sudoers.d/jurvio-operator` (mode 0440).

## Deploy

Production releases to `jurvio-web-01` go through **`deploy-production.yml` only**
— it is the single authoritative pipeline for the box. `deploy-ingestion.yml` no
longer deploys (build-only preflight).

1. Merge to `main` (CI `verify` must pass: lint, typecheck, test, `build:jobs`, build).
2. Dispatch `deploy-production.yml` (no input needed — it always deploys the
   current tip of `main`; a pinned `commit_sha` is accepted only if it equals
   current `main`). It builds+pushes the image, copies the compose/release
   controls, runs `release-production.sh` (migrate + `docker compose up -d`),
   refreshes nginx, and verifies the hosted login.
3. Verify with `ingestion-status.yml`.

**Safety guarantees:** the `jurvio-production` concurrency lock allows only one
deploy at a time; the release gate always resolves current `main` and refuses an
older/other commit; and a pre-release guard skips all box changes if `main`
advanced during the build. Together these ensure an older or queued run can never
overwrite a newer production release.

Rollback: re-deploy the previous image tag; migrations are additive and forward-only.

## Reboot survival

Every stack service is `restart: unless-stopped`; Docker is enabled on boot, so
the full stack (including `worker-supervisor`) resumes automatically after a
reboot. The durable job queue (`ingestion_job`) preserves in-flight work; the
supervisor reaps any lease abandoned across the reboot.

## Self-repair (supervisor)

`worker-supervisor` runs `run-ingestion-supervisor.mjs` continuously. Each tick it
refreshes its heartbeat, reaps expired leases from crashed/stalled workers back
to `pending` (bounded, safe), records backpressure, and detects crash-looping
scheduler lanes (see below). Every automatic action is written to
`ingestion_repair_action` (detector / action / reason / outcome) — it never
silently repairs, makes publication/legal judgments, or spends money.

### Lane-health self-detection

The on-box scheduler records the outcome of every lane child process to
`scheduler_lane_run` (lane, exit code, signal, duration, and a bounded tail of the
child's output on failure). The supervisor reads it each tick and flags any lane
that ran repeatedly in the last 30 minutes and **never once succeeded** as a
`lane-health` / `flag_failing_lane` entry in `ingestion_repair_action`, carrying the
real error tail — throttled to one alert per lane per 15 min. This is detection and
audit only: a lane that crashes on startup needs a code/config fix (a PR), so the
supervisor surfaces it with the actual error instead of blindly restarting it. A
crash-looping lane is therefore visible in the repair feed within a tick, not
buried in a per-lane log file. (Recording is best-effort — a bookkeeping-DB error
never takes down the scheduler loop.)

## PACER ($0, disabled)

`PACER_ENABLED` is unset. Even if enabled, the guardrail
(`src/modules/ingestion/domain/pacer-guardrail.ts`) permits only free written
opinions and blocks + halts on any charge signal. Do not store or use PACER
credentials until the $0 enforcement tests pass (they do).

## Backup / restore

- **On-box (release rollback):** `scripts/backup-production.sh` (`pg_dump | gzip`,
  retains 2 in `/opt/jurvio/backups`). It talks to the postgres container via
  `docker exec`, deliberately NOT `docker compose exec` — compose interpolates the
  whole file, and `JURVIO_IMAGE` is passed only at deploy time, so every
  compose-based invocation outside a release aborted before dumping a byte.
- **Bucket setup (once):** `provision-backup-bucket-once.yml` creates the private
  backup bucket using the Spaces credentials already in `.env.production` (they
  never leave the box). Idempotent, and it fails if the bucket allows anonymous
  listing. A bucket-scoped Spaces key cannot create buckets (403 on create) —
  that is not a failure: create the bucket in the DigitalOcean console and
  re-run, and the job verifies the key can use it. To keep the backup key
  least-privilege, point `JURVIO_BACKUP_ACCESS_KEY_ID` /
  `JURVIO_BACKUP_SECRET_ACCESS_KEY` at a key scoped to the backup bucket only.
- **Off-box (disaster recovery):** `nightly-db-backup.yml` uploads each dump to a
  separate Spaces bucket (`JURVIO_BACKUP_BUCKET`) encrypted with AES-256-GCM
  (`JURVIO_BACKUP_ENCRYPTION_KEY`) via `jobs/upload-database-backup.mjs`. Keep a
  copy of that key OFF this box — a key stored only on the box it protects is not
  a recovery plan. The nightly run fails red if the newest off-site object is
  missing, empty, or older than 36h.
- **Restore rehearsal:** `verify-backup-restore.yml` (weekly + on demand) pulls the
  newest off-site object, decrypts it, loads it into a throwaway postgres
  container, and asserts the restored corpus is non-empty. It never touches the
  production database or volumes and removes the scratch container and decrypted
  dump in an `if: always()` step. **This is the check docs/38 requires before public
  launch — dispatch it once and confirm it is green.**
- Manual restore: load a decrypted dump into a fresh `postgres` volume, then
  `deploy-production` to migrate.
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
