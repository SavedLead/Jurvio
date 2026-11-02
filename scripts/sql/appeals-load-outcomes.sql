\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '10s';
CREATE TEMP TABLE incoming_outcome (case_id uuid, outcome text, source text, quote text, rule_version text) ON COMMIT DROP;
COPY incoming_outcome FROM STDIN;
