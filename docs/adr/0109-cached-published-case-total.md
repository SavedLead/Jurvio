# Cached published-case total

Status: Accepted 2026-11-10, after /cases timed out on a live count.

## Context

`/cases` ran `count(*)` over every published case, with a per-row displayable lookup, in parallel with the page of results. The web pool's statement timeout is 20 seconds. After the bulk publish grew the published set, that count used the whole budget and the page rendered no total and no list. `/coverage` ran a second ungrouped `count(*)` for its headline, which failed on its own, while the per-court family rows still completed.

## Decision

1. The unfiltered `/cases` headline reads `sum(case_count)` from `court_public_stats`, the same per-court figures the court menu uses. If that table is missing or empty, the headline is `pg_class.reltuples` on `legal_case_published_recency_idx`. Both are labeled "About", because stats lag publication and reltuples is a planner estimate. Neither query reads `legal_case` row by row.
2. A filtered listing may still count, because the predicate is a court, a search, or a year, not the whole published set. The request path does not fall back to a live `GROUP BY` of every published case for the court menu.
3. The unfiltered newest-first list is `ORDER BY` the published-recency index with `LIMIT` and no `OFFSET`. The next page passes a keyset cursor (date, caption, id).
4. `/coverage`'s single published-case total is the sum of its family rows. It does not issue another `count(*)` of `legal_case`.

## Alternatives

- **Keep the live count and raise the statement timeout.** The page would still scan the published set on every cold request, and a longer timeout holds a web connection while the bulk job is writing.
- **Count `publication_current` on the request.** That is still a live count of millions of rows.
- **Show no number.** The page would load, and the mismatch with `/coverage` would stay unexplained.

## Costs and risks

- "About" can trail the bulk publish until `public-directory-stats` refreshes the per-court rows. Reluples can be stale until the next analyze.
- Filtered counts can still be slow for a very broad text search. They no longer run on the unfiltered page.
- Keyset "Previous" returns to the first page rather than the prior cursor.

## Reconsider when

Revisit if the unfiltered page is still over a second after this change, or if the stats job falls more than one bulk range behind for a full refresh interval. Revisit the keyset previous-page behavior if readers need stable deep links into later pages.
