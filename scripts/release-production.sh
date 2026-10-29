#!/bin/sh
set -eu

DEPLOY_DIR=${DEPLOY_DIR:-/opt/jurvio}
COMPOSE="$DEPLOY_DIR/docker-compose.production.yml"
NEW_IMAGE=${JURVIO_IMAGE:?JURVIO_IMAGE is required}
PREVIOUS_IMAGE=""
BACKUP_TIMEOUT_SECONDS=${BACKUP_TIMEOUT_SECONDS:-1800}
PULL_TIMEOUT_SECONDS=${PULL_TIMEOUT_SECONDS:-900}
# 0124 builds a concurrent index and backfills search visibility on the live
# opinion corpus. 300s can kill that mid-build and leave an INVALID index.
# 1800s matches the pre-migration backup budget.
MIGRATION_TIMEOUT_SECONDS=${MIGRATION_TIMEOUT_SECONDS:-1800}
START_TIMEOUT_SECONDS=${START_TIMEOUT_SECONDS:-180}

diagnose() {
  printf '\n--- production release diagnostics ---\n' >&2
  docker compose -f "$COMPOSE" ps >&2 || true
  docker compose -f "$COMPOSE" logs --tail=150 app worker-core worker-coa worker-citations postgres >&2 || true
}

fail() {
  printf '%s\n' "$1" >&2
  diagnose
  exit 1
}

run_with_timeout() {
  label="$1"
  seconds="$2"
  shift 2
  if ! timeout --signal=TERM --kill-after=30s "${seconds}s" "$@"; then
    fail "$label did not complete within ${seconds}s"
  fi
}

cd "$DEPLOY_DIR"

# Load JURVIO_DATABASE_BIND from .env.production so the postgres port binds to
# the private VPC address the public app (jurvio-public-01) connects to. docker
# compose only auto-loads `.env`, not `.env.production`, so without this the
# compose default ("${JURVIO_DATABASE_BIND:-127.0.0.1}") would rebind postgres
# to loopback and isolate the public app from the database on every release.
if [ -f "$DEPLOY_DIR/.env.production" ]; then
  DB_BIND_LINE=$(grep -E '^JURVIO_DATABASE_BIND=' "$DEPLOY_DIR/.env.production" | tail -1 || true)
  if [ -n "$DB_BIND_LINE" ]; then
    JURVIO_DATABASE_BIND=$(printf '%s' "${DB_BIND_LINE#JURVIO_DATABASE_BIND=}" | tr -d '\r')
    export JURVIO_DATABASE_BIND
    printf 'Using JURVIO_DATABASE_BIND=%s for postgres port publication\n' "$JURVIO_DATABASE_BIND"
  fi
fi
EXPECTED_DB_BIND=${JURVIO_DATABASE_BIND:-}

if docker compose -f "$COMPOSE" ps -q app >/dev/null 2>&1; then
  CONTAINER=$(docker compose -f "$COMPOSE" ps -q app || true)
  if [ -n "$CONTAINER" ]; then
    PREVIOUS_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")
  fi
fi

export JURVIO_IMAGE="$NEW_IMAGE"
# worker-supervisor runs the Judge Autopilot control loop and the durable-queue
# self-repair supervisor (run-ingestion-supervisor.mjs). It MUST be pulled and
# recreated on every release like the other workers, otherwise it keeps running
# a stale image and the control loop never picks up new code.
run_with_timeout "Image pull" "$PULL_TIMEOUT_SECONDS" docker compose -f "$COMPOSE" pull app worker-core worker-coa worker-citations worker-supervisor
run_with_timeout "Postgres startup" "$START_TIMEOUT_SECONDS" docker compose -f "$COMPOSE" up -d postgres

# The pre-release backup guards against a bad MIGRATION. An app-only release (no
# pending migration) changes no data and can always be rolled back by image, so
# the slow full backup is skipped for it — this is what makes ordinary deploys
# fast. The nightly out-of-band backup (nightly-db-backup.yml) keeps the recovery
# point fresh regardless. FAIL-SAFE: the check prints "unknown" on any error, and
# the backup is skipped ONLY when the count is exactly "0"; every other value
# (including "unknown") backs up, so this can never reduce safety on a migration.
PENDING_MIGRATIONS=$(docker compose -f "$COMPOSE" run --rm --no-deps -T app node jobs/list-pending-migrations.mjs 2>/dev/null || echo unknown)
if [ "$PENDING_MIGRATIONS" = "0" ]; then
  printf 'No pending migrations — skipping pre-release backup (nightly backup covers recovery).\n'
elif docker compose -f "$COMPOSE" ps -q postgres | grep -q .; then
  printf 'Pending migrations (%s) — compressed database backup first (deadline: %ss)\n' "$PENDING_MIGRATIONS" "$BACKUP_TIMEOUT_SECONDS"
  run_with_timeout "Database backup" "$BACKUP_TIMEOUT_SECONDS" "$DEPLOY_DIR/scripts/backup-production.sh"
fi

# Readiness guard: a release must not proceed to replace the app/workers if
# postgres bound to the wrong address (which would leave the public app cut off
# from the database). Verify the published host IP matches the expected private
# VPC bind before continuing.
if [ -n "$EXPECTED_DB_BIND" ]; then
  POSTGRES_CID=$(docker compose -f "$COMPOSE" ps -q postgres || true)
  ACTUAL_DB_BIND=$(docker inspect -f '{{range $p, $c := .HostConfig.PortBindings}}{{range $c}}{{.HostIp}} {{end}}{{end}}' "$POSTGRES_CID" 2>/dev/null || true)
  case " $ACTUAL_DB_BIND " in
    *" $EXPECTED_DB_BIND "*) printf 'Postgres bound to expected %s\n' "$EXPECTED_DB_BIND" ;;
    *) fail "Postgres published on '$ACTUAL_DB_BIND' but expected '$EXPECTED_DB_BIND'. Refusing to replace the app/workers and isolate the public site from the database." ;;
  esac
fi

DATABASE_READY=0
for attempt in $(seq 1 30); do
  if docker compose -f "$COMPOSE" exec -T postgres pg_isready -U jurvio -d jurvio >/dev/null 2>&1; then
    DATABASE_READY=1
    break
  fi
  sleep 2
done
[ "$DATABASE_READY" -eq 1 ] || fail "Database readiness failed before migration"

run_with_timeout "Database migration" "$MIGRATION_TIMEOUT_SECONDS" docker compose -f "$COMPOSE" run --rm --no-deps app node scripts/migrate.mjs
run_with_timeout "Application and worker startup" "$START_TIMEOUT_SECONDS" docker compose -f "$COMPOSE" up -d app worker-core worker-coa worker-citations worker-supervisor

READY=0
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/ready >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" -eq 1 ]; then
  docker image prune -f --filter 'until=168h' >/dev/null
  printf 'Release ready: %s\n' "$NEW_IMAGE"
  exit 0
fi

printf 'Readiness failed for %s\n' "$NEW_IMAGE" >&2
if [ -n "$PREVIOUS_IMAGE" ]; then
  export JURVIO_IMAGE="$PREVIOUS_IMAGE"
  docker compose -f "$COMPOSE" up -d app worker-core worker-coa worker-citations || true
  printf 'Application and worker rolled back to %s\n' "$PREVIOUS_IMAGE" >&2
fi
diagnose
exit 1
