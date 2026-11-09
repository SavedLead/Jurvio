-- A metadata publish commits the case row and its display decision only.
-- Search-index refresh and citation requeue wait for a later pass when the
-- session sets jurvio.defer_search_refresh. The visibility mirror is written
-- by the batch itself.

CREATE OR REPLACE FUNCTION publication_decision_search_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_type text := COALESCE(NEW.object_type, OLD.object_type);
  target_id uuid := COALESCE(NEW.object_id, OLD.object_id);
BEGIN
  IF target_type NOT IN ('legal_case', 'document') THEN
    RETURN NULL;
  END IF;
  IF coalesce(current_setting('jurvio.defer_search_refresh', true), '') = 'on' THEN
    RETURN NULL;
  END IF;

  DELETE FROM publication_current
  WHERE object_type = target_type AND object_id = target_id;

  INSERT INTO publication_current (object_type, object_id, displayable, decided_at, decision_id)
  SELECT decision.object_type, decision.object_id, decision.displayable, decision.decided_at, decision.id
  FROM publication_decision decision
  WHERE decision.object_type = target_type
    AND decision.object_id = target_id
  ORDER BY decision.decided_at DESC, decision.id DESC
  LIMIT 1;

  IF target_type = 'document' THEN
    PERFORM refresh_opinion_search_meta_visibility(NULL, target_id);
  ELSE
    PERFORM refresh_opinion_search_meta_visibility(target_id, NULL);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION legal_case_search_visibility_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('jurvio.defer_search_refresh', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM refresh_opinion_search_meta_visibility(NEW.id, NULL);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION citation_dirty_on_case_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('jurvio.defer_search_refresh', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM mark_citation_dirty(NEW.id, 3::smallint);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION citation_dirty_on_decision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  IF coalesce(current_setting('jurvio.defer_search_refresh', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF NEW.object_type = 'legal_case' THEN
    SELECT id INTO target FROM legal_case WHERE id = NEW.object_id AND publication = 'published';
    IF target IS NOT NULL THEN PERFORM mark_citation_dirty(target, 3::smallint); END IF;
  ELSIF NEW.object_type = 'document' THEN
    SELECT d.case_id INTO target FROM document d WHERE d.id = NEW.object_id AND d.publication = 'published';
    IF target IS NOT NULL THEN PERFORM mark_citation_dirty(target, 1::smallint); END IF;
  END IF;
  RETURN NULL;
END $$;
