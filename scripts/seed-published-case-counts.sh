#!/bin/sh
# Seed court_public_stats.case_count one court at a time.
# Runs on the ingestion host (docker, no sudo). Safe beside bulk publish and
# the search catch-up: one court per transaction, a short statement timeout,
# and a 3s lock timeout. It does not touch case rows.
#
# Progress is stored in published_count_seed_cursor. A later run continues
# after the last court that committed. The count uses the displayable rule
# and replaces case_count from that count minus the delta captured with it,
# so a court the partial deploy seed already wrote is not counted twice.
set -eu
set -o pipefail

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
INSERT INTO published_count_seed_cursor (singleton) VALUES (1) ON CONFLICT DO NOTHING;
SQL

echo "resuming published-count seed"
psql -c "SELECT court_id, seeded, updated_at FROM published_count_seed_cursor WHERE singleton = 1;"

seed_once() {
  seconds="$1"
  psql_sql -q -tA <<SQL
BEGIN;
SET LOCAL statement_timeout = '${seconds}s';
SET LOCAL lock_timeout = '3s';
SELECT coalesce(seed_next_published_count_court()::text, 'done');
COMMIT;
SQL
}

while true; do
  line=""
  for seconds in 30 60 120; do
    if line=$(seed_once "$seconds" | tail -n 1); then
      break
    fi
    line=""
    echo "court seed failed at ${seconds}s; checkpoint not moved" >&2
  done
  if [ -z "$line" ]; then
    echo "seed stopped; re-dispatch resumes at the same court" >&2
    exit 1
  fi
  if [ "$line" = "done" ]; then
    echo "published-count seed complete"
    break
  fi
  echo "seeded court $line"
done

psql -c "SELECT court_id, seeded FROM published_count_seed_cursor WHERE singleton = 1;"
