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
# the publish transaction. After each commit, one slice of public_case_search
# is filled. scripts/catch-up-published-search.sh finishes the rest and can
# run while this job is already going. Neither path touches legal_case.updated_at.
set -eu

MODE=${1:-count}
RANGE=75000
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

# One committed slice of the text index. Runs outside the deferred publish
# transaction. ON CONFLICT DO NOTHING, and legal_case is not updated.
catch_up_search_slice() {
  psql -q -tA <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
WITH batch AS (
  SELECT c.id, c.public_id, c.caption, c.docket_number, c.official_citation
  FROM legal_case c
  WHERE c.publication = 'published'
    AND NOT EXISTS (SELECT 1 FROM public_case_search search WHERE search.case_id = c.id)
  ORDER BY c.public_id
  LIMIT 500
), written AS (
  INSERT INTO public_case_search (case_id, public_id, search_text, refreshed_at)
  SELECT batch.id, batch.public_id,
    concat_ws(E'\n',
      batch.caption,
      batch.docket_number,
      batch.official_citation,
      (SELECT enrichment.exact_holding FROM scotus_case_enrichment enrichment
        WHERE enrichment.case_id = batch.id AND enrichment.verification = 'verified'),
      (SELECT string_agg(DISTINCT names.name, E'\n')
        FROM (
          SELECT appearance.party_name_as_filed AS name
          FROM party_appearance appearance WHERE appearance.case_id = batch.id
          UNION
          SELECT entity.display_name
          FROM party_appearance appearance
          JOIN entity ON entity.id = appearance.entity_id
          WHERE appearance.case_id = batch.id
        ) names)
    ),
    now()
  FROM batch
  ON CONFLICT (case_id) DO NOTHING
  RETURNING 1
)
SELECT count(*) FROM written;
COMMIT;
SQL
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
SET LOCAL statement_timeout = '180s';
SET LOCAL lock_timeout = '15s';
SELECT set_config('jurvio.defer_search_refresh', 'on', true);
CREATE TEMP TABLE batch_result (scanned integer, published integer, cursor_at timestamptz, cursor_id uuid) ON COMMIT DROP;
WITH params AS (
  SELECT created_at, case_id FROM bulk_publish_cursor WHERE singleton = 1
),
windowed AS (
  SELECT c.id, c.created_at, c.caption, c.docket_number, c.filed_on,
    c.cause_of_action, c.nature_of_suit_code, court.provider_court_id
  FROM legal_case c
  JOIN court ON court.id = c.court_id
  CROSS JOIN params
  WHERE c.publication = 'draft'
    AND (
      params.created_at IS NULL
      OR c.created_at < params.created_at
      OR (c.created_at = params.created_at AND c.id < params.case_id)
    )
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT ${RANGE}
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
  catch_up_search_slice || echo "search catch-up skipped"
  if [ "$scanned" = "0" ]; then
    echo "pass complete; cursor reset so a later run picks up new drafts"
    completed=1
    break
  fi
  RANGE=75000
done

if [ "$completed" != 1 ]; then
  echo "bulk publish ended without completing" >&2
  exit 1
fi

psql_c -c "SELECT batches, scanned, published, created_at, case_id FROM bulk_publish_cursor WHERE singleton = 1;"
