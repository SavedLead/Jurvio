# Live feeds: SCOTUS and courts of appeals

New cases and docket entries, captured from the courts' own public sites,
newest first. Code: `src/modules/ingestion/live-feeds/`, job
`jobs/run-live-feeds.mjs` (`scripts/run-live-feeds.ts`).

## Where it runs

| Job | Lane | Every | Budget | Command |
| --- | --- | --- | --- | --- |
| `scotus-live-dockets` | core | 3 h | 12 min | `--source=scotus` |
| `coa-live-feeds` | coa | 60 min | 10 min | `--source=coa` |

Both run inside the existing scheduler workers on jurvio-web-01, like every
other ingestion job, so no workflow schedule or new service is involved.
`run-live-feeds-once.yml` (confirm `RUN_LIVE_FEEDS`) runs one pass by hand
over the private VPC, for a first run or a check after a deploy.

## Sources

**SCOTUS.** supremecourt.gov serves one JSON document per docket
(`/RSS/Cases/JSON/{docket}.json`) and 404 for a number not assigned yet.
Numbers are sequential per series inside a docket year (paid `26-N`, in forma
pauperis `26-5NNN`, applications `26AN`; the year rolls on July 1). Each run:

1. With no watermark, finds the frontier (highest existing number) by
   galloping then binary search, about 20 requests per series.
2. Probes upward from the stored high-water mark until 5 numbers in a row are
   missing: that is everything filed since the last run.
3. Spends what is left walking down from the lowest number reached, skipping
   dockets Jurvio already has without a request (40 per series per run).

Docket entries use the same ids as the HTML docket enrichment
(`{docket}:event:{date}:{n}`), so the two jobs never duplicate each other. The
enrichment job then picks the new draft cases up (it orders by missing
enrichment first) and adds documents and the question presented.

**Courts of appeals.** Checked 2026-10-30:

| Court | Source |
| --- | --- |
| ca3 | precedential RSS + recent non-precedential list |
| ca5 | opinions RSS |
| ca9 | opinions RSS + memoranda RSS |
| ca10 | daily decisions RSS (empty on days with no decisions) |
| ca11 | published + unpublished opinion tables (media.ca11) |
| cadc | opinions RSS |
| cafc | site feed (opinions and orders) |
| ca1, ca2, ca4, ca6, ca7, ca8 | no usable public listing (see `COA_WITHOUT_FEED`); still covered by the appellate-official pipeline and, later, the CourtListener tail |

## Rules

- **Budgets.** SCOTUS: 240 requests, 8 minutes, 1 request per second. Each
  circuit: 4 requests, 90 seconds, 1.5 s apart, with its own try/catch. HTTP
  429 stops that source for the run and records Retry-After in the
  watermark.
- **Matching.** By this source's identifier first (`scotus_docket`,
  `official_appellate_docket` = `court:docket`), then by court + normalized
  docket number (the appellate pipeline's rule, served by
  `legal_case_normalized_docket_idx`). Two candidates = duplicate identity:
  nothing is attached and the item is counted as ambiguous.
- **Drafts only.** New cases are `publication='draft'`,
  `verification='not_verified'`. No `publication_decision` rows are written
  and an existing case's publication is never changed. Captions and entries
  that trip the existing sealed/restricted check are skipped.
- **Idempotent.** Entries insert with `ON CONFLICT DO NOTHING` on
  `(provider_id, provider_entry_id)`; feed bodies are stored once per content
  hash in `raw_artifact`.
- **Watermarks.** One `court_source_watermark` row per source and court
  (`scotus_official`/`scotus`, `coa_feed`/`ca5`, ...). The SCOTUS cursor is
  JSON per series (`{"26-paid":{"high":572,"low":533},...}`). A failure keeps
  the cursor and increments `consecutive_failures`. The touched courts'
  `court_freshness` rows are recomputed at the end of every run.

## First local run (2026-10-30, against the live sites, empty local database)

210 requests in 3.4 minutes. SCOTUS: 149 dockets fetched, 117 new cases,
180 entries; cursor 26-572 / 26-5993 / 26A611. Courts of appeals: ca3 85,
ca5 59, ca9 49, ca10 0, ca11 40, cadc 15, cafc 67 items. A second run 10
minutes later created only the 5 cafc items posted in between.

## Known follow-up

When a SCOTUS case is decided, `publish-official-scotus-opinions` keys cases
by official citation and may create a second row next to the draft docket
case. It should look up the docket case first.
