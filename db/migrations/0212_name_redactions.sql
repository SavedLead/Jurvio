-- Privacy redactions. The court record stays in raw artifacts. Public text,
-- the search projection, and the sitemap use the initials instead. Requester
-- contact is stored for the request and is not selected by any public query.

CREATE TABLE IF NOT EXISTS redaction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_label text NOT NULL CHECK (length(requester_label) BETWEEN 1 AND 200),
  requester_contact text,
  subject_names text[] NOT NULL,
  scope text NOT NULL CHECK (scope IN ('cases', 'documents', 'all')),
  scope_ids text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('received', 'applied', 'declined')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

CREATE TABLE IF NOT EXISTS name_redactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES redaction_requests(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 3 AND 200),
  initials text NOT NULL CHECK (initials ~ '^[A-Z](\.[A-Z]\.)+$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS name_redactions_active_idx ON name_redactions (active) WHERE active;

CREATE TABLE IF NOT EXISTS redaction_hits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  redaction_id uuid NOT NULL REFERENCES name_redactions(id) ON DELETE CASCADE,
  case_id uuid REFERENCES legal_case(id) ON DELETE CASCADE,
  document_id uuid REFERENCES document(id) ON DELETE CASCADE,
  path text NOT NULL CHECK (length(path) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (redaction_id, path)
);

CREATE INDEX IF NOT EXISTS redaction_hits_case_idx ON redaction_hits (case_id);

-- Same replacement the TypeScript renderer uses: given name then surname,
-- surname-first, an optional middle initial, and a possessive.
CREATE OR REPLACE FUNCTION redact_one_name(input text, full_name text, initials text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parts text[];
  first_name text;
  last_name text;
  result text := input;
BEGIN
  IF input IS NULL OR btrim(full_name) = '' THEN
    RETURN input;
  END IF;
  parts := regexp_split_to_array(btrim(full_name), '\s+');
  IF cardinality(parts) < 2 THEN
    RETURN input;
  END IF;
  first_name := parts[1];
  last_name := parts[cardinality(parts)];
  result := regexp_replace(result, '\m' || first_name || '(?:\s+[A-Za-z]\.?)?\s+' || last_name || '(?![A-Za-z])[''’]s', initials || '''s', 'gi');
  result := regexp_replace(result, '\m' || first_name || '(?:\s+[A-Za-z]\.?)?\s+' || last_name || '(?![A-Za-z])', initials, 'gi');
  result := regexp_replace(result, '\m' || last_name || ',\s+' || first_name || '(?:\s+[A-Za-z]\.?)?(?![A-Za-z])[''’]s', initials || '''s', 'gi');
  result := regexp_replace(result, '\m' || last_name || ',\s+' || first_name || '(?:\s+[A-Za-z]\.?)?(?![A-Za-z])', initials, 'gi');
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION redact_public_text(input text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  rule record;
  result text := input;
BEGIN
  IF input IS NULL OR input = '' THEN
    RETURN input;
  END IF;
  FOR rule IN SELECT full_name, initials FROM name_redactions WHERE active ORDER BY length(full_name) DESC LOOP
    result := redact_one_name(result, rule.full_name, rule.initials);
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION redact_opinion_search_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.case_caption := redact_public_text(NEW.case_caption);
  NEW.title := redact_public_text(NEW.title);
  NEW.body := redact_public_text(NEW.body);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opinion_search_projection_redact ON opinion_search_projection;
CREATE TRIGGER opinion_search_projection_redact
BEFORE INSERT OR UPDATE OF case_caption, title, body ON opinion_search_projection
FOR EACH ROW
EXECUTE FUNCTION redact_opinion_search_projection();
