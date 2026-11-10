#!/bin/sh
# Fill public_case_search for published cases the bulk publish transaction
# skipped, and correct court filing days that were stored as the UTC day.
# Runs on the ingestion host (docker, no sudo). Safe beside the bulk job:
# short transactions, a pause between them, and no write to legal_case.updated_at.
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

correct_dates() {
  psql -q -tA <<'SQL' || echo "date correction skipped"
BEGIN;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '3s';
WITH batch AS (
  SELECT DISTINCT ON (c.id)
    c.id,
    (ev.official_filed_at AT TIME ZONE r.time_zone)::date AS local_day
  FROM direct_court_event ev
  JOIN direct_court_registry r ON r.court_code = ev.court_code
  JOIN legal_case c ON c.id = ev.case_id
  WHERE ev.event_type = 'case_filed'
    AND ev.last_seen_at >= now() - interval '3 days'
    AND c.filed_on = (ev.official_filed_at AT TIME ZONE 'UTC')::date
    AND c.filed_on IS DISTINCT FROM (ev.official_filed_at AT TIME ZONE r.time_zone)::date
  ORDER BY c.id, ev.official_filed_at
  LIMIT 500
), updated AS (
  UPDATE legal_case AS c
  SET filed_on = batch.local_day, updated_at = c.updated_at
  FROM batch
  WHERE c.id = batch.id
  RETURNING 1
)
SELECT count(*) FROM updated;
COMMIT;
SQL
}

correct_entry_dates() {
  psql -q -tA <<'SQL' || echo "entry date correction skipped"
BEGIN;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '3s';
WITH batch AS (
  SELECT e.id,
    (ev.official_filed_at AT TIME ZONE r.time_zone)::date AS local_day
  FROM direct_court_event ev
  JOIN direct_court_registry r ON r.court_code = ev.court_code
  JOIN docket_entry e
    ON e.case_id = ev.case_id
   AND e.provider_entry_id = ev.deduplication_key
  WHERE ev.last_seen_at >= now() - interval '3 days'
    AND e.filed_on = (ev.official_filed_at AT TIME ZONE 'UTC')::date
    AND e.filed_on IS DISTINCT FROM (ev.official_filed_at AT TIME ZONE r.time_zone)::date
  LIMIT 500
), updated AS (
  UPDATE docket_entry AS e
  SET filed_on = batch.local_day, updated_at = e.updated_at
  FROM batch
  WHERE e.id = batch.id
  RETURNING 1
)
SELECT count(*) FROM updated;
COMMIT;
SQL
}

search_slice() {
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

echo "correcting court-local filing dates"
round=0
while [ "$round" -lt 40 ]; do
  fixed=$(correct_dates | tail -n 1 | tr -d '[:space:]')
  entries=$(correct_entry_dates | tail -n 1 | tr -d '[:space:]')
  echo "dates cases=${fixed:-skipped} entries=${entries:-skipped}"
  round=$((round + 1))
  case "$fixed" in
    ''|*[!0-9]*) echo "date correction stopped"; break ;;
  esac
  case "$entries" in
    ''|*[!0-9]*) echo "entry date correction stopped"; break ;;
  esac
  if [ "$fixed" = "0" ] && [ "$entries" = "0" ]; then
    break
  fi
  sleep 0.2
done

echo "filling public_case_search"
added_total=0
batches=0
while [ "$batches" -lt 2000 ]; do
  added=$(search_slice | tail -n 1 | tr -d '[:space:]')
  case "$added" in
    ''|*[!0-9]*)
      echo "search catch-up stopped on: ${added:-empty}"
      break
      ;;
  esac
  added_total=$((added_total + added))
  batches=$((batches + 1))
  echo "search batch=$batches added=$added total=$added_total"
  if [ "$added" = "0" ]; then
    break
  fi
  sleep 0.2
done
echo "search catch-up done batches=$batches added=$added_total"
