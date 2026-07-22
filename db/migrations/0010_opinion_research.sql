BEGIN;

CREATE TABLE opinion_cluster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES provider(id),
  provider_cluster_id text NOT NULL,
  case_name text NOT NULL,
  date_filed date,
  precedential_status text,
  citation_count integer NOT NULL DEFAULT 0 CHECK (citation_count >= 0),
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  judges text,
  syllabus text,
  procedural_history text,
  source_artifact_id uuid NOT NULL REFERENCES raw_artifact(id),
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, provider_cluster_id)
);

CREATE TABLE judicial_opinion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES opinion_cluster(id) ON DELETE CASCADE,
  document_id uuid NOT NULL UNIQUE REFERENCES document(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES provider(id),
  provider_opinion_id text NOT NULL,
  opinion_type text NOT NULL,
  author_name text,
  per_curiam boolean NOT NULL DEFAULT false,
  source_download_url text,
  source_artifact_id uuid NOT NULL REFERENCES raw_artifact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, provider_opinion_id)
);

CREATE TABLE document_content (
  document_id uuid PRIMARY KEY REFERENCES document(id) ON DELETE CASCADE,
  content_html text NOT NULL,
  content_text text NOT NULL,
  content_hash text NOT NULL,
  extraction_method text NOT NULL,
  word_count integer NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  source_artifact_id uuid NOT NULL REFERENCES raw_artifact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE opinion_search_projection (
  document_id uuid PRIMARY KEY REFERENCES document(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  court_id uuid NOT NULL REFERENCES court(id),
  cluster_id uuid NOT NULL REFERENCES opinion_cluster(id) ON DELETE CASCADE,
  title text NOT NULL,
  case_caption text NOT NULL,
  court_name text NOT NULL,
  date_filed date,
  precedential_status text,
  opinion_type text NOT NULL,
  citation_count integer NOT NULL DEFAULT 0 CHECK (citation_count >= 0),
  body text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(case_caption, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) STORED,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX opinion_cluster_case_date_idx
  ON opinion_cluster (case_id, date_filed DESC NULLS LAST);
CREATE INDEX opinion_cluster_citation_count_idx
  ON opinion_cluster (citation_count DESC);
CREATE INDEX judicial_opinion_cluster_idx ON judicial_opinion (cluster_id);
CREATE INDEX opinion_search_projection_vector_idx
  ON opinion_search_projection USING gin (search_vector);
CREATE INDEX opinion_search_projection_filters_idx
  ON opinion_search_projection (court_id, date_filed DESC NULLS LAST, citation_count DESC);
CREATE INDEX publication_decision_latest_idx
  ON publication_decision (object_type, object_id, decided_at DESC, id DESC)
  INCLUDE (displayable, indexable);

COMMIT;
