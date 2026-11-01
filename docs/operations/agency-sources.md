# Agency sources: official public sources of federal case filings

Code: `src/modules/agency-sources/`. Job: `jobs/run-agency-sources.mjs`
(`scripts/run-agency-sources.ts`), scheduler job `agency-sources` (core lane,
every 60 min, 20 min budget). Health and review queue: `/internal/agency-sources`.
Read-only report: `diagnose-agency-sources-once.yml` (confirm `DIAGNOSE`).

## Sources

| Source code | Publisher | Feed | Per run |
| --- | --- | --- | --- |
| `doj-press-releases` | U.S. Department of Justice (OPA, divisions, all 94 USAOs) | `justice.gov/api/v1/press_releases.json` | ≤2 pages of 50 (4 on first run), 2 s apart |
| `sec-litigation-releases` | SEC | litigation releases RSS + each new release page | ≤25 pages, 250 ms apart (SEC fair access: ≤10/s, UA with contact) |
| `sec-administrative-proceedings` | SEC | administrative proceedings RSS | 1 request; stored as not-court items |
| `ftc-cases-proceedings` | FTC | legal-library case listing + changed case pages | ≤12 pages, 5 s apart (robots Crawl-delay) |
| `state-ag-ca`, `-ny`, `-tx`, `-fl`, `-il`, `-pa`, `-ma`, `-wa`, `-nj`, `state-ag-multistate` (NAAG) | each attorney general's office | CA and PA RSS (PA full text), others the newsroom page (newest 60 links) | ≤8 new release pages, ≥3 s apart (CA Crawl-delay 10 s) |
| `settlement-admin-jnd` | JND Legal Administration | jndla.com/cases (Nuxt payload: case name, case number, amount, website) | 1 request, at most every 20 h |
| `settlement-websites` | court-approved settlement websites JND lists | each site's homepage | ≤6 sites per run, each at most weekly |
| `settlement-admin-epiq`, `-kroll`, `-angeion` | — | registered, not polled | no public case index (Epiq, Angeion); HTTP 403 to our User-Agent (Kroll) |

State AG releases that name no federal court and no federal docket are kept
as title + link only (`not_court`). Releases that name a federal court but no
docket number (most AG releases) wait in the review queue with the court they
name (`stated_courts`); they never link without a stated docket. Releases
describing a coalition are marked `press_release_multistate`.

Settlement administrator listings and settlement websites are privately
written, so Jurvio stores only facts from them (case number, court, amount,
deadlines, document links), never their text. A JND case number is used only
when it is a district docket and the listing names the court.

As of 2026-10-31 these return HTTP 403 to Jurvio's declared User-Agent from
the box: myfloridalegal.com (FL), mass.gov (MA), njoag.gov (NJ), naag.org
(multistate), kroll.com. They stay enabled for the state newsrooms and are
recorded as `blocked` each run, so they start working if the block lifts.

## Rules

- **Stated only.** A docket number is read only where the document writes it
  (`6:26-cv-05267-JDA`, `No. 5:26-CR-194-FL-RJ`, `26 Civ. 1234`). A court is
  attached only by: a Bluebook parenthetical right after the docket, the
  document naming exactly one district court, the closest court named just
  before it in the same sentence, or exactly one court within 250 characters.
  FTC uses its own "Federal Court" / "Civil Action Number" fields. A USAO
  release whose court reading differs from the office's own district is not
  trusted.
- **Never guess a match.** Court + normalized docket must match exactly one
  Jurvio case (`legal_case_normalized_docket_idx`), and the case caption must
  share a party name with the item. Otherwise the reference stays in the
  review queue (`unmatched`, `ambiguous`, `no_court`) and is re-checked every
  6 hours for 180 days, in case the case is ingested later.
- **Display.** Linked items appear only on the already-published case page
  ("Agency announcements and filings"), with publisher, issuing office, date,
  the official source URL and the linked filings. No new public pages, no
  sitemap or Search Console changes, no case publication changes.
- **Restricted.** Items that reference sealed material or juvenile
  proceedings are stored as restricted and never shown; a matched case with a
  sealed caption is not linked.
- **Polite.** robots.txt is read first on every host (Disallow honoured,
  Crawl-delay raises the spacing), every source has its own request/time
  budget, HTTP 429 stops that source for the run, 401/403 is recorded as
  `blocked`. User-Agent: `INGESTION_USER_AGENT` (contact e-mail included).

## Health

`agency_source` holds per-source last attempt, last success, status, last
error and consecutive failures; `agency_source_run` one row per source per
run (requests, items seen/new, refs, matched, queued, restricted). The job
fails only if every polled source fails.
