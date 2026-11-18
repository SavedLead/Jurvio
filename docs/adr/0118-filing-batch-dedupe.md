# Filing backfill dedupes a batch before the upsert

Status: Accepted. District run 44369106755 failed on Nov 18, 2026.

## Context

The district 365-day backfill checkpointed through 8,500,000 rows and then exited 1. Postgres 21000 rejected one insert: `ON CONFLICT DO UPDATE command cannot affect row a second time`. The conflict target is `(court_id, docket_number)` where `supreme_court_term` is null. The snapshot lists the same court and docket number more than once inside a 200-row batch.

## Decision

Each batch is reduced to one row per court code and docket number before the insert. The kept row uses the longer caption and the earlier filing date. The first row's public id stays. A second copy does not count as a second match.

## Alternatives considered

- Let the statement fail and skip the batch. Rejected: the run stops and the cases in that batch are not written.
- `ON CONFLICT DO NOTHING` for the whole batch. Rejected: a duplicate would also drop a row that should fill a null `filed_on`.
- Distinct in SQL with no merge. Rejected: Postgres would keep an arbitrary copy, including a shorter caption or a later date.

## Benefits

A repeated docket in the snapshot no longer fails the run. The checkpoint still advances, and the next dispatch resumes from it.

## Costs and risks

Two different filings that share a court and docket number in one batch become one row. The earlier date and the longer caption are kept. A later, shorter name in the same batch is not stored.

## Reconsideration trigger

Revisit if the bulk file uses one docket number for two cases that both need to be stored, or if the conflict target changes.
