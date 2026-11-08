# Court freshness (admin backend)

Path: `/internal/freshness` (same internal session / Cloudflare Access gate as every `/internal` page).
`/heartbeat` now redirects here.

## What it shows

One row per tracked federal court: the Supreme Court, the 13 courts of appeals and the
94 district courts, grouped by court type. Per court:

| Column | Source |
| --- | --- |
| Cases / Published / Draft | `legal_case` rows for every `court` record with that court code (CourtListener, official CM/ECF and official SCOTUS court rows are merged). Restricted and suppressed cases are counted as "withheld". |
| Newest filing | `max(coalesce(filed_on, decided_on))`, ignoring dates more than a day in the future. |
| Live feed | Latest success of the court's own feed: `court_source_watermark` (`scotus_official`, `coa_feed`, `district_rss`), `appellate_source_registry` / `direct_court_registry.last_successful_retrieval`, and for SCOTUS the newest completed slip-opinion run. A successful slip run does not mean the orders list is complete. Orders-list coverage is `scotus_orders_coverage` (`run_succeeded` is the index check; `complete` means every current order list was parsed). |
| CourtListener | `court_source_watermark` source `courtlistener` (the date_modified tail). Shows "rate-limited" while a 429 Retry-After is pending. |
| Bulk | `court_source_watermark` source `bulk`, written by the bulk docket loader for each court in each merged chunk. |
| Lag | Time since the newest update from any source. |
| Status | **Fresh**: live feed or CourtListener tail succeeded within 36 hours. **Stale**: older, or only bulk snapshots touched the court. **Never**: no source has run. A **Failing** badge is added after 3 consecutive feed failures or a degraded registry state. |

Summary cards at the top give fresh / stale / never counts (click to filter), total cases,
published / draft / withheld, the newest filing, failing feeds and any CourtListener back-off.
Rows can be filtered by court type, status and free text, and sorted by any column.

## How it stays fast

The page reads only `court_freshness` (~108 rows) and `court_source_watermark`.
Nothing on the request path aggregates `legal_case`, `docket_entry`, `raw_artifact` or
`direct_court_event`.

`court_freshness` is recomputed by:

* the core-lane scheduler job `court-freshness` (`jobs/refresh-court-freshness.mjs`), one minute after
  worker start and every 30 minutes, under an advisory lock and a 5-minute statement timeout; and
* each feed job, for only the courts it touched, via `refreshCourtFreshness(sql, { courtCodes })`.

## What was wrong with the old page (`/heartbeat`)

* It never read `legal_case`. District rows came only from the CM/ECF RSS registry, so the 82
  districts without an RSS feed showed "never / 0" even though they hold bulk-loaded cases, and
  "published" for districts counted RSS docket events, not cases.
* SCOTUS "last update" came from `max(raw_artifact.retrieved_at)`, an unindexed scan of the largest
  provenance table on every page view; it timed out and the section fell back to "Not yet".
* Every view ran live `GROUP BY`s over `direct_court_event` and `appellate_ingestion_item`. Each
  section swallowed errors, so a timeout rendered as "Coverage is being prepared" instead of a failure.
* A 2-hour "stalled" threshold marked nearly every court red (98 of 108 in production), so the
  colour carried no signal.
* No case, draft or newest-filing columns, no per-source (bulk / feed / CourtListener) times, no lag,
  and no sorting or filtering. It sat outside the admin layout and the sidebar linked to a dead
  `/internal#sources` anchor.
