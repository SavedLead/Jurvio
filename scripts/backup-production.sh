#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR=${DEPLOY_DIR:-/opt/jurvio}
BACKUP_DIR=${BACKUP_DIR:-$DEPLOY_DIR/backups}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="$BACKUP_DIR/jurvio-$STAMP.sql.gz"
PARTIAL="$TARGET.partial"
KEEP_BACKUPS=${KEEP_BACKUPS:-2}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cd "$DEPLOY_DIR"

cleanup_release_space() {
  # Only release disposable deployment material. Database and artifact volumes are never pruned.
  find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'jurvio-*.sql' -o -name 'jurvio-*.partial' \) -delete
  mapfile -t backups < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'jurvio-*.sql.gz' -printf '%T@ %p\n' | sort -rn | awk 'NR > keep { $1=""; sub(/^ /, ""); print }' keep="$KEEP_BACKUPS")
  ((${#backups[@]} == 0)) || rm -f -- "${backups[@]}"
  docker image prune -af >/dev/null || true
  docker builder prune -af >/dev/null || true
  df -h "$DEPLOY_DIR" >&2
}

cleanup_release_space
trap 'rm -f "$PARTIAL"' EXIT

docker compose -f docker-compose.production.yml exec -T postgres \
  pg_dump --username jurvio --dbname jurvio --no-owner --no-acl \
  | gzip -1 > "$PARTIAL"

test -s "$PARTIAL"
gzip -t "$PARTIAL"
mv "$PARTIAL" "$TARGET"
chmod 600 "$TARGET"
printf '%s\n' "$TARGET"
