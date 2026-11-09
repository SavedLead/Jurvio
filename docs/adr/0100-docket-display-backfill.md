# Show stored docket lines on published cases

Status: Accepted for the Nov 9, 2026 publishing approval.

## Context

A case page lists a docket line only when that line has a displayable
publication decision. The hourly publisher writes that decision for lines
inserted in the last two days. Older stored lines, including the initial
filing, motions, and orders, stay off the page. Anderson v. Google
(`jv-c7mxm55hg0`) is one of those cases.

## Decision

A worker job marks existing non-sealed docket rows on published cases
displayable, in paced batches. The first batches prefer cases filed in the
last 120 days. It inserts `publication_decision` rows and does not update
`docket_entry`, `legal_case`, or follow cursors. Follower alerts still key off
`docket_entry.created_at`. Sealed text is skipped and stays hidden. The job
stops after a later pass finds nothing left. Case, docket, and timeline pages
list up to 2,000 displayable lines so a full ordinary docket is on the page.

`JURVIO_PAUSE_DOCKET_DISPLAY_BACKFILL=1` stops the job. The same search
slowdown that shrinks case publication shrinks this batch, and stops it for
that cycle when search is badly degraded.

## Alternatives considered

- Widen the hourly publisher from two days to every stored line in the same
  transaction as case publication. Rejected: that transaction already has an
  8 second budget and a case limit. A separate paced pass keeps case
  publication small and can be stopped on its own.
- Update `docket_entry.updated_at` or `created_at` so the line looks newly
  filed. Rejected: those timestamps are what follower alerts use.

## Benefits

Published cases show the docket Jurvio has already stored, including the
opening entry, without sending alerts for history.

## Costs and risks

Each batch reads published cases and inserts decisions. The statement timeout
is 8 seconds. A pass that finds nothing advances a marker on the artifacts
volume; deleting that marker runs the pass again. Lines inserted after the
job finishes are still covered by the two-day publisher, because that window
is the insert time, not the filing date.

## Reconsideration trigger

Revisit if a published case with stored non-sealed lines still shows none of
them after the recent pass, or if the batch collides with search.

## Rollout

The job starts on worker-core with the next release. To stop it, set
`JURVIO_PAUSE_DOCKET_DISPLAY_BACKFILL=1` and recreate worker-core.
