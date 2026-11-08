# ADR 0096: Supreme Court orders-list monitor (phase 1)

Status: accepted for implementation. David Rosenberg approved this first phase:
close the orders-list gap with free official sources only. No production deploy
is part of this change.

## Context

Three Supreme Court jobs already run on the core scheduler. Checked in
`scripts/scheduler-jobs.ts` on 2026-11-08:

| Job | Interval | Role |
| --- | --- | --- |
| `scotus-emergency` | 10 minutes | Open emergency application pages |
| `scotus-live-dockets` | 3 hours | New docket numbers from the Court's JSON |
| `scotus-enriched` | 20 minutes | Slip-opinion index, PDFs, metadata, publication |

`scotus-publish` every 10 minutes only drains already approved slip opinions.
The freshness-guard workflow comment still says the enriched job runs every
five minutes; that comment is stale. This change does not edit that workflow.

Slip opinions are merits opinions. The 3-hour job discovers new docket numbers.
The 10-minute job re-reads emergency applications. A Monday order list (certiorari
grants and denials, summary dispositions, rehearing denials, amendments, and
separate writings) is not one of those feeds. The Court's orders index is
`https://www.supremecourt.gov/orders/ordersofthecourt/{term}`. Opinions relating
to orders are a separate index from slip opinions.

## Decisions

1. **New core job `scotus-orders`, every 60 minutes, 8-minute budget, `--max-pdfs=1`.**
   It reads the current October-term orders index and the relating-to-orders index,
   conditionally rechecks the newest parsed order list, and downloads at most one
   other order-list PDF. Miscellaneous-order PDFs are not fetched. The job does
   not call the emergency, live-docket, or slip pipelines.
2. **Idempotent storage.** `scotus_orders_list` is unique on source URL plus content
   hash. The same wording keeps the same entry id and is not inserted again. A new
   PDF hash for the same URL supersedes the previous list. Changed lines are new
   rows with `amended_from`. Unchanged lines are left in place.
3. **Exact Court wording, rule-based plain English.** Disposition text is stored
   as printed, with PDF line breaks collapsed. Plain English is a fixed sentence
   per kind. A cert denial is `cert_denied` with `merits` false. A GVR is
   `summary_disposition`. `merits` may be true only for `merits_ruling`.
4. **Conservative case matching.** Exact normalized docket at SCOTUS. A two-digit
   docket year matches only that century's term window. Two in-window candidates,
   or a dated row beside an undated row, stay unmatched. Captions are not used.
   No case is created.
5. **Sealed and restricted lines stay withheld.** The emergency lane's line and
   caption word lists are applied together. A withheld row stores the docket
   number and a hash, not the caption, wording, author, or plain English.
6. **Mail stays off.** `alert_eligible` has a database check that it is false.
   The insert writes the literal `false`. Historical lists (posted more than two
   days before the run, or any list on `--backfill`) are `backfilled`. Backfill
   still suppresses a future feed even if notifications are enabled later.
   `ORDERS_FEED_NOTIFICATIONS_ENABLED` is false. This job does not write
   `docket_entry` and does not add an `entity_follow` kind.
7. **Coverage is not the same thing as a successful run.** `scotus_orders_coverage.run_succeeded`
   means the orders index was read for the requested term. `complete` also requires
   the relating-to-orders index and zero missed, unparsed, stale, or failed items.
   A PDF error is a failure on a run that can still be `run_succeeded`. The
   `/internal/freshness` slip timestamp is unchanged and is not an orders-list
   completeness signal.
8. **Enable and roll back without a second pipeline.** The job is on the core
   scheduler. `JURVIO_SCOTUS_ORDERS=off` skips a run. Rollback is that variable,
   or removing the `scotus-orders` entry from `scripts/scheduler-jobs.ts`. Tables
   can stay. `--backfill` is manual and is not scheduled. No new GitHub workflow,
   no builder job, and no production deploy in this change.

## Alternatives considered

- Re-read every petition docket when an order list drops. That repeats the
  3-hour discovery lane and would request thousands of docket pages.
- Parse miscellaneous-order PDFs in this job. Many are emergency rulings the
  10-minute lane already reads from the application docket. Revisit if index-only
  rows leave a non-emergency miscellaneous order invisible for more than a term.
- Send case-follow mail from the first live order list. Followers would get a
  backlog the first time a list is stored, and the wording has not been reviewed
  on a case page. Revisit after a reviewed sample of stored rows.
- Fold orders into `court_freshness.last_feed_at`. A green slip run would look
  like the orders list was complete.

## Costs and risks

- One HTML index, one relating-to-orders index, one conditional PDF check, and
  at most one PDF body per hour on the existing core worker. `pdftotext` is the
  same tool slip opinions already use.
- Catch-up is one order-list PDF an hour, newest first, so a cold term stays
  `complete = false` until the backlog drains.
- In-place edits to older order lists are not rechecked until `--backfill`.
- The sealed-word filter hides a public line that merely mentions those words,
  including some separate writings. That is the existing emergency rule.
- Order-list text is the electronic PDF. The Court says the printed U.S. Reports
  version controls if they differ.

## Reconsider when

- A reviewed sample should turn on feed notifications. That needs a migration
  to drop the `alert_eligible` check, a code change beyond the constant, and
  tests that historical rows still cannot mail.
- Miscellaneous orders that are not emergency applications need their own text.
- Opinions relating to orders need the opinion text, not only the index row.
- The orders backlog should drain faster than one PDF an hour.
