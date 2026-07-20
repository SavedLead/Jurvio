BEGIN;

ALTER TABLE raw_artifact
  DROP CONSTRAINT raw_artifact_provider_id_content_hash_key;

ALTER TABLE raw_artifact
  ADD CONSTRAINT raw_artifact_provider_source_content_key
  UNIQUE (provider_id, source_uri, content_hash);

COMMIT;
