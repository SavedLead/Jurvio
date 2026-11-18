# Filing backfill finishes the snapshot and then the days after it

Status: Accepted. David asked for this on Nov 18, 2026.

## Context

The appeals run on Nov 17 (workflow 44232422080) scanned 5,580,000 rows of `dockets-2026-09-30.csv.bz2`, matched 2,309 cases, inserted none, and exited 1 because the host load average crossed the pace line. The checkpoint had already saved that row. The free bulk bucket still has no dockets file after 2026-09-30.

## Decision

A high load average does not stop this job; the scan is what raises it. The job yields once for 15 seconds and continues. `allow_anytime=true` also skips the 90-minute budget, so one dispatch reads the snapshot through to the end. A budget or pace stop, if one still happens, exits 75 and the workflow starts again from the checkpoint. Disk still exits 1. A finished snapshot is not read again.

An insert that conflicts with a case that already has `filed_on` is counted as already present. A conflict that fills a null `filed_on` is counted separately. Neither changes `updated_at`.

After the snapshot, dates through yesterday that the file cannot contain are filled from `direct_court_event` and `free_source_item`, then from the CourtListener docket list for that court family. That list uses at most 40 requests on the day, spaced 12.5 seconds apart, and saves the next page. The 80-request follow budget is left in place under the documented 125-request day.

## Alternatives considered

- Keep exiting 1 on pace. Rejected: the checkpoint was valid and the next dispatch never started.
- Spend the whole CourtListener day on the October gap. Rejected: followed-case refresh keeps the first 80 requests.
- Wait for an October bulk file. Rejected: the bucket's newest dockets file is still 2026-09-30.

## Benefits

One appeals dispatch finishes the 365-day snapshot from row 5,580,000. The same command then fills October 1 through yesterday as far as stored feeds and the 40-request list allow. District uses the same inputs with `family=district` after appeals finishes.

## Costs and risks

The snapshot read keeps the ingestion host busy until the file ends. The October gap that is not already stored and does not fit in 40 list pages waits for the next dispatch of the same inputs.

## Reconsideration trigger

Revisit when CourtListener publishes a dockets snapshot after 2026-09-30, or when a 40-request day no longer reaches the end of the appeals list.
