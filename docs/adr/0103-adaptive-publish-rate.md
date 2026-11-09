# Adaptive metadata publish rate

Status: Accepted for the Nov 9, 2026 publishing approval.

## Context

Eligible drafts are the cases that already have opinion text, a stored docket
line, or other case-record metadata. That set may be millions of rows. A fixed
cap of 5,000 cases every 12 minutes cannot finish it in a day, and a per-row
search refresh makes each commit expensive.

## Decision

The publisher commits short set-based updates, thickest first, and skips the
search-index refresh and citation requeue inside that transaction. The batch
grows while public search and a case page stay under 1.5 seconds and the
database shows no slow web queries or lock waits. At 3 seconds the batch
shrinks to a quarter. At 6 seconds, or when three slow queries or lock waits
are already running, the cycle stops. Sealed captions stay held. The case
update time is not changed. `JURVIO_PAUSE_FEDERAL_METADATA=1` and
`JURVIO_PAUSE_FEDERAL_PUBLICATION=1` still stop the work.

## Alternatives considered

- Keep the 5,000-case cap and only remove the source-checksum gate. Rejected:
  the cap itself misses an eight-hour finish.
- Publish from the public web server. Rejected: that host must stay fast.

## Benefits

Throughput can rise while the site stays fast, and it backs off without a deploy.

## Costs and risks

Search visibility and citation edges for these cases lag until a later job.
A cycle that stops at 6 seconds publishes nothing further until the next pass.

## Reconsideration trigger

Revisit if search p50 stays above 1.5 seconds at the smallest batch, or if a
sealed caption is published.

## Rollout

The next production release. The pass starts about a minute after worker-core
restarts and repeats about every six minutes.
