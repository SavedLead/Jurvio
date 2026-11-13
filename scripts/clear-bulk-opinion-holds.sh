#!/bin/sh
# Remove bulk_opinion_text_pending_review from federal-publication-v3 holds.
# Runs on the ingestion host (docker, no sudo). Does not touch case rows,
# so follower alerts do not fire.
#
# A hold row whose reasons are empty after the removal is deleted. An empty
# reason list would still block. A row that still has another blocking reason
# stays. A row left with only the six reopenable reasons no longer blocks.
# The delete is its own statement. Postgres runs every data-modifying CTE in
# one statement against the same snapshot, so a DELETE beside the UPDATE still
# sees the old reason list and deletes nothing. A later sweep removes rows
# this already left empty. Running this again finds nothing to change.
set -eu
set -o pipefail

REASON=bulk_opinion_text_pending_review
RULE=federal-publication-v3
BATCH=2000

pg=$(docker ps \
  --filter 'label=com.docker.compose.project=jurvio' \
  --filter 'label=com.docker.compose.service=postgres' \
  --format '{{.ID}}' | head -n1)
if [ -z "$pg" ]; then
  echo "postgres container not found" >&2
  exit 1
fi

# -c must not read stdin. This file is fed to bash -s.
psql_c() {
  docker exec "$pg" psql -U jurvio -d jurvio -v ON_ERROR_STOP=1 -P pager=off "$@" </dev/null
}

psql_sql() {
  docker exec -i "$pg" psql -U jurvio -d jurvio -v ON_ERROR_STOP=1 -P pager=off "$@"
}

cleared=0
dropped=0
while true; do
  line=$(psql_sql -q -tA <<SQL
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE clear_batch ON COMMIT DROP AS
SELECT case_id
FROM federal_publication_hold
WHERE rule_version = '${RULE}'
  AND '${REASON}' = ANY (reasons)
ORDER BY case_id
LIMIT ${BATCH};
UPDATE federal_publication_hold AS hold
SET reasons = array_remove(hold.reasons, '${REASON}')
FROM clear_batch
WHERE hold.case_id = clear_batch.case_id
  AND hold.rule_version = '${RULE}';
DELETE FROM federal_publication_hold AS hold
USING clear_batch
WHERE hold.case_id = clear_batch.case_id
  AND cardinality(hold.reasons) = 0;
SELECT (SELECT count(*) FROM clear_batch)::text || '|' ||
       (SELECT count(*) FROM clear_batch)::text || '|' ||
       ((SELECT count(*) FROM clear_batch) - (
         SELECT count(*) FROM federal_publication_hold hold
         JOIN clear_batch ON clear_batch.case_id = hold.case_id
       ))::text;
COMMIT;
SQL
)
  line=$(printf '%s\n' "$line" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -n 1)
  batch_n=${line%%|*}
  rest=${line#*|}
  cleared_n=${rest%%|*}
  dropped_n=${rest##*|}
  if [ "$batch_n" = "0" ]; then
    break
  fi
  cleared=$((cleared + cleared_n))
  dropped=$((dropped + dropped_n))
  echo "batch removed_reason=$cleared_n deleted_empty=$dropped_n"
done

echo "clear complete removed_reason=$cleared deleted_empty=$dropped"
left=$(psql_c -q -tA -c "SELECT count(*) FROM federal_publication_hold WHERE rule_version = '${RULE}' AND '${REASON}' = ANY (reasons);")
echo "remaining_v3_rows_with_reason=$left"

# Rows already stripped of the reason, with nothing left, still block.
swept=0
while true; do
  n=$(psql_sql -q -tA <<SQL
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
WITH doomed AS (
  SELECT case_id
  FROM federal_publication_hold
  WHERE rule_version = '${RULE}'
    AND cardinality(reasons) = 0
  ORDER BY case_id
  LIMIT ${BATCH}
),
deleted AS (
  DELETE FROM federal_publication_hold AS hold
  USING doomed
  WHERE hold.case_id = doomed.case_id
    AND cardinality(hold.reasons) = 0
  RETURNING hold.case_id
)
SELECT count(*)::text FROM deleted;
COMMIT;
SQL
)
  n=$(printf '%s\n' "$n" | grep -E '^[0-9]+$' | tail -n 1 || true)
  if [ -z "$n" ]; then
    echo "empty-hold sweep failed" >&2
    exit 1
  fi
  if [ "$n" = "0" ]; then
    break
  fi
  swept=$((swept + n))
  echo "sweep deleted_empty=$n"
done
echo "empty_v3_holds_deleted=$swept"
