-- Supreme Court justice analytics: data foundation.
--
-- Sources (see data/README.md for URLs, versions, checksums and citation rules):
--   * Supreme Court Database (SCDB), Washington University / Penn State:
--     Modern (1946+) and Legacy (1791-1945) justice-centered releases.
--   * Martin-Quinn justice ideal points (Martin & Quinn), by term.
--   * Federal Judicial Center Biographical Directory for justice biography and
--     appointment facts (already the source of judge / judge_service_term).
--
-- Labeling rule: every liberal/conservative value here is the SCDB's own coding
-- ("liberal/conservative as coded by the Supreme Court Database") or a
-- Martin-Quinn score. Nothing in this schema maps justices or votes to a
-- political party.
--
-- Rows are loaded only by scripts/import-scdb.ts from the published files; no
-- value is inferred. SCDB cases link to Jurvio's legal_case rows by U.S. Reports
-- citation, then docket number + decision date (match_method records which).

BEGIN;

CREATE TABLE scotus_dataset_release (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL CHECK (source_system IN ('scdb_modern', 'scdb_legacy', 'martin_quinn', 'fjc', 'scdb_codebook')),
  version text NOT NULL,
  file_name text NOT NULL,
  source_url text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer NOT NULL CHECK (row_count >= 0),
  citation_text text NOT NULL,
  license_note text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, version, file_name)
);

-- Code labels copied verbatim from the SCDB online codebook
-- (https://scdb.la.psu.edu/online-codebook/). Used by the views below so the
-- UI never re-types a label.
CREATE TABLE scdb_code_label (
  variable text NOT NULL,
  code smallint NOT NULL,
  label text NOT NULL,
  source_url text NOT NULL,
  PRIMARY KEY (variable, code)
);

INSERT INTO scdb_code_label (variable, code, label, source_url) VALUES
  ('vote', 1, 'voted with majority or plurality', 'https://scdb.la.psu.edu/online-codebook/the-vote-in-the-case/'),
  ('vote', 2, 'dissent', 'https://scdb.la.psu.edu/online-codebook/the-vote-in-the-case/'),
  ('vote', 3, 'regular concurrence', 'https://scdb.la.psu.edu/online-codebook/the-vote-in-the-case/'),
  ('vote', 4, 'special concurrence', 'https://scdb.la.psu.edu/online-codebook/the-vote-in-the-case/'),
  ('vote', 5, 'judgment of the Court', 'https://scdb.la.psu.edu/online-codebook/the-vote-in-the-case/'),
  ('vote', 6, 'dissent from a denial or dismissal of certiorari, or dissent from summary affirmation of an appeal', 'https://scdb.la.psu.edu/online-codebook/the-vote-in-the-case/'),
  ('vote', 7, 'jurisdictional dissent', 'https://scdb.la.psu.edu/online-codebook/the-vote-in-the-case/'),
  ('vote', 8, 'justice participated in an equally divided vote', 'https://scdb.la.psu.edu/online-codebook/the-vote-in-the-case/'),
  ('opinion', 1, 'justice wrote no opinion', 'https://scdb.la.psu.edu/online-codebook/opinion/'),
  ('opinion', 2, 'justice wrote an opinion', 'https://scdb.la.psu.edu/online-codebook/opinion/'),
  ('opinion', 3, 'justice co-authored an opinion', 'https://scdb.la.psu.edu/online-codebook/opinion/'),
  ('direction', 1, 'conservative', 'https://scdb.la.psu.edu/online-codebook/direction-of-the-individual-justices-votes/'),
  ('direction', 2, 'liberal', 'https://scdb.la.psu.edu/online-codebook/direction-of-the-individual-justices-votes/'),
  ('majority', 1, 'dissent', 'https://scdb.la.psu.edu/online-codebook/majority-and-minority-voting-by-justice/'),
  ('majority', 2, 'majority', 'https://scdb.la.psu.edu/online-codebook/majority-and-minority-voting-by-justice/'),
  ('decisionDirection', 1, 'conservative', 'https://scdb.la.psu.edu/online-codebook/decision-direction/'),
  ('decisionDirection', 2, 'liberal', 'https://scdb.la.psu.edu/online-codebook/decision-direction/'),
  ('decisionDirection', 3, 'unspecifiable', 'https://scdb.la.psu.edu/online-codebook/decision-direction/'),
  ('decisionType', 1, 'opinion of the court (orally argued)', 'https://scdb.la.psu.edu/online-codebook/decision-type/'),
  ('decisionType', 2, 'per curiam (no oral argument)', 'https://scdb.la.psu.edu/online-codebook/decision-type/'),
  ('decisionType', 4, 'decrees', 'https://scdb.la.psu.edu/online-codebook/decision-type/'),
  ('decisionType', 5, 'equally divided vote', 'https://scdb.la.psu.edu/online-codebook/decision-type/'),
  ('decisionType', 6, 'per curiam (orally argued)', 'https://scdb.la.psu.edu/online-codebook/decision-type/'),
  ('decisionType', 7, 'judgment of the Court (orally argued)', 'https://scdb.la.psu.edu/online-codebook/decision-type/'),
  ('decisionType', 8, 'seriatim', 'https://scdb.la.psu.edu/online-codebook/decision-type/'),
  ('issueArea', 1, 'Criminal Procedure', 'https://scdb.la.psu.edu/online-codebook/issue-area/'),
  ('issueArea', 2, 'Civil Rights', 'https://scdb.la.psu.edu/online-codebook/issue-area/'),
  ('issueArea', 3, 'First Amendment', 'https://scdb.la.psu.edu/online-codebook/issue-area/'),
  ('issueArea', 4, 'Due Process', 'https://scdb.la.psu.edu/online-codebook/issue-area/'),
  ('issueArea', 5, 'Privacy', 'https://scdb.la.psu.edu/online-codebook/issue-area/'),
  ('issueArea', 6, 'Attorneys', 'https://scdb.la.psu.edu/online-codebook/issue-area/'),
  ('issueArea', 7, 'Unions', 'https://scdb.la.psu.edu/online-codebook/issue-area/'),
  ('issueArea', 8, 'Economic Activity', 'https://scdb.la.psu.edu/online-codebook/issue-area/'),
  ('issueArea', 9, 'Judicial Power', 'https://scdb.la.psu.edu/online-codebook/issue-area/'),
  ('issueArea', 10, 'Federalism', 'https://scdb.la.psu.edu/online-codebook/issue-area/'),
  ('issueArea', 11, 'Interstate Relations', 'https://scdb.la.psu.edu/online-codebook/issue-area/'),
  ('issueArea', 12, 'Federal Taxation', 'https://scdb.la.psu.edu/online-codebook/issue-area/'),
  ('issueArea', 13, 'Miscellaneous', 'https://scdb.la.psu.edu/online-codebook/issue-area/'),
  ('issueArea', 14, 'Private Action', 'https://scdb.la.psu.edu/online-codebook/issue-area/');

-- One row per SCDB justice id (1-118 as of SCDB 2026 Release 01). Promotions to
-- Chief Justice keep one SCDB id; John Rutledge and Charles Evans Hughes each
-- have two SCDB ids because their service was not continuous.
CREATE TABLE scotus_justice (
  scdb_justice_id smallint PRIMARY KEY CHECK (scdb_justice_id > 0),
  scdb_code text NOT NULL UNIQUE,
  scdb_name text NOT NULL,
  display_name text NOT NULL,
  judge_id uuid REFERENCES judge(id) ON DELETE SET NULL,
  fjc_nid text,
  scdb_service_start date NOT NULL,
  scdb_service_end date,
  birth_date date,
  birth_year smallint,
  birth_place text,
  death_date date,
  death_year smallint,
  death_place text,
  bio_source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scdb_service_end IS NULL OR scdb_service_end >= scdb_service_start)
);
CREATE INDEX scotus_justice_fjc_nid_idx ON scotus_justice (fjc_nid);
CREATE INDEX scotus_justice_judge_idx ON scotus_justice (judge_id);

-- FJC Supreme Court appointment rows (Associate / Chief), appointing president,
-- Senate action and how service ended. Party of the appointing president is
-- deliberately not copied here.
CREATE TABLE scotus_justice_appointment (
  fjc_nid text NOT NULL,
  fjc_sequence smallint NOT NULL,
  scdb_justice_id smallint NOT NULL REFERENCES scotus_justice(scdb_justice_id) ON DELETE CASCADE,
  appointment_title text,
  appointing_president text,
  nomination_date date,
  confirmation_date date,
  commission_date date,
  recess_appointment_date date,
  senate_vote_type text,
  senate_vote text,
  termination_reason text,
  termination_date date,
  source_url text NOT NULL,
  PRIMARY KEY (fjc_nid, fjc_sequence)
);
CREATE INDEX scotus_justice_appointment_justice_idx ON scotus_justice_appointment (scdb_justice_id, commission_date);

-- One row per SCDB case (dispute), from the citation-organized justice-centered
-- file (ANALU=0): consolidated dockets and multiple issues are counted once, the
-- unit SCDB recommends for vote analysis.
CREATE TABLE scdb_case (
  scdb_case_id text PRIMARY KEY CHECK (scdb_case_id ~ '^[0-9]{4}-[0-9]{3}$'),
  release_id uuid NOT NULL REFERENCES scotus_dataset_release(id),
  era text NOT NULL CHECK (era IN ('modern', 'legacy')),
  term smallint NOT NULL CHECK (term BETWEEN 1789 AND 2200),
  decided_on date,
  decision_type smallint,
  us_cite text,
  sct_cite text,
  led_cite text,
  lexis_cite text,
  docket text,
  case_name text NOT NULL,
  natural_court smallint,
  chief text,
  argued_on date,
  reargued_on date,
  issue integer,
  issue_area smallint CHECK (issue_area BETWEEN 1 AND 14),
  decision_direction smallint CHECK (decision_direction IN (1, 2, 3)),
  decision_direction_dissent smallint,
  case_disposition smallint,
  party_winning smallint,
  precedent_alteration smallint,
  declaration_uncon smallint,
  maj_opin_writer smallint REFERENCES scotus_justice(scdb_justice_id),
  maj_opin_assigner smallint REFERENCES scotus_justice(scdb_justice_id),
  split_vote smallint,
  maj_votes smallint,
  min_votes smallint,
  legal_case_id uuid REFERENCES legal_case(id) ON DELETE SET NULL,
  match_method text CHECK (match_method IN ('us_cite', 'docket_and_date', 'docket_and_term')),
  match_candidates smallint,
  matched_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((legal_case_id IS NULL) = (match_method IS NULL))
);
CREATE INDEX scdb_case_term_idx ON scdb_case (term, decided_on);
CREATE INDEX scdb_case_legal_case_idx ON scdb_case (legal_case_id) WHERE legal_case_id IS NOT NULL;
CREATE INDEX scdb_case_close_idx ON scdb_case (term) WHERE maj_votes = 5 AND min_votes = 4;

COMMENT ON COLUMN scdb_case.decision_direction IS
  'Decision direction as coded by the Supreme Court Database: 1 conservative, 2 liberal, 3 unspecifiable.';

-- Every docket SCDB lists for a case (docket-organized file). A consolidated
-- case has several dockets and each can link to its own Jurvio legal_case.
CREATE TABLE scdb_case_docket (
  scdb_docket_id text PRIMARY KEY CHECK (scdb_docket_id ~ '^[0-9]{4}-[0-9]{3}-[0-9]{2}$'),
  scdb_case_id text NOT NULL REFERENCES scdb_case(scdb_case_id) ON DELETE CASCADE,
  docket text,
  case_name text,
  us_cite text,
  decided_on date,
  legal_case_id uuid REFERENCES legal_case(id) ON DELETE SET NULL,
  match_method text CHECK (match_method IN ('us_cite', 'docket_and_date', 'docket_and_term')),
  match_candidates smallint,
  CHECK ((legal_case_id IS NULL) = (match_method IS NULL))
);
CREATE INDEX scdb_case_docket_case_idx ON scdb_case_docket (scdb_case_id);
CREATE INDEX scdb_case_docket_legal_case_idx ON scdb_case_docket (legal_case_id) WHERE legal_case_id IS NOT NULL;

-- One row per justice per case. NULL vote/majority/direction mean the SCDB has
-- no value (non-participation, or direction unspecifiable).
CREATE TABLE scdb_vote (
  scdb_case_id text NOT NULL REFERENCES scdb_case(scdb_case_id) ON DELETE CASCADE,
  scdb_justice_id smallint NOT NULL REFERENCES scotus_justice(scdb_justice_id),
  scdb_vote_id text NOT NULL UNIQUE,
  vote smallint CHECK (vote BETWEEN 1 AND 8),
  opinion smallint CHECK (opinion BETWEEN 1 AND 3),
  direction smallint CHECK (direction IN (1, 2)),
  majority smallint CHECK (majority IN (1, 2)),
  first_agreement smallint REFERENCES scotus_justice(scdb_justice_id),
  second_agreement smallint REFERENCES scotus_justice(scdb_justice_id),
  PRIMARY KEY (scdb_case_id, scdb_justice_id)
);
CREATE INDEX scdb_vote_justice_idx ON scdb_vote (scdb_justice_id, scdb_case_id);

COMMENT ON COLUMN scdb_vote.direction IS
  'Direction of the justice''s vote as coded by the Supreme Court Database: 1 conservative, 2 liberal.';

-- Martin-Quinn ideal points by term (posterior summaries as published).
CREATE TABLE martin_quinn_score (
  term smallint NOT NULL CHECK (term BETWEEN 1900 AND 2200),
  scdb_justice_id smallint NOT NULL REFERENCES scotus_justice(scdb_justice_id),
  release_id uuid NOT NULL REFERENCES scotus_dataset_release(id),
  post_mn numeric(8, 4) NOT NULL,
  post_sd numeric(8, 4),
  post_med numeric(8, 4),
  post_025 numeric(8, 4),
  post_975 numeric(8, 4),
  PRIMARY KEY (term, scdb_justice_id)
);

COMMENT ON TABLE martin_quinn_score IS
  'Martin-Quinn scores (Martin & Quinn 2002, Political Analysis 10:134-153). Higher = more conservative on the Martin-Quinn scale; label as Martin-Quinn, never by party.';

-- ---------------------------------------------------------------------------
-- Precomputed analytics. Materialized views are refreshed by
-- scripts/import-scdb.ts after each import (REFRESH ... CONCURRENTLY needs the
-- unique indexes below). key 0 = "all" for term_key / issue_area_key.
-- scope 'all' = every SCDB case; 'argued' = decisionType 1, 6, 7 (orally argued
-- signed opinions, per curiam after argument, judgments of the Court), the
-- subset most published Supreme Court statistics use.
-- ---------------------------------------------------------------------------

CREATE MATERIALIZED VIEW scotus_justice_direction_mv AS
WITH v AS (
  SELECT v.scdb_justice_id, c.term, c.issue_area, v.direction, scope.scope
  FROM scdb_vote v
  JOIN scdb_case c ON c.scdb_case_id = v.scdb_case_id
  CROSS JOIN LATERAL (VALUES ('all'), ('argued')) AS scope(scope)
  WHERE v.direction IS NOT NULL
    AND (scope.scope = 'all' OR c.decision_type IN (1, 6, 7))
)
SELECT scope,
       scdb_justice_id,
       CASE WHEN GROUPING(term) = 1 THEN 0 ELSE term END::smallint AS term_key,
       CASE WHEN GROUPING(issue_area) = 1 THEN 0 ELSE coalesce(issue_area, -1) END::smallint AS issue_area_key,
       count(*)::integer AS votes_with_direction,
       count(*) FILTER (WHERE direction = 2)::integer AS scdb_liberal_votes,
       count(*) FILTER (WHERE direction = 1)::integer AS scdb_conservative_votes,
       round(count(*) FILTER (WHERE direction = 2)::numeric / count(*), 4) AS scdb_liberal_share,
       round(count(*) FILTER (WHERE direction = 1)::numeric / count(*), 4) AS scdb_conservative_share
FROM v
GROUP BY GROUPING SETS (
  (scope, scdb_justice_id),
  (scope, scdb_justice_id, term),
  (scope, scdb_justice_id, issue_area),
  (scope, scdb_justice_id, term, issue_area)
);
CREATE UNIQUE INDEX scotus_justice_direction_mv_key
  ON scotus_justice_direction_mv (scope, scdb_justice_id, term_key, issue_area_key);
COMMENT ON MATERIALIZED VIEW scotus_justice_direction_mv IS
  'Share of each justice''s votes that are liberal / conservative as coded by the Supreme Court Database. term_key 0 = all terms; issue_area_key 0 = all issue areas, -1 = SCDB issue area missing.';

-- Two justices agree when both are in the majority or both dissent (SCDB
-- "majority" variable). Cases where either did not participate (NULL) are left out.
CREATE MATERIALIZED VIEW scotus_justice_pair_agreement_mv AS
WITH v AS (
  SELECT v.scdb_case_id, v.scdb_justice_id, v.majority, c.term, c.decision_type
  FROM scdb_vote v JOIN scdb_case c ON c.scdb_case_id = v.scdb_case_id
  WHERE v.majority IS NOT NULL
), pairs AS (
  SELECT scope.scope, a.term, a.scdb_justice_id AS justice_a, b.scdb_justice_id AS justice_b,
         (a.majority = b.majority) AS agreed
  FROM v a
  JOIN v b ON b.scdb_case_id = a.scdb_case_id AND b.scdb_justice_id > a.scdb_justice_id
  CROSS JOIN LATERAL (VALUES ('all'), ('argued')) AS scope(scope)
  WHERE scope.scope = 'all' OR a.decision_type IN (1, 6, 7)
)
SELECT scope, justice_a, justice_b,
       CASE WHEN GROUPING(term) = 1 THEN 0 ELSE term END::smallint AS term_key,
       count(*)::integer AS cases_together,
       count(*) FILTER (WHERE agreed)::integer AS cases_agreed,
       round(count(*) FILTER (WHERE agreed)::numeric / count(*), 4) AS agreement_rate
FROM pairs
GROUP BY GROUPING SETS ((scope, justice_a, justice_b), (scope, justice_a, justice_b, term));
CREATE UNIQUE INDEX scotus_justice_pair_agreement_mv_key
  ON scotus_justice_pair_agreement_mv (scope, justice_a, justice_b, term_key);
CREATE INDEX scotus_justice_pair_agreement_mv_term_idx
  ON scotus_justice_pair_agreement_mv (scope, term_key, agreement_rate DESC);

-- Per-case vote breakdown with labels, ready for a case or justice page.
CREATE VIEW scotus_case_vote_breakdown_v AS
SELECT c.scdb_case_id, c.term, c.decided_on, c.case_name, c.us_cite, c.docket,
       c.legal_case_id, c.match_method,
       c.maj_votes, c.min_votes,
       CASE WHEN c.maj_votes IS NOT NULL AND c.min_votes IS NOT NULL THEN c.maj_votes || '-' || c.min_votes END AS vote_split,
       c.decision_type, dt.label AS decision_type_label,
       c.issue_area, ia.label AS issue_area_label,
       c.decision_direction, dd.label AS scdb_decision_direction_label,
       c.maj_opin_writer, w.display_name AS majority_opinion_writer,
       (SELECT array_agg(j.scdb_code ORDER BY j.scdb_justice_id) FROM scdb_vote v JOIN scotus_justice j USING (scdb_justice_id)
         WHERE v.scdb_case_id = c.scdb_case_id AND v.majority = 2) AS majority_justices,
       (SELECT array_agg(j.scdb_code ORDER BY j.scdb_justice_id) FROM scdb_vote v JOIN scotus_justice j USING (scdb_justice_id)
         WHERE v.scdb_case_id = c.scdb_case_id AND v.majority = 1) AS dissenting_justices,
       (SELECT jsonb_agg(jsonb_build_object(
                 'scdbJusticeId', j.scdb_justice_id, 'code', j.scdb_code, 'name', j.display_name,
                 'vote', v.vote, 'voteLabel', vl.label,
                 'opinion', v.opinion, 'opinionLabel', ol.label,
                 'majority', v.majority, 'majorityLabel', ml.label,
                 'scdbDirection', v.direction, 'scdbDirectionLabel', dl.label,
                 'firstAgreement', v.first_agreement, 'secondAgreement', v.second_agreement)
               ORDER BY j.scdb_justice_id)
          FROM scdb_vote v
          JOIN scotus_justice j USING (scdb_justice_id)
          LEFT JOIN scdb_code_label vl ON vl.variable = 'vote' AND vl.code = v.vote
          LEFT JOIN scdb_code_label ol ON ol.variable = 'opinion' AND ol.code = v.opinion
          LEFT JOIN scdb_code_label ml ON ml.variable = 'majority' AND ml.code = v.majority
          LEFT JOIN scdb_code_label dl ON dl.variable = 'direction' AND dl.code = v.direction
         WHERE v.scdb_case_id = c.scdb_case_id) AS votes
FROM scdb_case c
LEFT JOIN scotus_justice w ON w.scdb_justice_id = c.maj_opin_writer
LEFT JOIN scdb_code_label dt ON dt.variable = 'decisionType' AND dt.code = c.decision_type
LEFT JOIN scdb_code_label ia ON ia.variable = 'issueArea' AND ia.code = c.issue_area
LEFT JOIN scdb_code_label dd ON dd.variable = 'decisionDirection' AND dd.code = c.decision_direction;

-- 5-4 decisions (SCDB majVotes = 5, minVotes = 4) with both coalitions.
CREATE VIEW scotus_five_four_decision_v AS
SELECT scdb_case_id, term, decided_on, case_name, us_cite, legal_case_id,
       decision_type, issue_area, issue_area_label, decision_direction, scdb_decision_direction_label,
       maj_opin_writer, majority_opinion_writer,
       majority_justices AS majority_coalition,
       dissenting_justices AS dissenting_coalition
FROM scotus_case_vote_breakdown_v
WHERE maj_votes = 5 AND min_votes = 4;

-- How often each exact five-justice majority formed, by term.
CREATE VIEW scotus_five_four_coalition_v AS
SELECT term, majority_coalition,
       count(*)::integer AS decisions,
       count(*) FILTER (WHERE decision_direction = 2)::integer AS scdb_liberal_decisions,
       count(*) FILTER (WHERE decision_direction = 1)::integer AS scdb_conservative_decisions,
       count(*) FILTER (WHERE decision_direction = 3)::integer AS scdb_unspecifiable_decisions
FROM scotus_five_four_decision_v
WHERE majority_coalition IS NOT NULL
GROUP BY term, majority_coalition;

COMMIT;
