# Precomputed public directory stats

Status: Accepted. Implemented with migration 0135 and the citations-lane job `public-directory-stats`.

## Context

A latency audit on 2026-10-30 (`precompute-audit.md`, ~1 request per second against jurvio.com) found:

* `/judges` at 1.8–2.0 s TTFB and 3.0 s total on every request. It is not cached. It runs
  `count(DISTINCT legal_case.id)` over every judge assignment, with a correlated latest-publication lookup
  per case, for up to 5,000 judges, and renders a 4.4 MB page.
* `/courts/[id]` at 0.27–0.53 s on every request. It is not cached. It counts every published case of the
  court and sorts them for the newest 100.
* `/courts` and the `/cases` court facet run a GROUP BY over all ~512k published cases (legal_case is 16M+ rows,
  mostly drafts). They do this on every five-minute `unstable_cache` miss.
* Cloudflare reports `DYNAMIC` for every HTML page, so each hit reaches the origin.

The citation-count precompute (ADR 0078) already showed the pattern: store the number off the request path and read one row.

## Decision

1. `court_public_stats` holds, per court: displayable published case count, latest `filed_on`, and the ids of
   the newest 100 cases. `judge_public_stats` holds, per verified judge: public case count and outcome sample.
   Both use the same definitions as the live queries. Case visibility goes through `latestPublicationColumnSql`,
   which is the `publication_current` mirror with a `publication_decision` fallback.
2. `jobs/refresh-public-directory-stats.mjs` runs every 30 minutes in the citations lane (25-minute budget).
   It uses one connection and its own `pg_try_advisory_lock('jurvio-public-directory-stats-v1')`.
   It commits 20 courts or 250 judges per batch and pauses 250 ms between batches. Each batch has a 60 s
   statement timeout. A batch that times out shrinks; a single court or judge that still times out is skipped
   and keeps its previous row.
3. Readers:
   * `/courts`, the `/cases` court facet and `/courts/[id]` read `court_public_stats`.
     The court page re-checks each listed case's visibility by id, so an unpublished case never shows.
   * `/judges` reads `judge_public_stats` and is paginated at 200 per page, most cases first. Profiles stay in
     the judges sitemap, and pages after the first are `noindex, follow`. It is wrapped in a 300 s `unstable_cache`.
   * Court and judge profiles dedupe their metadata and page lookups with React `cache()`.
   * Any reader whose row or table is missing falls back to the live query.

## Alternatives

* **Materialized views.** `REFRESH MATERIALIZED VIEW CONCURRENTLY` recomputes the whole aggregate in one long
  statement. That repeats the problem fixed in ADR 0078: nothing new is visible until it commits, and a timeout
  loses the pass.
* **Counters maintained on write.** Publication flips happen in several ingestion paths and triggers on
  `publication_decision`. A trigger per path is more invasive and harder to keep correct than a 30-minute refresh.
* **Only `unstable_cache`.** It is per instance and cold every five minutes, and it does not help uncached court
  and judge pages.

## Costs and risks

* Counts can lag by up to 30 minutes. A newly verified judge appears on `/judges` after the next pass.
* One pass reads each court's published cases through `legal_case_public_browse_idx`. The largest courts
  dominate the run time; batches keep each statement short.
* No new services and no database resize.

## Reconsideration trigger

Revisit if a pass regularly exceeds its 25-minute budget, if `court_public_stats` stays empty after a
citations-lane deploy, or if judge assignments grow enough that a 250-judge batch times out.
