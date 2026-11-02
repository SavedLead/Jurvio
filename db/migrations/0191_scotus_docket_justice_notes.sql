-- Justice-by-justice notes the Supreme Court publishes on its own docket when
-- it acts on a petition or application: who would have granted (or denied),
-- who dissented from the order, who wrote a statement or concurrence, and who
-- took no part. Read from the "Proceedings and Orders" text of the official
-- docket page (supremecourt.gov) by scripts/backfill-scotus-justice-notes.ts
-- on the builder. Where a justice wrote, the opinion PDF link and a verbatim
-- quote of its opening (and, by rule, the sentence that says why) are kept.
--
-- Nothing is inferred for the other justices: the Court does not publish how
-- they voted on a petition. Read only by already-published case pages.

CREATE TABLE IF NOT EXISTS scotus_docket_justice_note (
  case_id uuid NOT NULL REFERENCES legal_case(id) ON DELETE CASCADE,
  docket_number text NOT NULL,
  source_url text NOT NULL CHECK (source_url ~ '^https://www[.]supremecourt[.]gov/'),
  entry_on date NOT NULL,
  entry_text text NOT NULL,
  entry_context text NOT NULL CHECK (entry_context IN ('cert_denied', 'cert_granted', 'application', 'rehearing', 'other')),
  justice_ref text NOT NULL,
  note_kind text NOT NULL CHECK (note_kind IN ('would_grant', 'would_deny', 'dissent', 'joined_dissent', 'statement',
    'joined_statement', 'concurrence', 'joined_concurrence', 'recused')),
  sentence text NOT NULL,
  opinion_url text CHECK (opinion_url IS NULL OR opinion_url ~ '^https://www[.]supremecourt[.]gov/'),
  opinion_opening text,
  opinion_reason text,
  fetched_at timestamptz NOT NULL,
  parser_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, entry_on, entry_context, justice_ref, note_kind)
);

CREATE INDEX IF NOT EXISTS scotus_docket_justice_note_kind_idx ON scotus_docket_justice_note (entry_context, note_kind);
