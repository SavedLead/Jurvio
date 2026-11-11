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

# -c queries must not read stdin. This file is fed to `bash -s`, and
# `docker exec -i` drains that stream to EOF, which used to skip the loop.
psql() {
  docker exec "$pg" psql -U jurvio -d jurvio -v ON_ERROR_STOP=1 -P pager=off "$@" </dev/null
}

# Heredoc SQL is this command's stdin, so -i stops at the heredoc, not at the script.
psql_sql() {
  docker exec -i "$pg" psql -U jurvio -d jurvio -v ON_ERROR_STOP=1 -P pager=off "$@"
}

psql_sql <<'SQL'
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
  # :batch_size is a psql variable. The heredoc stays quoted so the shell
  # cannot rewrite it (an unquoted $$ became the process id in the bulk job).
  psql_sql -q -tA -v batch_size="$1" <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
WITH state AS (
  SELECT * FROM search_catchup_cursor WHERE singleton = 1
),
windowed AS MATERIALIZED (
  -- legal_case_published_recency_idx is (COALESCE(decided_on, filed_on) DESC, caption, id)
  -- WHERE publication = 'published'. The date < cursor branch is a range on that
  -- index. The same-day branch is only the rows still after the checkpoint.
  SELECT page.id, page.public_id, page.caption, page.docket_number, page.official_citation,
         page.filed_on, page.sort_date
  FROM state
  CROSS JOIN LATERAL (
    SELECT picked.id, picked.public_id, picked.caption, picked.docket_number,
           picked.official_citation, picked.filed_on, picked.sort_date
    FROM (
      (
        SELECT c.id, c.public_id, c.caption, c.docket_number, c.official_citation, c.filed_on,
               COALESCE(c.decided_on, c.filed_on) AS sort_date
        FROM legal_case c
        WHERE state.phase = 'cases'
          AND NOT state.passed_dates
          AND c.publication = 'published'
          AND COALESCE(c.decided_on, c.filed_on) IS NOT NULL
          AND (
            state.cursor_id IS NULL
            OR COALESCE(c.decided_on, c.filed_on) < state.cursor_date
          )
        ORDER BY COALESCE(c.decided_on, c.filed_on) DESC NULLS LAST, c.caption, c.id
        LIMIT :batch_size
      )
      UNION ALL
      (
        SELECT c.id, c.public_id, c.caption, c.docket_number, c.official_citation, c.filed_on,
               COALESCE(c.decided_on, c.filed_on)
        FROM legal_case c
        WHERE state.phase = 'cases'
          AND NOT state.passed_dates
          AND state.cursor_id IS NOT NULL
          AND c.publication = 'published'
          AND COALESCE(c.decided_on, c.filed_on) = state.cursor_date
          AND (
            c.caption > state.cursor_caption
            OR (c.caption = state.cursor_caption AND c.id > state.cursor_id)
          )
        ORDER BY c.caption, c.id
        LIMIT :batch_size
      )
      UNION ALL
      (
        SELECT c.id, c.public_id, c.caption, c.docket_number, c.official_citation, c.filed_on,
               COALESCE(c.decided_on, c.filed_on)
        FROM legal_case c
        WHERE state.phase = 'cases'
          AND state.passed_dates
          AND c.publication = 'published'
          AND COALESCE(c.decided_on, c.filed_on) IS NULL
          AND (
            state.cursor_id IS NULL
            OR c.caption > state.cursor_caption
            OR (c.caption = state.cursor_caption AND c.id > state.cursor_id)
          )
        ORDER BY c.caption, c.id
        LIMIT :batch_size
      )
    ) picked
    ORDER BY picked.sort_date DESC NULLS LAST, picked.caption, picked.id
    LIMIT :batch_size
  ) page
),
corrected AS (
  UPDATE legal_case AS c
  SET filed_on = src.local_day, updated_at = c.updated_at
  FROM (
    SELECT DISTINCT ON (windowed.id)
      windowed.id,
      (ev.official_filed_at AT TIME ZONE court_zone.zone)::date AS local_day
    FROM windowed
    JOIN direct_court_event ev ON ev.case_id = windowed.id
    JOIN direct_court_registry r ON r.court_code = ev.court_code
    JOIN LATERAL (
      SELECT CASE
        WHEN r.time_zone <> 'UTC' THEN r.time_zone
        WHEN r.court_code IN ('akd') THEN 'America/Anchorage'
        WHEN r.court_code IN ('hid') THEN 'Pacific/Honolulu'
        WHEN r.court_code IN ('gud', 'nmid') THEN 'Pacific/Guam'
        WHEN r.court_code = 'azd' THEN 'America/Phoenix'
        WHEN r.court_code = 'idd' THEN 'America/Boise'
        WHEN r.court_code IN ('insd', 'innd') THEN 'America/Indiana/Indianapolis'
        WHEN r.court_code = 'flnd' THEN 'America/Chicago'
        WHEN r.court_code IN ('cand', 'caed', 'cacd', 'casd', 'ord', 'waed', 'wawd', 'nvd') THEN 'America/Los_Angeles'
        WHEN r.circuit IN ('09') THEN 'America/Los_Angeles'
        WHEN r.circuit IN ('10') THEN 'America/Denver'
        WHEN r.circuit IN ('05', '07', '08') THEN 'America/Chicago'
        ELSE 'America/New_York'
      END AS zone
    ) court_zone ON true
    WHERE windowed.filed_on = (ev.official_filed_at AT TIME ZONE 'UTC')::date
      AND windowed.filed_on IS DISTINCT FROM (ev.official_filed_at AT TIME ZONE court_zone.zone)::date
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
indexed_newer AS (
  INSERT INTO public_case_search (case_id, public_id, search_text, refreshed_at)
  SELECT c.id, c.public_id, coalesce(c.caption, ''), now()
  FROM legal_case c
  CROSS JOIN state
  WHERE state.cursor_date IS NOT NULL
    AND c.publication = 'published'
    AND COALESCE(c.decided_on, c.filed_on) > state.cursor_date
    AND NOT EXISTS (SELECT 1 FROM public_case_search search WHERE search.case_id = c.id)
  ORDER BY COALESCE(c.decided_on, c.filed_on) DESC NULLS LAST, c.caption, c.id
  LIMIT 100
  ON CONFLICT (case_id) DO NOTHING
  RETURNING 1
),
edge AS (
  SELECT
    (SELECT count(*)::int FROM windowed) AS scanned,
    (SELECT count(*)::int FROM corrected) AS corrected,
    (SELECT count(*)::int FROM indexed) + (SELECT count(*)::int FROM indexed_newer) AS indexed,
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
  psql_sql -q -tA -v batch_size="$1" <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
WITH state AS (
  SELECT * FROM search_catchup_cursor WHERE singleton = 1
),
windowed AS MATERIALIZED (
  SELECT ev.id, ev.last_seen_at, ev.case_id, ev.deduplication_key, ev.official_filed_at,
    CASE
      WHEN r.time_zone <> 'UTC' THEN r.time_zone
      WHEN r.court_code IN ('akd') THEN 'America/Anchorage'
      WHEN r.court_code IN ('hid') THEN 'Pacific/Honolulu'
      WHEN r.court_code IN ('gud', 'nmid') THEN 'Pacific/Guam'
      WHEN r.court_code = 'azd' THEN 'America/Phoenix'
      WHEN r.court_code = 'idd' THEN 'America/Boise'
      WHEN r.court_code IN ('insd', 'innd') THEN 'America/Indiana/Indianapolis'
      WHEN r.court_code = 'flnd' THEN 'America/Chicago'
      WHEN r.court_code IN ('cand', 'caed', 'cacd', 'casd', 'ord', 'waed', 'wawd', 'nvd') THEN 'America/Los_Angeles'
      WHEN r.circuit IN ('09') THEN 'America/Los_Angeles'
      WHEN r.circuit IN ('10') THEN 'America/Denver'
      WHEN r.circuit IN ('05', '07', '08') THEN 'America/Chicago'
      ELSE 'America/New_York'
    END AS time_zone
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
  LIMIT :batch_size
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

# Cases whose filed date is exactly one day after their earliest docket entry.
# The court registry stored many districts as UTC, so the event-zone comparison
# never moved those rows. This pass does not follow the sweep cursor, so a
# resume still corrects them. updated_at is left unchanged.
fix_recent_headers() {
  psql_sql -q -tA <<'SQL' || echo "header fix skipped"
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';
WITH recent AS (
  SELECT c.id, c.filed_on
  FROM legal_case c
  WHERE c.publication = 'published'
    AND COALESCE(c.decided_on, c.filed_on) >= CURRENT_DATE - 21
  ORDER BY COALESCE(c.decided_on, c.filed_on) DESC NULLS LAST, c.caption, c.id
  LIMIT 2000
),
shifted AS (
  SELECT recent.id, min(entry.filed_on) AS day
  FROM recent
  JOIN docket_entry entry ON entry.case_id = recent.id AND entry.filed_on IS NOT NULL
  GROUP BY recent.id, recent.filed_on
  HAVING recent.filed_on = min(entry.filed_on) + 1
),
updated AS (
  UPDATE legal_case AS c
  SET filed_on = shifted.day, updated_at = c.updated_at
  FROM shifted
  WHERE c.id = shifted.id
  RETURNING c.id
)
SELECT count(*) FROM updated;
COMMIT;
SQL
}

# A filed or decided date after today was copied from the source as written
# (CourtListener date_filed 2027-09-29 on 1:83-cv-00594). Keep the earliest
# docket entry on or before today when its year is within five years of the
# docket-number year. Otherwise clear the date. Do not invent one, and do
# not change updated_at. This does not use the sweep cursor, so a later run
# continues it. The count is an index range on legal_case_published_recency_idx.
repair_future_dates() {
  echo "future sort dates before $(psql -q -tA -c "SELECT count(*) FROM legal_case WHERE publication = 'published' AND COALESCE(decided_on, filed_on) > (timezone('America/New_York', now()))::date;")"
  rounds=0
  while true; do
    rounds=$((rounds + 1))
    if [ "$rounds" -gt 20 ]; then
      echo "future date repair paused; a later catch-up continues it"
      break
    fi
    fixed=$(psql_sql -q -tA <<'SQL' || true
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';
WITH today AS (
  SELECT (timezone('America/New_York', now()))::date AS day
),
bad AS (
  SELECT c.id
  FROM legal_case c
  CROSS JOIN today
  WHERE c.publication = 'published'
    AND (c.filed_on > today.day OR c.decided_on > today.day)
  LIMIT 200
),
chosen AS (
  SELECT bad.id,
    (
      SELECT min(entry.filed_on)
      FROM docket_entry entry, today
      WHERE entry.case_id = bad.id
        AND entry.filed_on <= today.day
        AND (
          (regexp_match(c.docket_number, ':(\d{2})-'))[1] IS NULL
          OR abs(
            EXTRACT(YEAR FROM entry.filed_on)::int
            - CASE
                WHEN (regexp_match(c.docket_number, ':(\d{2})-'))[1]::int
                  <= EXTRACT(YEAR FROM today.day)::int % 100
                THEN 2000 + (regexp_match(c.docket_number, ':(\d{2})-'))[1]::int
                ELSE 1900 + (regexp_match(c.docket_number, ':(\d{2})-'))[1]::int
              END
          ) <= 5
        )
    ) AS entry_day
  FROM bad
  JOIN legal_case c ON c.id = bad.id
),
updated AS (
  UPDATE legal_case AS c
  SET filed_on = CASE
        WHEN c.filed_on > (SELECT day FROM today) THEN chosen.entry_day
        ELSE c.filed_on
      END,
      decided_on = CASE
        WHEN c.decided_on > (SELECT day FROM today) THEN NULL
        ELSE c.decided_on
      END,
      updated_at = c.updated_at
  FROM chosen
  WHERE c.id = chosen.id
  RETURNING c.id
),
cleared_entries AS (
  UPDATE docket_entry AS entry
  SET filed_on = NULL, updated_at = entry.updated_at
  FROM bad
  WHERE entry.case_id = bad.id
    AND entry.filed_on > (SELECT day FROM today)
  RETURNING entry.id
)
SELECT count(*)::text FROM updated;
COMMIT;
SQL
)
    fixed=$(printf '%s' "$fixed" | tr -d '[:space:]')
    case "$fixed" in
      ''|*[!0-9]*) echo "future date repair skipped"; break ;;
    esac
    echo "future dates corrected this batch $fixed"
    if [ "$fixed" = "0" ]; then break; fi
  done
  echo "future sort dates after $(psql -q -tA -c "SELECT count(*) FROM legal_case WHERE publication = 'published' AND COALESCE(decided_on, filed_on) > (timezone('America/New_York', now()))::date;")"
}

repair_future_dates

echo "resuming from search_catchup_cursor"
psql -c "SELECT phase, passed_dates, batches, scanned, corrected, indexed, cursor_date, cursor_at FROM search_catchup_cursor WHERE singleton = 1;"

completed=0
batch_size=500
small_failures=0
# A backup can make every batch time out. Wait and retry instead of exiting,
# for about 3 hours, then stop only if nothing has committed.
# The defaults are the production waits. The stdin test sets them to 0 so the
# failure path returns immediately; spawnSync cannot be interrupted by the
# test timeout, and a real 300s sleep hangs the CI job until the 45-minute limit.
stall_wait=${CATCHUP_STALL_WAIT:-300}
stall_wait_cap=${CATCHUP_STALL_WAIT_CAP:-1800}
stall_limit=${CATCHUP_STALL_LIMIT:-10800}
stalled_for=0
while true; do
  phase=$(psql -q -tA -c "SELECT phase FROM search_catchup_cursor WHERE singleton = 1;")
  phase=$(printf '%s' "$phase" | tr -d '[:space:]')
  if [ "$phase" = "done" ]; then
    echo "catch-up complete"
    completed=1
    break
  fi
  if [ "$phase" = "entries" ]; then
    line=$(entry_batch "$batch_size" | tail -n 1 | tr -d '[:space:]')
  else
    # The header fix is its own transaction. Do not repeat it while a timed-out
    # case batch is being retried at a smaller size.
    if [ "$batch_size" -eq 500 ]; then
      headers=$(fix_recent_headers | tail -n 1 | tr -d '[:space:]')
      echo "recent headers corrected=${headers:-skipped}"
    fi
    line=$(case_batch "$batch_size" | tail -n 1 | tr -d '[:space:]')
  fi
  case "$line" in
    *\|*)
      echo "batch $line"
      batch_size=500
      small_failures=0
      stall_wait=${CATCHUP_STALL_WAIT:-300}
      stalled_for=0
      sleep 0.2
      ;;
    *)
      # A statement timeout prints no row. The transaction rolls back, so
      # search_catchup_cursor stays where it was.
      echo "batch failed at size ${batch_size}: ${line:-empty}" >&2
      if [ "$batch_size" -eq 500 ]; then
        batch_size=250
      elif [ "$batch_size" -eq 250 ]; then
        batch_size=100
      else
        small_failures=$((small_failures + 1))
        if [ "$small_failures" -ge 3 ]; then
          if [ "$stalled_for" -ge "$stall_limit" ]; then
            echo "catch-up stopped after ${stalled_for}s without a committed batch" >&2
            exit 1
          fi
          echo "catch-up waiting ${stall_wait}s after repeated failures at 100" >&2
          sleep "$stall_wait"
          stalled_for=$((stalled_for + stall_wait))
          if [ "$stall_wait" -lt "$stall_wait_cap" ]; then
            stall_wait=$((stall_wait * 2))
          fi
          small_failures=0
          batch_size=500
        fi
      fi
      ;;
  esac
done

if [ "$completed" != 1 ]; then
  echo "catch-up ended without completing" >&2
  exit 1
fi

psql -c "SELECT phase, batches, scanned, corrected, indexed FROM search_catchup_cursor WHERE singleton = 1;"
