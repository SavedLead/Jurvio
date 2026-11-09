# Publish metadata cases in short batches

Status: Accepted for the Nov 9, 2026 publishing approval.

## Context

After the source-checksum waiver, the public case count stayed near 739,481.
The 12-minute publisher still loaded each draft with per-row collision and
source lookups, then published one case per transaction. A cycle used its
time budget before the count could rise by thousands.

## Decision

While metadata publication is on, that cycle publishes up to its paced cap in
commits of 500. A row needs a caption, a docket number, and a federal court.
It does not need opinion text, a source URL, a checksum, or a verified court
row. Sealed captions and a second case with the same docket in the same court
stay draft. The case row's update time is not changed. The search slowdown
still shrinks or stops the cap. The hourly pass uses the same batch.
`JURVIO_PUBLISH_FEDERAL_METADATA_WITHOUT_OPINION_TEXT=0` does not stop it.
`JURVIO_PAUSE_FEDERAL_METADATA=1` does.

## Alternatives considered

- Keep the per-row publisher and only raise its time budget. Rejected: the
  candidate query was the cost, and a longer budget would still overlap the
  next cycle.
- Drop the duplicate-docket check. Rejected: two public pages for one docket
  is a worse error than a slower batch.

## Benefits

Each cycle can commit thousands of displayable cases and then exit, so the
next cycle starts on time.

## Costs and risks

These rows are displayable and not indexable. A batch that exceeds 20 seconds
stops; earlier commits in that cycle remain. Duplicate dockets stay draft.

## Reconsideration trigger

Revisit if a cycle still adds fewer than a thousand published cases, or if a
sealed caption appears on the public site.

## Rollout

The next production release. The publisher starts about two minutes after
worker-core restarts.
