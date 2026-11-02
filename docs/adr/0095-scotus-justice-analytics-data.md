# ADR 0095: Supreme Court justice analytics data foundation (SCDB + Martin-Quinn)

Status: accepted (merged on green CI per the owner's instruction of 2026-11-01;
shaped by the justice analytics spec's Evidence Ledger requirement).

## Context

Justice analytics (vote direction, agreement, 5-4 coalitions, per-case vote
breakdowns, ideology over time) need per-justice votes for every Supreme Court
case. Jurvio already stores Supreme Court cases (`legal_case` with
`supreme_court_term`, `official_citation`, `decided_on`), FJC judges (`judge`,
`judge_service_term`) and opinions, but no votes. A separate workstream is adding
supremecourt.gov docket JSON and slip-opinion ingest; this work does not touch it.

## Decisions

1. **Source of votes: the Supreme Court Database (SCDB)**, Modern 2026 Release 01
   (OT1946-OT2025) and Legacy 07 (1791-1945), justice-centered,
   citation-organized (one row per case and justice, the unit SCDB recommends
   for vote analysis), plus the docket-organized case file for consolidated
   dockets. Files are committed under `data/` with checksums (`data/README.md`);
   the SCDB download pages sit behind a Cloudflare browser check, so the importer
   never fetches them.
2. **Ideology labels come only from the sources:** SCDB `direction` /
   `decisionDirection` ("liberal/conservative as coded by the Supreme Court
   Database") and Martin-Quinn scores. No party labels are stored or derived; a
   test fails if "Republican"/"Democrat" appears in the new schema or module.
3. **Justices** are keyed by SCDB justice id (`scotus_justice`), linked to FJC
   nid and, when present, to the existing `judge` row. Biography and appointment
   facts (appointing president, nomination/confirmation/commission, how service
   ended) come from FJC via a generated, committed `data/scotus/justices.json`.
4. **Linking to Jurvio cases** is deterministic and refuses ambiguity: U.S.
   Reports citation, then docket + decision date, then docket + term only when a
   single candidate exists. `match_method` and `match_candidates` are stored.
   The same SQL (`scdb-matching.ts`) feeds the importer and a read-only
   production match-rate report (`scripts/diag/scdb-jurvio-match-rate.sql`).
5. **Precomputation:** two materialized views (direction shares by justice x
   term x issue area; pairwise agreement by term) refreshed concurrently after an
   import, and plain views for per-case breakdowns and 5-4 decisions/coalitions.
   `scope` = `all` or `argued` (decisionType 1, 6, 7).
6. **Evidence Ledger in the data:** every rate is stored with its numerator,
   denominator, unknowns (no direction / no side) and exclusions, so pages never
   recompute or hide a denominator. `scotus_term_coverage_v` feeds the coverage
   meter. The one piece of Jurvio analysis, `scotus_unusual_alignment_v`, uses a
   fixed published rule (lowest whole-term agreement inside a 5-4 majority) and
   is labelled as analysis on every page, apart from SCDB facts.
7. **Production import** runs only by hand (`scdb-import-once.yml`,
   confirm=SCDB_IMPORT) on builder-01, bundled from the dispatched commit.

## Alternatives considered

- Deriving votes from Jurvio's own opinion text: not reliable enough today
  (joins, partial concurrences); SCDB is the field standard. Revisit for terms
  SCDB has not released yet (e.g. OT2026 until its next release).
- Fetching SCDB at import time: blocked by Cloudflare; committing ~5.6 MB of zips
  is simpler and reproducible.
- Plain views only: the pairwise agreement view joins ~260k votes with itself;
  materializing keeps page queries index lookups.

## Costs and risks

- ~5.6 MB of source zips and a 2.3 MB generated diag SQL file in the repo.
- SCDB publishes no license text; it requires citation with version. Public
  display needs the citation on every page that uses the data.
- SCDB lags the Court by one term; Martin-Quinn currently stops at OT2024.

## Reconsider when

- The supremecourt.gov docket/slip-opinion workstream lands (re-run matching;
  add docket keys it introduces).
- SCDB publishes a new release (replace zips, update `data/README.md`, re-import).
- Judge analytics for lower courts start (generalize `scotus_justice` into the
  `judge` model rather than duplicating it).
