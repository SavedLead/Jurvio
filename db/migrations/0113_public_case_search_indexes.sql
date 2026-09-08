-- Accelerate public case searches by case caption, docket number, and party name.
-- Trigram indexes support the contains-style matching used by the public search UI.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS legal_case_caption_search_trgm_idx
  ON legal_case USING gin (caption gin_trgm_ops)
  WHERE publication = 'published';

CREATE INDEX IF NOT EXISTS legal_case_docket_search_trgm_idx
  ON legal_case USING gin (docket_number gin_trgm_ops)
  WHERE publication = 'published';

CREATE INDEX IF NOT EXISTS party_appearance_name_search_trgm_idx
  ON party_appearance USING gin (party_name_as_filed gin_trgm_ops);

CREATE INDEX IF NOT EXISTS entity_display_name_search_trgm_idx
  ON entity USING gin (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS party_appearance_case_id_idx
  ON party_appearance (case_id);

ANALYZE legal_case;
ANALYZE party_appearance;
ANALYZE entity;
