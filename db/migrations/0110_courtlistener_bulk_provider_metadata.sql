-- Preserve every field the CourtListener bulk export carries, even the columns we
-- do not model as first-class relations. The raw_artifact row already stores the
-- complete parsed bulk row as JSON, but that is provenance, not queryable data.
-- provider_metadata gives the opinion_cluster and judicial_opinion rows a durable,
-- nullable jsonb home for the full parsed bulk row, so no source field is lost and
-- later enrichment can read scdb_id, headnotes, posture, ordering_key, local_path,
-- and everything else without re-reading the multi-GB bulk file.
--
-- "Save every field we can get" is the standard for all sources; this establishes
-- the column the CourtListener bulk appellate path writes on every upsert. Nullable
-- with no default so existing rows are untouched and unrelated writers stay valid.

ALTER TABLE opinion_cluster
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb;

ALTER TABLE judicial_opinion
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb;
