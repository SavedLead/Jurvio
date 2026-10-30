# Precomputed party and law-firm directory counts

Status: Accepted. Implemented with migration 0137 inside the existing `public-directory-stats` job (ADR 0080).

## Context

`/parties` and `/law-firms` run `count(DISTINCT legal_case.id)` over every `party_appearance` of every published
case, with correlated publication lookups for the case and the entity, on every request. They are not cached.

* Production measured ~0.08 s on 2026-10-30. Few parties are published today, and `party_appearance` has no
  `entity_id` index.
* The cost grows with every bulk docket load, and opening the party gate (PR #416) makes it a full join.
* On a local synthetic corpus (300k published cases, 900k appearances), the live query took 2,109 ms.

## Decision

* `entity_public_stats(generation, entity_id, case_count, latest_case_date)` and `public_stats_generation`.
* The directory job walks published cases in `public_id` order, 2,000 per committed batch, and adds each batch's
  per-entity `count(DISTINCT case)` into the building generation.
  * A case is visited once per pass, so the sums are exact.
  * The cursor moves in the same transaction as the counts, so a killed run resumes without double counting.
  * Each run processes at most 250 batches.
* When the pass reaches the end, the generation is published. Older generations are then deleted 20,000 rows at a time.
* A published generation is reused for 2 hours before the next pass starts.
* `listPublicEntities` reads the published generation and checks entity type and the entity decision live.
  Until the first generation is published, the live query runs.
* Locally: stored read 3 ms versus 2,109 ms live, with identical results. A full pass took 3.6 s without pauses.

## Alternatives

* A per-entity lateral count, like courts and judges. Entities number in the millions after the bulk loads, and
  most of them have no published case.
* A trigger on `party_appearance`. Rejected for the same bulk-load reason as ADR 0081.

## Costs and risks

* Counts lag by up to about 2.5 hours.
* For a while two generations coexist on disk. Each is one narrow row per entity that appears on a published case.

## Reconsideration trigger

Revisit if a pass does not complete within a day, or if the entity profile pages (still live) become slow.
