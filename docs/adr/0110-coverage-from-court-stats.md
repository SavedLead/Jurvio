# Coverage from precomputed court stats

Status: Accepted 2026-11-10, after /coverage cached an unavailable snapshot.

## Context

`/coverage` grouped every published `legal_case` row by court on the request. After the bulk publish, that aggregate timed out. The page caught the failure and cached "temporarily unavailable" for five minutes, replacing any earlier family table. The same request also counted drafts with an `EXISTS` over `legal_case` for each district court.

`/cases` already reads `sum(case_count)` from `court_public_stats` for its headline.

## Decision

1. Family rows are the precomputed per-court counts, grouped by `court.provider_court_id`, then rolled up with the existing family rules. The published-case total is the sum of those rows. Court rosters still come from the small appellate and district registries. The request does not aggregate `legal_case`.
2. Filing years use the newest `latest_case_date` in the stats row. The page says "through YYYY" because the stats table does not store the earliest filing.
3. The draft figure, when shown, is `pg_class.reltuples` on the draft index and is labeled "About". Blocked-document counts stay on `appellate_ingestion_item` with a 3 second timeout. A miss there leaves that list empty and still shows the family table.
4. `retainCoverageSnapshot` keeps the previous snapshot when the new one has no positive family total. The page cache key changed so a process does not keep serving the unavailable snapshot from the old loader.

## Alternatives

- **Keep the live `GROUP BY` and lengthen the timeout.** The page would still scan millions of case rows while the bulk job writes, and a timeout would still cache "unavailable".
- **Show only the /cases headline and drop the family table.** The roster gaps ("94 of 94") are the point of the page.
- **Store a coverage snapshot table.** That is a new refresh job. The court stats job already maintains the counts this page needs.

## Costs and risks

- Family totals lag until `public-directory-stats` rewrites `court_public_stats`. They match the `/cases` "About" figure, not a live count.
- The earliest filing year is no longer on this page.
- The first request in a new process, if the stats read fails and no prior snapshot exists, still says unavailable. The next successful read replaces it.

## Reconsider when

Revisit if `court_public_stats` falls more than one directory-stats pass behind the bulk publish, or if readers need the earliest filing year on `/coverage` often enough to store it on the stats row.
