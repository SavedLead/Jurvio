# Continuous publishing, off until enabled

Status: Accepted for the Nov 9, 2026 approval. The job publishes unless paused.

## Context

Most federal drafts stay off the public site because opinion text is required
and the metadata switch is off. New court-feed lines are stored, but a case
page lists a docket line only when that line has a displayable publication
decision. District feeds do not write that decision.

## Decision

An hourly worker publishes at most 100 cases, thickest first, then cases filed
in the last 90 days, then thin pre-2000 cases. It also marks docket lines from
the last two days displayable when the case is already published and the text
is not sealed. It does not update `docket_entry`, so follower alerts still key
off the original insert time. SCOTUS is excluded. Metadata-only cases are
displayable and not indexable.

The worker publishes unless `CONTINUOUS_PUBLISH=0` or
`JURVIO_PAUSE_CONTINUOUS_PUBLISH=1`. Metadata-only federal publication is on
unless `JURVIO_PUBLISH_FEDERAL_METADATA_WITHOUT_OPINION_TEXT=0` or
`JURVIO_PAUSE_FEDERAL_METADATA=1`. A metadata publish does not change
`legal_case.updated_at`, so the follower alert for a new case does not fire.
The batch shrinks when `https://jurvio.com/search?q=smith` takes 3 seconds or
more, and it stops for that cycle at 6 seconds.

## Alternatives considered

- Turn on `JURVIO_PUBLISH_FEDERAL_METADATA_WITHOUT_OPINION_TEXT`. Rejected for
  this change: that switch is a separate owner action and drains up to 5,000
  cases every 12 minutes in created-at order.

## Benefits

One flag starts a paced publisher in the requested order and lets new filings
appear on case pages.

## Costs and risks

The candidate query is bounded by a limit and an 8 second statement timeout,
but it still reads draft cases when the flag is on. Cases that fail provenance
are skipped and not held, so they will be retried next hour.

## Reconsideration trigger

Revisit if the metadata switch is turned on, or if the hourly batch starves
one of the three buckets.

## Rollout

Deploy with the variables unset. To stop the hourly job, set
`JURVIO_PAUSE_CONTINUOUS_PUBLISH=1` on worker-core and recreate it. To stop
metadata-only publication, set `JURVIO_PAUSE_FEDERAL_METADATA=1` the same way.
`JURVIO_PAUSE_FEDERAL_PUBLICATION=1` still stops the 12-minute publisher entirely.
