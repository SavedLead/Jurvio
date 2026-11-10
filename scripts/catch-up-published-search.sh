#!/bin/sh
# Resume the published-case search index and court-local filing dates.
# Runs on the ingestion host (docker, no sudo). Safe beside the bulk publish:
# 500-row transactions, a 3s lock timeout, and legal_case.updated_at is not
# changed, so follower alerts do not fire.
#
# Progress is stored in search_catchup_cursor. A later run continues at that
# key. Already indexed cases and already corrected dates are skipped.
# Cases are walked newest filing/decision first (legal_case_published_recency_idx).
# Docket dates are walked newest-seen first (direct_court_event_last_seen_idx).
# Does not submit a sitemap to Google.
set -eu

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

psql <<'SQL'
CREATE TABLE IF NOT EXISTS search_catchup_cursor (
  singleton integer PRIMARY KEY CHECK (singleton = 1),
  phase text NOT NULL DEFAULT 'cases',
  passed_dates boolean NOT NULL DEFAULT false,
  cursor_at timestamptz,
  cursor_date date,
  cursor_caption text,
  cursor_id uuid,
  batches integer NOT NULL DEFAULT 0,
  scanned bigint NOT NULL DEFAULT 0,
  corrected bigint NOT NULL DEFAULT 0,
  indexed bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO search_catchup_cursor (singleton) VALUES (1) ON CONFLICT DO NOTHING;
SQL

case_batch() {
  psql -q -tA <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
WITH state AS (
  SELECT * FROM search_catchup_cursor WHERE singleton = 1
),
windowed AS MATERIALIZED (
  SELECT c.id, c.public_id, c.caption, c.docket_number, c.official_citation, c.filed_on,
         COALESCE(c.decided_on, c.filed_on) AS sort_date
  FROM legal_case c
  CROSS JOIN state
  WHERE state.phase = 'cases'
    AND c.publication = 'published'
    AND (
      (NOT state.passed_dates AND COALESCE(c.decided_on, c.filed_on) IS NOT NULL AND (
        state.cursor_id IS NULL
        OR COALESCE(c.decided_on, c.filed_on) < state.cursor_date
        OR (
          COALESCE(c.decided_on, c.filed_on) = state.cursor_date
          AND (c.caption > state.cursor_caption OR (c.caption = state.cursor_caption AND c.id > state.cursor_id))
        )
      ))
      OR (state.passed_dates AND COALESCE(c.decided_on, c.filed_on) IS NULL AND (
        state.cursor_id IS NULL
        OR c.caption > state.cursor_caption
        OR (c.caption = state.cursor_caption AND c.id > state.cursor_id)
      ))
    )
  ORDER BY COALESCE(c.decided_on, c.filed_on) DESC NULLS LAST, c.caption, c.id
  LIMIT 500
),
corrected AS (
  UPDATE legal_case AS c
  SET filed_on = src.local_day, updated_at = c.updated_at
  FROM (
    SELECT DISTINCT ON (windowed.id)
      windowed.id,
      (ev.official_filed_at AT TIME ZONE r.time_zone)::date AS local_day
    FROM windowed
    JOIN direct_court_event ev ON ev.case_id = windowed.id
    JOIN direct_court_registry r ON r.court_code = ev.court_code
    WHERE windowed.filed_on = (ev.official_filed_at AT TIME ZONE 'UTC')::date
      AND windowed.filed_on IS DISTINCT FROM (ev.official_filed_at AT TIME ZONE r.time_zone)::date
    ORDER BY windowed.id, (ev.event_type = 'case_filed') DESC, ev.official_filed_at
  ) src
  WHERE c.id = src.id
    AND src.local_day IS NOT NULL
  RETURNING c.id
),
indexed AS (
  INSERT INTO public_case_search (case_id, public_id, search_text, refreshed_at)
  SELECT batch.id, batch.public_id,
    coalesce(concat_ws(E'\n',
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
    ), ''),
    now()
  FROM windowed batch
  WHERE NOT EXISTS (SELECT 1 FROM public_case_search search WHERE search.case_id = batch.id)
  ON CONFLICT (case_id) DO NOTHING
  RETURNING 1
),
edge AS (
  SELECT
    (SELECT count(*)::int FROM windowed) AS scanned,
    (SELECT count(*)::int FROM corrected) AS corrected,
    (SELECT count(*)::int FROM indexed) AS indexed,
    (SELECT sort_date FROM windowed ORDER BY sort_date ASC NULLS FIRST, caption DESC, id DESC LIMIT 1) AS sort_date,
    (SELECT caption FROM windowed ORDER BY sort_date ASC NULLS FIRST, caption DESC, id DESC LIMIT 1) AS caption,
    (SELECT id FROM windowed ORDER BY sort_date ASC NULLS FIRST, caption DESC, id DESC LIMIT 1) AS id
),
advanced AS (
  UPDATE search_catchup_cursor AS cursor
  SET batches = cursor.batches + 1,
      scanned = cursor.scanned + edge.scanned,
      corrected = cursor.corrected + edge.corrected,
      indexed = cursor.indexed + edge.indexed,
      cursor_date = CASE WHEN edge.scanned = 0 THEN NULL ELSE edge.sort_date END,
      cursor_caption = CASE WHEN edge.scanned = 0 THEN NULL ELSE edge.caption END,
      cursor_id = CASE WHEN edge.scanned = 0 THEN NULL ELSE edge.id END,
      passed_dates = cursor.passed_dates OR edge.scanned = 0,
      phase = CASE
        WHEN edge.scanned = 0 AND cursor.passed_dates THEN 'entries'
        ELSE cursor.phase
      END,
      updated_at = now()
  FROM edge
  WHERE cursor.singleton = 1
    AND cursor.phase = 'cases'
  RETURNING cursor.phase, edge.scanned, edge.corrected, edge.indexed,
    cursor.corrected AS corrected_total, cursor.indexed AS indexed_total
)
SELECT phase || '|' || scanned::text || '|' || corrected::text || '|' || indexed::text
  || '|' || corrected_total::text || '|' || indexed_total::text
FROM advanced;
COMMIT;
SQL
}

entry_batch() {
  psql -q -tA <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
WITH state AS (
  SELECT * FROM search_catchup_cursor WHERE singleton = 1
),
windowed AS MATERIALIZED (
  SELECT ev.id, ev.last_seen_at, ev.case_id, ev.deduplication_key, ev.official_filed_at, r.time_zone
  FROM direct_court_event ev
  JOIN direct_court_registry r ON r.court_code = ev.court_code
  CROSS JOIN state
  WHERE state.phase = 'entries'
    AND ev.case_id IS NOT NULL
    AND ev.last_seen_at IS NOT NULL
    AND (
      state.cursor_at IS NULL
      OR ev.last_seen_at < state.cursor_at
      OR (ev.last_seen_at = state.cursor_at AND ev.id < state.cursor_id)
    )
  ORDER BY ev.last_seen_at DESC, ev.id DESC
  LIMIT 500
),
corrected AS (
  UPDATE docket_entry AS entry
  SET filed_on = src.local_day, updated_at = entry.updated_at
  FROM (
    SELECT windowed.id AS event_id, entry.id,
      (windowed.official_filed_at AT TIME ZONE windowed.time_zone)::date AS local_day
    FROM windowed
    JOIN docket_entry entry
      ON entry.case_id = windowed.case_id
     AND entry.provider_entry_id = windowed.deduplication_key
    WHERE entry.filed_on = (windowed.official_filed_at AT TIME ZONE 'UTC')::date
      AND entry.filed_on IS DISTINCT FROM (windowed.official_filed_at AT TIME ZONE windowed.time_zone)::date
  ) src
  WHERE entry.id = src.id
    AND src.local_day IS NOT NULL
  RETURNING entry.id
),
edge AS (
  SELECT
    (SELECT count(*)::int FROM windowed) AS scanned,
    (SELECT count(*)::int FROM corrected) AS corrected,
    (SELECT last_seen_at FROM windowed ORDER BY last_seen_at ASC, id ASC LIMIT 1) AS cursor_at,
    (SELECT id FROM windowed ORDER BY last_seen_at ASC, id ASC LIMIT 1) AS cursor_id
),
advanced AS (
  UPDATE search_catchup_cursor AS cursor
  SET batches = cursor.batches + 1,
      scanned = cursor.scanned + edge.scanned,
      corrected = cursor.corrected + edge.corrected,
      cursor_at = CASE WHEN edge.scanned = 0 THEN NULL ELSE edge.cursor_at END,
      cursor_id = CASE WHEN edge.scanned = 0 THEN NULL ELSE edge.cursor_id END,
      phase = CASE WHEN edge.scanned = 0 THEN 'done' ELSE cursor.phase END,
      updated_at = now()
  FROM edge
  WHERE cursor.singleton = 1
    AND cursor.phase = 'entries'
  RETURNING cursor.phase, edge.scanned, edge.corrected, cursor.corrected AS corrected_total
)
SELECT phase || '|' || scanned::text || '|' || corrected::text || '|0|0|' || corrected_total::text
FROM advanced;
COMMIT;
SQL
}

echo "resuming from search_catchup_cursor"
psql -c "SELECT phase, passed_dates, batches, scanned, corrected, indexed, cursor_date, cursor_at FROM search_catchup_cursor WHERE singleton = 1;"

while true; do
  phase=$(psql -q -tA -c "SELECT phase FROM search_catchup_cursor WHERE singleton = 1;")
  phase=$(printf '%s' "$phase" | tr -d '[:space:]')
  if [ "$phase" = "done" ]; then
    echo "catch-up complete"
    break
  fi
  if [ "$phase" = "entries" ]; then
    line=$(entry_batch | tail -n 1 | tr -d '[:space:]')
  else
    line=$(case_batch | tail -n 1 | tr -d '[:space:]')
  fi
  echo "batch $line"
  case "$line" in
    *\|*) ;;
    *) echo "catch-up stopped on: ${line:-empty}" >&2; exit 1 ;;
  esac
  sleep 0.2
done

psql -c "SELECT phase, batches, scanned, corrected, indexed FROM search_catchup_cursor WHERE singleton = 1;"
