# Citation work in its own scheduler lane

Status: Implemented for David Rosenberg's October 12 request. Extends ADRs 0074 and 0075.

## Decision

Citation jobs move out of the `core` scheduler into a new `citations` lane, run by a
new `worker-citations` container from the same image:

- `case-citation-graph` (sync, discovery, cited-opinion publication) every two
  minutes, unchanged except for its lane and a shorter start-up delay.
- `cited-case-bulk-resolution`, new: once a day, resolve new missing citations
  against the newest non-empty CourtListener bulk citation map (`--snapshot-date=latest`).
  Resolve-only, no API calls; the multi-hour bulk import stays an on-demand workflow.

The container caps its own database pool at 4. Each citation job already holds a
single connection under a session advisory lock, so overlapping manual runs remain
safe. The release script pulls, starts and rolls back the new container with the
others. The job table moves to `scripts/scheduler-jobs.ts` (no side effects) so lane
assignments are tested.

## Why

The `core` scheduler starts every ingestion loop and the citation job together and
restarts them together. A separate lane means citation work keeps running on its own
cadence through ingestion deploys, backfills and lane failures, and its lane health is
reported separately. It does not speed up CourtListener API discovery (still ten
lookups per cycle); the bulk resolver is what removes most of those calls.

## Alternatives

- **Keep the job in `core` and raise its frequency.** No new container, but citation
  work would still share start-up and failure fate with ingestion.
- **Run citations inside `worker-supervisor`.** Fewer containers, but mixes a
  control loop with batch work and loses per-lane scheduling.

## Costs and risks

- One more long-running container (a Node scheduler plus short-lived children) and a
  few more database connections, well within `max_connections=200`.
- Manual workflows that `docker exec` citation jobs in `worker-core` keep working:
  every container has the same jobs, and the advisory lock serializes them.

## Reconsideration trigger

Revisit if citation jobs need more than one connection at a time, or if the box's
memory headroom drops below what an extra scheduler needs.

## Verification

`tests/scheduler-lanes.test.ts` asserts citation jobs run only in the `citations` lane,
every lane has a container with a heartbeat health check, the release script pulls
and starts every lane's container, and newest-snapshot selection skips empty
placeholder files. Typecheck, lint and the job build pass; the compose file
validates with `docker compose config`.
