-- Load one batch of seats (COPY data follows on stdin, terminated by \.). Replaces the
-- seats of every case in the batch, so re-running is safe.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '10s';
CREATE TEMP TABLE incoming_seat (
  case_id uuid, court_id uuid, decided_on date, seat_index smallint, role text, observed_name text,
  judge_id uuid, match_status text, appointing_party text, matcher_version text
) ON COMMIT DROP;
COPY incoming_seat FROM STDIN;
