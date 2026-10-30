-- Unlogged staging for CourtListener bulk opinion-text loads (Step C of the
-- top-down federal ingestion). A chunk of already-matched federal opinions is
-- COPYed here, merged set-based into document / judicial_opinion /
-- document_content / opinion_search_projection, then truncated. Unlogged so
-- multi-megabyte opinion text chunks do not flood the WAL on the stage itself.
-- A crash empties the table; the logged ingestion_checkpoint row is the resume point.

CREATE UNLOGGED TABLE IF NOT EXISTS courtlistener_opinion_stage (
  opinion_id text NOT NULL,
  provider_cluster_id text NOT NULL,
  cluster_id uuid NOT NULL,
  case_id uuid NOT NULL,
  court_id uuid NOT NULL,
  court_name text NOT NULL,
  case_name text NOT NULL,
  case_is_draft boolean NOT NULL,
  date_filed date,
  precedential_status text,
  citation_count integer NOT NULL,
  opinion_type text NOT NULL,
  title text NOT NULL,
  author_name text,
  per_curiam boolean NOT NULL,
  download_url text,
  content_html text NOT NULL,
  content_text text NOT NULL,
  content_hash text NOT NULL,
  extraction_method text NOT NULL,
  word_count integer NOT NULL,
  document_public_id text NOT NULL,
  source_uri text NOT NULL,
  provider_metadata jsonb NOT NULL
);
