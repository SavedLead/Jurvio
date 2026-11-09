# Feed cadence and a cap on common-word search

Status: Accepted for the Nov 9, 2026 publishing approval.

## Context

Public search for a common word was taking several seconds. The keyword query
uses the opinion GIN index, and a common word's posting list is the whole
corpus, so LIMIT does not stop the scan. The search page then counts visible
opinions by court. Publishing was also refreshing that table on every row.

District RSS visited at most 16 courts a run, and not the same court more
often than every two hours. The public feeds only keep about 24 hours, so a
court the rotation did not reach in that window lost its entries. A case
created from a feed entry was stored as a draft, which is why it stayed off
the public site.

## Decision

Keyword search sets `gin_fuzzy_search_limit` and keeps at most 400 candidates,
and an excerpt reads only the first 8,000 characters of an opinion. A partial
index on visible opinion metadata serves the court counts.

Each enabled district court is due every `min(polling_minutes, 30)` minutes.
The registry asks for 5 minutes, and the job sweeps every 10 minutes, taking
every court that is due. Appellate RSS for the seven circuits that publish a
feed runs every 15 minutes. Courts with no working feed stay off.

A district or appellate RSS entry that passes the sealed check and has a
federal docket number creates or promotes a published case. The case time and
the docket line time are stamped outside the follower-alert window, so the
feed's existing entries do not notify followers.

## Alternatives considered

- Leave the two-hour rotation and rely on the 24-hour window. Rejected: a run
  that does not reach a court loses that day's entries.
- Poll every court every five minutes from the web server. Rejected: fetching
  belongs on the worker, and one sweep every ten minutes already stays inside
  30 minutes.
- Keep new feed cases as drafts for the metadata publisher. Rejected: a case
  that only exists because of a feed entry was invisible until that later pass.

## Benefits

Search for a common word stops reading the whole index. A filing that appears
in a court's 24-hour feed is stored and published on the next sweep.

## Costs and risks

A common-word search returns a capped set, which the page already labels.
Fourteen district courts and six circuits still have no public feed, so they
are not polled. Search visibility for a feed-published case waits, because the
publish skips the search-index refresh.

## Reconsideration trigger

Revisit if public search for a common word stays above 1.5 seconds after this
cap, or if a court's feed window shrinks below the 10-minute sweep.
