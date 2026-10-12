# Citation counters and offline resolution of cited cases

Status: Implemented for David Rosenberg's October 12 request. Extends ADR 0074.

## Decision

1. **Counters.** Case pages show the total number of distinct cases cited (and how
   many are on Jurvio) and the full "cited by" count, not only the first 50 linked
   rows. Opinion pages show the same counter, mark reporter citations Jurvio does not
   hold yet ("Not yet on Jurvio"), and list them. A case's own citation, which opinion
   headers usually repeat, is never counted, linked or marked. Counts use the same
   visibility rules as the existing lists and ignore ambiguous reporter abbreviations,
   so the counter never claims a citation the page refuses to link.
2. **Offline resolution.** Missing citations are matched against CourtListener's free
   bulk citation map (`citations-<snapshot>.csv.bz2`) instead of one rate-limited
   citation-lookup call each. Outcomes: a cluster held locally becomes a verified
   alias (the existing path) and is linked on the next identity cycle; a cluster not
   held becomes `resolved` with its exact cluster id, which discovery fetches first
   without a lookup call; a citation mapping to two or more clusters becomes
   `ambiguous`; a citation absent from the snapshot is retried by API discovery after
   a longer backoff, since it may postdate the snapshot.
3. **Bulk ingestion of resolved cases.** The bulk opinion importer accepts an exact
   cluster-id filter, so all resolved federal cases are ingested in one pass over the
   bulk files with no API calls. SCOTUS is always excluded (official sources only).

Publication rules are unchanged. Resolving or importing never publishes; the existing
cited-opinion gate decides.

## Alternatives

- **Raise the API discovery rate.** Cheaper to build, but still bounded by
  CourtListener's lookup limit and dependent on API availability.
- **Store the full bulk citation map as a table.** Allows instant lookups for future
  citations, but adds millions of rows. The resolver keeps memory bounded by the
  missing set instead; reconsider if re-reading the file per snapshot becomes slow.

## Costs and risks

- The resolver streams the full citations file each run (minutes to an hour). The
  import streams the full opinion files (hours) and is run on demand, like the
  existing bulk backfill.
- Bulk snapshots lag the live API; recent cases still rely on API discovery.

## Reconsideration trigger

Revisit if missing citations absent from the snapshot dominate the backlog, or if
per-snapshot resolution time exceeds the interval between snapshots.

## Verification

Unit tests cover counting, own-citation exclusion and markers. Database integration
tests cover case totals under publication restrictions and every resolver outcome,
idempotent re-runs, and the post-import state transition.
