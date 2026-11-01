-- GovInfo USCOURTS as a free daily source (free-feeds plan, step 4).
--
-- govinfo_daily_state: one row; the sweep cursor over
--   /collections/USCOURTS/{since} (packages modified since `since`, newest first).
-- A sweep pages through with offset_mark; when it reaches the last page,
-- `since` moves to the newest lastModified seen in that sweep (minus an hour).
--
-- govinfo_crosscheck: one row per (package, dateIssued) the job has seen, with
-- what it found: 'matched' (another source already had an opinion/order entry
-- or document on that case within a day), 'entry' (new GovInfo entry on an
-- existing case), 'new_case' (new draft case plus entry), 'restricted',
-- 'ambiguous'. It is both the idempotency key and the per-court cross-check
-- report (how often GovInfo had something no other source had).

CREATE TABLE IF NOT EXISTS govinfo_daily_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  since timestamptz NOT NULL,
  offset_mark text,
  sweep_max_modified timestamptz,
  sweeps_completed integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS govinfo_crosscheck (
  package_id text NOT NULL,
  date_issued date NOT NULL,
  court_code text NOT NULL,
  docket_number text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('matched', 'entry', 'new_case', 'restricted', 'ambiguous')),
  case_id uuid,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (package_id, date_issued)
);

CREATE INDEX IF NOT EXISTS govinfo_crosscheck_court_seen_idx ON govinfo_crosscheck (court_code, seen_at DESC);
