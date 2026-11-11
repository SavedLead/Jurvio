#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR=${DEPLOY_DIR:-/opt/jurvio}
BACKUP_DIR=${BACKUP_DIR:-$DEPLOY_DIR/backups}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="$BACKUP_DIR/jurvio-$STAMP.sql.gz"
PARTIAL="$TARGET.partial"
KEEP_BACKUPS=${KEEP_BACKUPS:-2}
# Images younger than this are never pruned. The previous release's image IS the
# rollback path (release-production.sh re-points JURVIO_IMAGE at it), so an
# unfiltered `docker image prune -af` here would delete the thing a failed
# release needs. Matches the release script's own retention window.
PRUNE_UNTIL=${PRUNE_UNTIL:-168h}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cd "$DEPLOY_DIR"

# Resolve the running postgres container by its compose labels.
#
# This script used to run `docker compose -f docker-compose.production.yml exec
# -T postgres ...`. compose interpolates the WHOLE file before running any
# command, and four services declare `image: ${JURVIO_IMAGE:?...}` — a value
# release-production.sh passes at deploy time and never persists on the box. So
# every invocation outside a release (i.e. every nightly run) aborted with
# "required variable JURVIO_IMAGE is missing a value" before dumping a single
# byte. Talking to the container directly needs no interpolation and therefore
# no image tag, so the nightly and the release path behave identically.
postgres_container() {
  docker ps \
    --filter 'label=com.docker.compose.project=jurvio' \
    --filter 'label=com.docker.compose.service=postgres' \
    --format '{{.ID}}' | head -n1
}

cleanup_release_space() {
  # Only release disposable deployment material. Database and artifact volumes are never pruned.
  # A second backup (the nightly) must not unlink a dump this script is still
  # writing. Only unfinished files older than two hours are disposable.
  find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'jurvio-*.sql' -o -name 'jurvio-*.partial' \) -mmin +120 -delete
  mapfile -t backups < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'jurvio-*.sql.gz' -printf '%T@ %p\n' | sort -rn | awk 'NR > keep { $1=""; sub(/^ /, ""); print }' keep="$KEEP_BACKUPS")
  ((${#backups[@]} == 0)) || rm -f -- "${backups[@]}"
  docker image prune -f --filter "until=$PRUNE_UNTIL" >/dev/null || true
  docker builder prune -f --filter "until=$PRUNE_UNTIL" >/dev/null || true
  df -h "$DEPLOY_DIR" >&2
}

PG_CONTAINER="$(postgres_container)"
if [ -z "$PG_CONTAINER" ]; then
  echo "::error::no running jurvio postgres container on this box — refusing to report a backup" >&2
  exit 1
fi

cleanup_release_space
trap 'rm -f "$PARTIAL"' EXIT

# `docker exec` (not `compose exec`) for the reason documented above. Failing
# here must fail the script: `pg_dump | gzip` would otherwise mask a dump error
# behind gzip's successful exit, so pipefail is essential (set at the top).
#
# NO `-i`, and stdin explicitly closed. pg_dump reads nothing from stdin, but
# `docker exec -i` attaches and drains it anyway — and when this script is called
# from a caller that is itself being read from stdin (`ssh host bash -s <<'EOF'`,
# which is how the nightly workflow invokes it), draining stdin consumes the
# caller's own remaining script. On 2026-09-09 that silently ate the rest of the
# backup step after this line: the dump succeeded, but the commands that recorded
# its path and listed the directory never ran, and the step still exited 0.
docker exec "$PG_CONTAINER" \
  pg_dump --username jurvio --dbname jurvio --no-owner --no-acl --no-tablespaces \
  < /dev/null | gzip -1 > "$PARTIAL"

test -s "$PARTIAL"
gzip -t "$PARTIAL"
mv "$PARTIAL" "$TARGET"
chmod 600 "$TARGET"
printf '%s\n' "$TARGET"
