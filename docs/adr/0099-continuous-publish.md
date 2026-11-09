# Continuous publishing, off until enabled

Status: Proposed. The job does not publish while `CONTINUOUS_PUBLISH` is unset.

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

The worker opens the database only when `CONTINUOUS_PUBLISH=1` and
`JURVIO_PAUSE_CONTINUOUS_PUBLISH` is not `1`.

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

Leave both environment variables unset. To start: set `CONTINUOUS_PUBLISH=1`
on worker-core and recreate that worker. To stop: set
`JURVIO_PAUSE_CONTINUOUS_PUBLISH=1` or remove the first variable.
