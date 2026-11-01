-- Fixture for tests/publish-tiers-1-2.integration.test.ts.
-- Expected publishable: tier 1 = 2 (t1-scotus-ok, t1-ca2-cited), tier 2 = 2 (t2-ok, t2-text-hold).
INSERT INTO provider (code, name, base_url) VALUES ('tiers_fixture', 'Tiers fixture', 'https://example.test') ON CONFLICT DO NOTHING;
INSERT INTO raw_artifact (provider_id, source_uri, content_hash, object_key, media_type, retrieved_at)
SELECT id, 'https://example.test/a', repeat('a', 64), 'tiers-fixture', 'application/json', now() FROM provider WHERE code = 'tiers_fixture';
INSERT INTO court (public_id, name, jurisdiction, provider_court_id, verification) VALUES
  ('tc-ca2', 'Second Circuit', 'F', 'tiers-ca2', 'verified'),
  ('tc-nysd', 'S.D.N.Y.', 'FD', 'tiers-nysd', 'verified'),
  ('tc-unv', 'Unverified District', 'FD', 'tiers-unv', 'not_verified');
INSERT INTO court (public_id, name, provider_court_id, verification)
SELECT 'tc-scotus', 'Supreme Court', 'scotus', 'not_verified'
 WHERE NOT EXISTS (SELECT 1 FROM court WHERE provider_court_id = 'scotus');
CREATE TEMP TABLE fx (public_id text, court text, docket text, caption text, filed date, pub text, verif text);
INSERT INTO fx VALUES
  ('t1-scotus-ok',   'tc-scotus', '19-100', 'Alpha v. Beta',     NULL,               'draft',      'not_verified'),
  ('t1-scotus-dup',  'tc-scotus', '18-200', 'Gamma v. Delta',    NULL,               'draft',      'not_verified'),
  ('scotus-live',    'tc-scotus', '18 200', 'Gamma v. Delta',    NULL,               'published',  'verified'),
  ('t1-ca2-cited',   'tc-ca2',    '20-300', 'Epsilon v. Zeta',   date '1995-01-01',  'draft',      'not_verified'),
  ('t2-ok',          'tc-nysd',   '1:26-cv-1', 'Eta v. Theta',   current_date - 10,  'draft',      'not_verified'),
  ('t2-sealed',      'tc-nysd',   '1:26-cv-2', 'Sealed v. Doe',  current_date - 10,  'draft',      'not_verified'),
  ('t2-review',      'tc-nysd',   '1:26-cv-3', 'Iota v. Kappa',  current_date - 10,  'draft',      'needs_review'),
  ('t2-unverified',  'tc-unv',    '1:26-cv-4', 'Lambda v. Mu',   current_date - 10,  'draft',      'not_verified'),
  ('t3-untouched',   'tc-nysd',   '1:15-cv-5', 'Nu v. Xi',       date '2015-05-05',  'draft',      'not_verified'),
  ('t2-restricted',  'tc-nysd',   '1:26-cv-6', 'Omicron v. Pi',  current_date - 10,  'restricted', 'not_verified'),
  ('t2-nondisplay',  'tc-nysd',   '1:26-cv-7', 'Rho v. Sigma',   current_date - 10,  'draft',      'not_verified'),
  ('t2-other-hold',  'tc-nysd',   '1:26-cv-8', 'Tau v. Upsilon', current_date - 10,  'draft',      'not_verified'),
  ('t2-text-hold',   'tc-nysd',   '1:26-cv-9', 'Phi v. Chi',     current_date - 10,  'draft',      'not_verified'),
  ('old-thin',       'tc-nysd',   '1:90-cv-1', 'Psi v. Omega',   date '1990-01-01',  'draft',      'not_verified');
INSERT INTO legal_case (public_id, court_id, docket_number, caption, filed_on, publication, verification)
SELECT fx.public_id, court.id, fx.docket, fx.caption, fx.filed, fx.pub::publication_state, fx.verif::verification_state
  FROM fx JOIN court ON (fx.court = 'tc-scotus' AND court.id = (SELECT min(id::text)::uuid FROM court WHERE provider_court_id = 'scotus'))
                    OR (fx.court <> 'tc-scotus' AND court.public_id = fx.court);
INSERT INTO opinion_cluster (public_id, case_id, provider_id, provider_cluster_id, case_name, source_artifact_id)
SELECT 'oc-' || lc.public_id, lc.id, p.id, lc.public_id, lc.caption, a.id
  FROM legal_case lc, provider p, raw_artifact a
 WHERE lc.public_id IN ('t1-scotus-ok', 't1-scotus-dup', 'scotus-live') AND p.code = 'tiers_fixture' AND a.object_key = 'tiers-fixture';
INSERT INTO case_citation_count (case_id, cited, cited_on_jurvio, cited_by)
SELECT id, 0, 0, 3 FROM legal_case WHERE public_id = 't1-ca2-cited';
INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
SELECT 'legal_case', id, false, false, false, false, false, 'fixture_hidden', 'fixture' FROM legal_case WHERE public_id = 't2-nondisplay';
INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
SELECT 'legal_case', id, true, true, true, false, false, 'fixture_live', 'fixture' FROM legal_case WHERE public_id = 'scotus-live';
INSERT INTO federal_publication_hold (case_id, reasons, rule_version)
SELECT id, ARRAY['missing_readable_content', 'unverified_court_record'], 'fixture' FROM legal_case WHERE public_id = 't2-other-hold';
INSERT INTO federal_publication_hold (case_id, reasons, rule_version)
SELECT id, ARRAY['missing_readable_content'], 'fixture' FROM legal_case WHERE public_id = 't2-text-hold';
