# Precomputed /cases text-search candidates

Status: Accepted. Implemented with migration 0136 and the citations-lane job `public-case-search`.

## Context

The 2026-10-30 latency audit measured `/cases?q=smith` at 4.68 s and 4.12 s TTFB on two passes. Free-text
listings are deliberately not cached, so no shared cache holds user-entered text. The text condition ORs
three ILIKEs on `legal_case` with an EXISTS over `scotus_case_enrichment` and an EXISTS over
`party_appearance`/`entity`. Because of that OR, Postgres cannot drive the query from the existing trigram
indexes. It walks the published slice of a 16M-row `legal_case` and evaluates a correlated publication lookup
per row, twice: once for the exact count and once for the page.

## Decision

1. `public_case_search` holds one row per published case. Its text is caption, docket number, official
   citation, the verified SCOTUS holding, and every `party_name_as_filed` and linked `entity.display_name`,
   joined with newlines. A trigram GIN index covers it. Every live text condition is a substring test on one of
   those fields, so `search_text ILIKE pattern` returns a superset of the live matches.
2. `listPublicCases` adds `legal_case.id = ANY(ARRAY(SELECT case_id ... ILIKE pattern))` for `q`, `party` and
   `firm`. All of the original conditions and the live publication gate still apply. The results are therefore
   exactly the live results, minus any case the table does not know yet.
3. `jobs/refresh-public-case-search.mjs` runs in the citations lane every 15 minutes (12-minute budget) with one
   connection and its own advisory lock (`jurvio-public-case-search-v1`).
   * It first adds published cases that have no row (up to 20 × 1,000).
   * It then continues a rolling keyset sweep in `public_id` order over `legal_case_published_public_id_idx`:
     150 batches of 1,000 per run, with a 200 ms pause between batches.
   * The sweep refreshes party changes, drops unpublished cases, and never rewrites an unchanged row.
   * The cursor is stored after every batch.
4. Readers use the table only after one full sweep has completed (`public_case_search_state.sweep_completed_at`,
   memoized for 60 s per process). Before that, and if the table is missing, the live query runs alone.
5. No trigger and no foreign key is added to `legal_case` or `party_appearance`, so bulk loads keep their write cost.

## Local measurement

Measured on a synthetic Postgres 16 corpus: 1.8M cases (300k published), 900k party appearances.

| Query | Matches | Live | Precomputed |
|---|---|---|---|
| `acme corp 1a` | 243 | 1,869 ms | 37 ms |
| `entity 00` (party names only) | 612 | 1,831 ms | 49 ms |
| `ENTITY 5` | 9,402 | 1,950 ms | 372 ms |
| `smith` (20% of the corpus) | 60,000 | 3,763 ms | 858 ms |

* The first full sweep of 300k cases took 29 s without pauses.
* A follow-up run of 150 batches with no changes took 6.8 s and wrote 0 rows.
* The table plus index took 161 MB for 300k cases.

## Alternatives

* **Rewrite the OR as a UNION of index-driven branches.** That needs no storage, but the party branch would read
  trigram postings for parties of 16M mostly-draft cases on every request.
* **Triggers on `legal_case`, `party_appearance` and `entity`.** They would keep the table exact, but they add
  per-row cost to the nightly bulk loads.
* **A materialized view.** A full refresh rebuilds the GIN index every time, and nothing new is visible until
  the refresh commits.

## Costs and risks

* Storage is roughly 100–300 MB for ~512k published cases plus the index. The ingestion box was at 33% disk on 2026-10-30.
* A party added to an already-published case becomes searchable when the rolling sweep reaches it
  (a full cycle is about an hour at 150k cases per 15 minutes). A newly published case is searchable within one interval.
* Patterns shorter than three characters cannot use the trigram index and scan the narrow table instead.
  That is still far smaller than the published slice of `legal_case`.

## Reconsideration trigger

Revisit if a run regularly hits its budget, if `sweep_completed_at` stays NULL a day after deploy, or if the
precomputed path is slower than the live path for common terms (for example, when a term matches most of the corpus).
