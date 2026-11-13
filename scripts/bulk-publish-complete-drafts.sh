#!/bin/sh
# Publish complete, non-thin federal drafts in committed ranges.
# Runs on the ingestion host (docker, no sudo). Mode is the first argument:
#   count    read-only totals, no updates
#   publish  resume from bulk_publish_cursor and walk every remaining draft
#
# A draft is complete when it has a caption, docket number, court, and filed
# date, plus at least one of cause, nature of suit, a judge assignment, a
# party, or a docket entry. Sealed captions and suppressing holds are not
# published. SCOTUS is left to its own pipeline. updated_at is not changed,
# so follower alerts do not see a new filing. Search refresh stays off inside
# the publish transaction. scripts/catch-up-published-search.sh fills
# public_case_search and can run while this job is already going. Neither
# path touches legal_case.updated_at.
set -eu

MODE=${1:-count}
# One index range on legal_case_draft_created_idx. Published rows are already
# excluded by that partial index. 200k is one commit; the page shrinks only
# when a statement actually times out.
RANGE=200000
RULE=federal-publication-v3
REOPEN="'missing_readable_content','unverified_court_record','missing_source_artifact','missing_source_url','invalid_source_checksum','missing_retrieval_timestamp'"

pg=$(docker ps \
  --filter 'label=com.docker.compose.project=jurvio' \
  --filter 'label=com.docker.compose.service=postgres' \
  --format '{{.ID}}' | head -n1)
if [ -z "$pg" ]; then
  echo "postgres container not found" >&2
  exit 1
fi

psql() {
  docker exec -i "$pg" psql -U jurvio -d jurvio -v ON_ERROR_STOP=1 -P pager=off "$@"
}

# -c must not read stdin. This file is fed to bash -s.
psql_c() {
  docker exec "$pg" psql -U jurvio -d jurvio -v ON_ERROR_STOP=1 -P pager=off "$@" </dev/null
}

COUNT_SQL=$(cat <<SQL
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '90min';
SELECT
  count(*) FILTER (WHERE NOT scotus) AS drafts,
  count(*) FILTER (WHERE NOT scotus AND complete) AS complete,
  count(*) FILTER (WHERE NOT scotus AND NOT complete) AS thin,
  count(*) FILTER (WHERE NOT scotus AND complete AND sealed) AS sealed_complete,
  count(*) FILTER (WHERE NOT scotus AND complete AND NOT sealed AND held) AS held_complete,
  count(*) FILTER (WHERE NOT scotus AND complete AND NOT sealed AND NOT held) AS publishable
FROM (
  SELECT
    lower(coalesce(court.provider_court_id, '')) = 'scotus' AS scotus,
    (
      length(btrim(c.caption)) > 0
      AND length(btrim(c.docket_number)) > 0
      AND c.court_id IS NOT NULL
      AND c.filed_on IS NOT NULL
      AND (
        nullif(btrim(coalesce(c.cause_of_action, '')), '') IS NOT NULL
        OR nullif(btrim(coalesce(c.nature_of_suit_code, '')), '') IS NOT NULL
        OR EXISTS (SELECT 1 FROM judge_case_assignment j WHERE j.case_id = c.id)
        OR EXISTS (SELECT 1 FROM party_appearance p WHERE p.case_id = c.id)
        OR EXISTS (SELECT 1 FROM docket_entry e WHERE e.case_id = c.id)
      )
    ) AS complete,
    (concat_ws(' ', c.caption, c.docket_number) ~* '\\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\\M') AS sealed,
    EXISTS (
      SELECT 1 FROM federal_publication_hold hold
      WHERE hold.case_id = c.id
        AND hold.rule_version = '${RULE}'
        AND NOT (cardinality(hold.reasons) > 0 AND hold.reasons <@ ARRAY[${REOPEN}]::text[])
    ) AS held
  FROM legal_case c
  JOIN court ON court.id = c.court_id
  WHERE c.publication = 'draft'
) drafts;
ROLLBACK;
SQL
)

if [ "$MODE" = "count" ]; then
  printf '%s\n' "$COUNT_SQL" | psql
  exit 0
fi

if [ "$MODE" != "publish" ]; then
  echo "mode must be count or publish" >&2
  exit 1
fi

psql <<SQL
CREATE TABLE IF NOT EXISTS bulk_publish_cursor (
  singleton integer PRIMARY KEY CHECK (singleton = 1),
  created_at timestamptz,
  case_id uuid,
  batches integer NOT NULL DEFAULT 0,
  scanned bigint NOT NULL DEFAULT 0,
  published bigint NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO bulk_publish_cursor (singleton) VALUES (1) ON CONFLICT DO NOTHING;
SQL

# An empty federal-publication-v3 reason list still suppresses a draft. The
# opinion-review clear removed that one reason and, because the delete shared
# the update's snapshot, left the row in place. Drop those rows before the
# walk. A hold with any remaining reason, including sealed, stays.
echo "deleting v3 holds whose reason list is empty"
empty_deleted=0
while true; do
  n=$(psql -q -tA <<SQL
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
WITH doomed AS (
  SELECT case_id
  FROM federal_publication_hold
  WHERE rule_version = '${RULE}'
    AND cardinality(reasons) = 0
  ORDER BY case_id
  LIMIT 5000
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
  case "$n" in
    [0-9]*) ;;
    *) echo "empty-hold delete failed" >&2; exit 1 ;;
  esac
  if [ "$n" = "0" ]; then
    break
  fi
  empty_deleted=$((empty_deleted + n))
  echo "empty_hold_batch_deleted=$n"
done
echo "empty_v3_holds_deleted=$empty_deleted"

started=$(date +%s)
MIN_RANGE=5000
floor_failures=0
completed=0
echo "resuming from bulk_publish_cursor"
psql_c -c "SELECT batches, scanned, published, created_at, case_id FROM bulk_publish_cursor WHERE singleton = 1;"
while true; do
  # Unquoted so RANGE and RULE expand. Do not use $$ here: bash would
  # replace it with the process id (the 6:22 AM ET run sent DO 1985059).
  output=$(psql -q -tA <<SQL
BEGIN;
SET LOCAL statement_timeout = '10min';
SET LOCAL lock_timeout = '15s';
SELECT set_config('jurvio.defer_search_refresh', 'on', true);
CREATE TEMP TABLE batch_result (scanned integer, published integer, cursor_at timestamptz, cursor_id uuid) ON COMMIT DROP;
WITH params AS (
  SELECT created_at, case_id FROM bulk_publish_cursor WHERE singleton = 1
),
windowed AS MATERIALIZED (
  -- legal_case_draft_created_idx is (created_at, id) WHERE publication = 'draft'.
  -- A created_at < cursor range walks that index backward and stops at LIMIT.
  -- The old OR keyset could not, so the first batch after the Oct 30 cursor
  -- ran until the statement limit (120s at 7:16 AM ET).
  SELECT c.id, c.created_at, c.caption, c.docket_number, c.filed_on,
    c.cause_of_action, c.nature_of_suit_code, court.provider_court_id
  FROM params
  CROSS JOIN LATERAL (
    SELECT picked.id
    FROM (
      (
        SELECT c.id, c.created_at
        FROM legal_case c
        WHERE c.publication = 'draft'
          AND (params.created_at IS NULL OR c.created_at < params.created_at)
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ${RANGE}
      )
      UNION ALL
      (
        SELECT c.id, c.created_at
        FROM legal_case c
        WHERE c.publication = 'draft'
          AND params.case_id IS NOT NULL
          AND c.created_at = params.created_at
          AND c.id < params.case_id
        ORDER BY c.id DESC
        LIMIT ${RANGE}
      )
    ) picked
    ORDER BY picked.created_at DESC, picked.id DESC
    LIMIT ${RANGE}
  ) ids
  JOIN legal_case c ON c.id = ids.id
  JOIN court ON court.id = c.court_id
),
picked AS (
  SELECT windowed.id,
    (concat_ws(' ', windowed.caption, windowed.docket_number) ~* '\\m(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\\M') AS sealed
  FROM windowed
  WHERE lower(coalesce(windowed.provider_court_id, '')) <> 'scotus'
    AND length(btrim(windowed.caption)) > 0
    AND length(btrim(windowed.docket_number)) > 0
    AND windowed.filed_on IS NOT NULL
    AND (
      nullif(btrim(coalesce(windowed.cause_of_action, '')), '') IS NOT NULL
      OR nullif(btrim(coalesce(windowed.nature_of_suit_code, '')), '') IS NOT NULL
      OR EXISTS (SELECT 1 FROM judge_case_assignment j WHERE j.case_id = windowed.id)
      OR EXISTS (SELECT 1 FROM party_appearance p WHERE p.case_id = windowed.id)
      OR EXISTS (SELECT 1 FROM docket_entry e WHERE e.case_id = windowed.id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM federal_publication_hold hold
      WHERE hold.case_id = windowed.id
        AND hold.rule_version = '${RULE}'
        AND NOT (cardinality(hold.reasons) > 0 AND hold.reasons <@ ARRAY[${REOPEN}]::text[])
    )
),
updated AS (
  UPDATE legal_case AS c
  SET verification = 'verified', publication = 'published', updated_at = c.updated_at
  FROM picked
  WHERE c.id = picked.id AND NOT picked.sealed AND c.publication = 'draft'
  RETURNING c.id
),
decided AS (
  INSERT INTO publication_decision (
    object_type, object_id, displayable, indexable, machine_accessible,
    downloadable, summary_eligible, reason_code, rule_version
  )
  SELECT 'legal_case', id, true, false, true, false, false, 'bulk_complete_draft', '${RULE}'
  FROM updated
  RETURNING id, object_id, decided_at
),
mirrored AS (
  INSERT INTO publication_current (object_type, object_id, displayable, decided_at, decision_id)
  SELECT 'legal_case', object_id, true, decided_at, id FROM decided
  ON CONFLICT (object_type, object_id) DO UPDATE SET
    displayable = EXCLUDED.displayable,
    decided_at = EXCLUDED.decided_at,
    decision_id = EXCLUDED.decision_id
  RETURNING object_id
),
cleared AS (
  DELETE FROM federal_publication_hold AS hold
  USING updated
  WHERE hold.case_id = updated.id
  RETURNING hold.case_id
),
held AS (
  INSERT INTO federal_publication_hold (case_id, reasons, rule_version)
  SELECT picked.id, ARRAY['restricted_or_sensitive']::text[], '${RULE}'
  FROM picked
  WHERE picked.sealed
  ON CONFLICT (case_id) DO UPDATE SET
    reasons = EXCLUDED.reasons, rule_version = EXCLUDED.rule_version, held_at = now()
  RETURNING case_id
),
advanced AS (
  UPDATE bulk_publish_cursor AS cursor
  SET created_at = edge.created_at,
      case_id = edge.id,
      batches = cursor.batches + 1,
      scanned = cursor.scanned + edge.scanned,
      published = cursor.published + (SELECT count(*) FROM updated),
      updated_at = now()
  FROM (
    SELECT created_at, id, (SELECT count(*)::int FROM windowed) AS scanned
    FROM windowed
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  ) AS edge
  WHERE cursor.singleton = 1 AND edge.scanned > 0
  RETURNING cursor.created_at, cursor.case_id, cursor.scanned, cursor.published, edge.scanned AS batch_scanned
)
INSERT INTO batch_result (scanned, published, cursor_at, cursor_id)
SELECT
  COALESCE((SELECT batch_scanned FROM advanced), 0),
  (SELECT count(*)::int FROM updated),
  (SELECT created_at FROM advanced),
  (SELECT case_id FROM advanced);
UPDATE bulk_publish_cursor
SET created_at = NULL, case_id = NULL, updated_at = now()
WHERE singleton = 1
  AND NOT EXISTS (SELECT 1 FROM batch_result WHERE scanned > 0);
SELECT scanned::text || '|' || published::text FROM batch_result;
COMMIT;
SQL
) || true
  # A statement timeout makes psql exit 3. Without "|| true", set -e stops
  # the run (7:14 AM ET, exit 3) before the range can shrink. The transaction
  # rolls back, so the checkpoint stays put. set_config prints "on"; keep
  # only the scanned|published row.
  line=$(printf '%s\n' "$output" | grep -E '^[0-9]+\|[0-9]+$' | tail -n 1 || true)
  case "$line" in
    [0-9]*\|[0-9]*) ;;
    *)
      echo "batch failed at range ${RANGE}: ${line:-empty}" >&2
      if [ "$RANGE" -gt "$MIN_RANGE" ]; then
        RANGE=$((RANGE / 2))
        if [ "$RANGE" -lt "$MIN_RANGE" ]; then RANGE=$MIN_RANGE; fi
        floor_failures=0
        echo "reducing range to $RANGE and retrying the same checkpoint" >&2
        continue
      fi
      floor_failures=$((floor_failures + 1))
      if [ "$floor_failures" -ge 3 ]; then
        echo "bulk publish ended without completing" >&2
        exit 1
      fi
      echo "retrying range $RANGE after a timeout ($floor_failures of 3)" >&2
      continue
      ;;
  esac
  scanned=${line%%|*}
  published=${line##*|}
  now=$(date +%s)
  elapsed=$((now - started))
  if [ "$elapsed" -lt 1 ]; then elapsed=1; fi
  floor_failures=0
  echo "batch scanned=$scanned published=$published range=$RANGE elapsed_s=$elapsed"
  # Search indexing stays on the catch-up job. Doing a slice here paced every
  # publish commit on a second scan of public_case_search.
  if [ "$scanned" = "0" ]; then
    echo "pass complete; cursor reset so a later run picks up new drafts"
    completed=1
    break
  fi
  RANGE=200000
done

if [ "$completed" != 1 ]; then
  echo "bulk publish ended without completing" >&2
  exit 1
fi

psql_c -c "SELECT batches, scanned, published, created_at, case_id FROM bulk_publish_cursor WHERE singleton = 1;"
