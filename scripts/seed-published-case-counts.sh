#!/bin/sh
# Seed court_public_stats.case_count one court at a time.
# Runs on the ingestion host (docker, no sudo). One court per transaction,
# a short statement timeout, a 3s lock timeout, and a pause between courts.
# It does not touch case rows.
#
# The checkpoint moves only after that court's count commits. A timeout
# leaves published_count_seed_cursor on the previous court, and the next
# attempt retries the same court. A later run continues there.
#
# SEED_COURT_PAUSE_SECONDS (default 3) is the pause after each committed court.
set -eu
set -o pipefail

PAUSE="${SEED_COURT_PAUSE_SECONDS:-3}"
case "$PAUSE" in
  ''|*[!0-9]*) echo "SEED_COURT_PAUSE_SECONDS must be a whole number of seconds" >&2; exit 1 ;;
esac
NIL=00000000-0000-0000-0000-000000000000

pg=$(docker ps \
  --filter 'label=com.docker.compose.project=jurvio' \
  --filter 'label=com.docker.compose.service=postgres' \
  --format '{{.ID}}' | head -n1)
if [ -z "$pg" ]; then
  echo "postgres container not found" >&2
  exit 1
fi

psql() {
  docker exec "$pg" psql -U jurvio -d jurvio -v ON_ERROR_STOP=1 -P pager=off "$@" </dev/null
}

psql_sql() {
  docker exec -i "$pg" psql -U jurvio -d jurvio -v ON_ERROR_STOP=1 -P pager=off "$@"
}

psql_sql <<'SQL'
CREATE TABLE IF NOT EXISTS published_count_seed_cursor (
  singleton integer PRIMARY KEY CHECK (singleton = 1),
  court_id uuid,
  seeded integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE published_count_seed_cursor
  ADD COLUMN IF NOT EXISTS complete boolean NOT NULL DEFAULT false;
INSERT INTO published_count_seed_cursor (singleton) VALUES (1) ON CONFLICT DO NOTHING;
SQL

echo "resuming published-count seed pause_s=$PAUSE"
psql -c "SELECT court_id, seeded, updated_at FROM published_count_seed_cursor WHERE singleton = 1;"

next_court() {
  psql -q -tA -c "SELECT coalesce((SELECT id::text FROM court WHERE id > coalesce((SELECT court_id FROM published_count_seed_cursor WHERE singleton = 1), '${NIL}'::uuid) ORDER BY id LIMIT 1), '')"
}

count_court() {
  seconds="$1"
  target="$2"
  psql_sql -q -tA <<SQL
BEGIN;
SET LOCAL statement_timeout = '${seconds}s';
SET LOCAL lock_timeout = '3s';
SELECT seed_published_count_for_court('${target}'::uuid);
COMMIT;
SQL
}

advance_cursor() {
  target="$1"
  psql_sql -q -tA <<SQL
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5s';
UPDATE published_count_seed_cursor
SET court_id = '${target}'::uuid,
    seeded = seeded + 1,
    complete = false,
    updated_at = now()
WHERE singleton = 1
  AND (court_id IS NULL OR court_id < '${target}'::uuid);
SELECT court_id::text FROM published_count_seed_cursor WHERE singleton = 1;
COMMIT;
SQL
}

while true; do
  target=$(next_court)
  target=$(printf '%s' "$target" | tr -d '[:space:]')
  if [ -z "$target" ]; then
    psql_sql <<SQL
BEGIN;
UPDATE published_count_seed_cursor
SET complete = true, updated_at = now()
WHERE singleton = 1
  AND NOT EXISTS (
    SELECT 1 FROM court
    WHERE id > coalesce(published_count_seed_cursor.court_id, '${NIL}'::uuid)
  );
COMMIT;
SQL
    echo "published-count seed complete"
    break
  fi
  case "$target" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) echo "seed stopped; next court id is not a uuid: $target" >&2; exit 1 ;;
  esac
  echo "seeding court $target"
  ok=0
  for seconds in 30 60 120; do
    if count_court "$seconds" "$target"; then
      ok=1
      break
    fi
    echo "court seed failed at ${seconds}s; checkpoint not moved; court $target" >&2
  done
  if [ "$ok" != 1 ]; then
    echo "seed stopped on court $target; re-dispatch retries this court" >&2
    exit 1
  fi
  moved=$(advance_cursor "$target" | tr -d '[:space:]')
  if [ "$moved" != "$target" ]; then
    echo "seed stopped; checkpoint is $moved after counting $target" >&2
    exit 1
  fi
  echo "seeded court $target"
  sleep "$PAUSE"
done

psql -c "SELECT court_id, seeded, complete FROM published_count_seed_cursor WHERE singleton = 1;"
