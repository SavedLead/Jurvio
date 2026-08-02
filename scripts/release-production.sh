#!/bin/sh
set -eu

DEPLOY_DIR=${DEPLOY_DIR:-/opt/jurvio}
COMPOSE="$DEPLOY_DIR/docker-compose.production.yml"
NEW_IMAGE=${JURVIO_IMAGE:?JURVIO_IMAGE is required}
PREVIOUS_IMAGE=""
BACKUP_TIMEOUT_SECONDS=${BACKUP_TIMEOUT_SECONDS:-1800}
PULL_TIMEOUT_SECONDS=${PULL_TIMEOUT_SECONDS:-900}
MIGRATION_TIMEOUT_SECONDS=${MIGRATION_TIMEOUT_SECONDS:-300}
START_TIMEOUT_SECONDS=${START_TIMEOUT_SECONDS:-180}

diagnose() {
  printf '\n--- production release diagnostics ---\n' >&2
  docker compose -f "$COMPOSE" ps >&2 || true
  docker compose -f "$COMPOSE" logs --tail=150 app worker postgres >&2 || true
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
if docker compose -f "$COMPOSE" ps -q app >/dev/null 2>&1; then
  CONTAINER=$(docker compose -f "$COMPOSE" ps -q app || true)
  if [ -n "$CONTAINER" ]; then
    PREVIOUS_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")
  fi
fi

if docker compose -f "$COMPOSE" ps -q postgres | grep -q .; then
  printf 'Starting compressed database backup (deadline: %ss)\n' "$BACKUP_TIMEOUT_SECONDS"
  run_with_timeout "Database backup" "$BACKUP_TIMEOUT_SECONDS" "$DEPLOY_DIR/scripts/backup-production.sh"
fi

export JURVIO_IMAGE="$NEW_IMAGE"
run_with_timeout "Image pull" "$PULL_TIMEOUT_SECONDS" docker compose -f "$COMPOSE" pull app worker
run_with_timeout "Postgres startup" "$START_TIMEOUT_SECONDS" docker compose -f "$COMPOSE" up -d postgres

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
run_with_timeout "Application and worker startup" "$START_TIMEOUT_SECONDS" docker compose -f "$COMPOSE" up -d app worker

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
  docker compose -f "$COMPOSE" up -d app worker || true
  printf 'Application and worker rolled back to %s\n' "$PREVIOUS_IMAGE" >&2
fi
diagnose
exit 1
