#!/bin/sh
set -eu

DEPLOY_DIR=${DEPLOY_DIR:-/opt/jurvio}
BACKUP_DIR=${BACKUP_DIR:-$DEPLOY_DIR/backups}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="$BACKUP_DIR/jurvio-$STAMP.sql.gz"
UNCOMPRESSED="$BACKUP_DIR/jurvio-$STAMP.sql"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cd "$DEPLOY_DIR"

trap 'rm -f "$UNCOMPRESSED"' EXIT
docker compose -f docker-compose.production.yml exec -T postgres \
  pg_dump --username jurvio --dbname jurvio --no-owner --no-acl > "$UNCOMPRESSED"
test -s "$UNCOMPRESSED"
gzip -9 "$UNCOMPRESSED"

test -s "$TARGET"
chmod 600 "$TARGET"
gzip -t "$TARGET"
find "$BACKUP_DIR" -type f -name 'jurvio-*.sql.gz' -mtime +14 -delete
printf '%s\n' "$TARGET"
