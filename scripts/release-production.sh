#!/bin/sh
set -eu

DEPLOY_DIR=${DEPLOY_DIR:-/opt/jurvio}
COMPOSE="$DEPLOY_DIR/docker-compose.production.yml"
NEW_IMAGE=${JURVIO_IMAGE:?JURVIO_IMAGE is required}
PREVIOUS_IMAGE=""

cd "$DEPLOY_DIR"
if docker compose -f "$COMPOSE" ps -q app >/dev/null 2>&1; then
  CONTAINER=$(docker compose -f "$COMPOSE" ps -q app || true)
  if [ -n "$CONTAINER" ]; then
    PREVIOUS_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")
  fi
fi

if docker compose -f "$COMPOSE" ps -q postgres | grep -q .; then
  "$DEPLOY_DIR/scripts/backup-production.sh"
fi

export JURVIO_IMAGE="$NEW_IMAGE"
docker compose -f "$COMPOSE" pull app worker
docker compose -f "$COMPOSE" up -d postgres

DATABASE_READY=0
for attempt in $(seq 1 30); do
  if docker compose -f "$COMPOSE" exec -T postgres pg_isready -U jurvio -d jurvio >/dev/null 2>&1; then
    DATABASE_READY=1
    break
  fi
  sleep 2
done

if [ "$DATABASE_READY" -ne 1 ]; then
  printf 'Database readiness failed before migration\n' >&2
  exit 1
fi

docker compose -f "$COMPOSE" run --rm --no-deps app node scripts/migrate.mjs
docker compose -f "$COMPOSE" up -d app worker

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
  docker compose -f "$COMPOSE" up -d app
  printf 'Application rolled back to %s\n' "$PREVIOUS_IMAGE" >&2
fi
exit 1
