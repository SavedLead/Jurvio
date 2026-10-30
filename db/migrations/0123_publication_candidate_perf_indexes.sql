-- Speed up the deterministic federal publication candidate query at scale.
--
-- The gate's per-candidate "unresolved rejections" subquery filters OPEN rejections by
-- source_record_id. The existing ingestion_rejection_open_idx is ordered by last_seen_at
-- only, so that lookup scanned every open rejection once per candidate. Index
-- source_record_id among open rejections so it becomes a direct lookup.
--
-- (The identity-collision subquery is handled in code: it now normalizes docket_number with
-- the same expression as legal_case_normalized_docket_idx, so it reuses that index instead of
-- a full sequential scan of legal_case per candidate -- no new index needed for it here.)
--
-- Plain CREATE INDEX (not CONCURRENTLY) because ingestion_rejection is small and the build is
-- near-instant; IF NOT EXISTS keeps it idempotent / a no-op where already present.
CREATE INDEX IF NOT EXISTS ingestion_rejection_open_source_idx
  ON ingestion_rejection (source_record_id)
  WHERE resolved_at IS NULL;
