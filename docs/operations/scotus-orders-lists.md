# Supreme Court orders lists

Official orders lists from `https://www.supremecourt.gov/orders/ordersofthecourt/{term}`.
Code: `src/modules/ingestion/providers/scotus/orders-list.ts` and
`src/modules/ingestion/live-feeds/scotus-orders-list.ts`. Scheduler job
`scotus-orders-lists` on the core lane (every 30 minutes, 8 minute budget,
at most 8 requests and 3 PDFs, one request a second).

This does not replace the 3-hour docket feed, the 10-minute emergency checker,
or the 20-minute enriched-opinion job. It does not read miscellaneous orders,
and it does not change the CourtListener nightly imports.

## What a run means

`scotus_orders_list_coverage` has one row per October term.

| Column | Meaning |
| --- | --- |
| `last_run_status` | `succeeded`, `partial`, `failed`, `rate_limited`, or `paused` |
| `completeness` | `complete_for_indexed_lists` only when the run succeeded and every Order List link currently on that term's index has stored text. Otherwise `incomplete` |
| `pending_lists` | Index links that do not yet have stored text |
| `failed_lists` | Links whose PDF was fetched but not extracted |
| `newest_indexed_on` / `newest_stored_on` | Newest index date versus newest stored date |
| `withheld_entries` | Lines withheld by the sealed/restricted filter. Their text is not stored |
| `unlinked_entries` / `ambiguous_entries` | Dockets that did not match exactly one existing SCOTUS case |
| `note` | Plain-language limit of the check |

A successful run can still be incomplete. Completeness is only about the
orders-list links on the official index for that term. It is not a claim that
every order, opinion, or docket is in Jurvio, and it is not instant.

The job log is one JSON line with those fields. It does not include order text.

```sql
SELECT term_year, last_run_status, completeness, pending_lists, failed_lists,
       newest_indexed_on, newest_stored_on, withheld_entries, unlinked_entries,
       rate_limit_until, note
FROM scotus_orders_list_coverage;
```

## Enablement

The job is in the scheduler and starts on the next production deploy of this
code. It does not start from this pull request. No GitHub workflow was added.

Subscriber notifications are off in two places:

- `ORDERS_LIST_NOTIFICATIONS_ENABLED` is false, and the job does not write
  `docket_entry` or call the alert senders.
- `scotus_orders_list_entry.notify` must be false. Backfilled rows are also
  forbidden from `notify`. Lists already on the index at the first successful
  read are backfill, including a later catch-up of those same URLs.

Do not flip either gate in production until the feed has been reviewed. Turning
mail on later requires a reviewed code change and a migration that drops the
`notify = false` check. Backfill must remain ineligible.

Manual check, after deploy, from the core host, one run:

```bash
node jobs/run-scotus-orders-lists.mjs --max-requests=8 --max-pdfs=3
```

`--term=2025` reads an earlier term index. Those rows are backfill if that term
has no `live_since` yet. They still cannot email.

`pdftotext` (poppler) has to be on the core worker, as it is for the other
SCOTUS PDF jobs. If it is missing, the index can still be read, extraction
fails, and completeness stays incomplete.

## Rollback

1. Set `JURVIO_PAUSE_SCOTUS_ORDERS_LISTS=1` for the core worker and restart that
   worker. The job logs `{"scotusOrdersLists":"paused"}` and makes no requests.
2. Or remove `scotus-orders-lists` from `scripts/scheduler-jobs.ts` and deploy.
3. Leave the tables in place. Stored PDFs and withheld counts are history, not
   a queue of emails.

## Still not covered

- Miscellaneous orders (`zr` files on the same index page).
- Terms the job has not been pointed at. The scheduler follows the current
  October term only.
- Orders lists the Court has not linked from that index.
- Dockets that are not already a SCOTUS case in Jurvio. They stay unlinked.
- Lines that match the sealed/restricted filter, including some public motions
  that only mention a redacted or sealed filing. The filter is the same one the
  emergency docket uses and is not loosened here.
- Slip opinions, the emergency docket, and the regular docket JSON feed. Those
  already have their own jobs.
