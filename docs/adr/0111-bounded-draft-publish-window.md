# Bound metadata publishing to one draft-index window

Status: Accepted for the Nov 16, 2026 publishing repair.

## Context

The publication-quarantine lane asked Postgres for the next 5,000 draft cases
that matched an opinion, docket, or record filter. Those filters are not in
`legal_case_draft_created_idx`, so the statement walked drafts until the limit
was filled or `statement_timeout` cancelled it. A cancelled tier was retried,
and the cycle kept going until its time budget produced about 24 timeouts.
Search and other pages stalled while those scans ran. Sealed captions and
identity holds were already enforced and are not the defect.

## Decision

Each commit reads at most 500 rows from `legal_case_draft_created_idx` and
only then applies the sealed-caption check, the court check, and the existing
`federal_publication_hold` rule. The window is saved in `ingestion_checkpoint`
(`metadata-publish-draft-window`). The next pass resumes at the following
window. Rows newer than the saved high-water mark are read before the older
backlog, so a case that arrives during the walk is not stuck behind it. The
first statement timeout ends the cycle. A second pass does not start while
this one holds the metadata-publish advisory lock.

Publish rules are unchanged. A sealed caption is held. A hold whose reasons
are not metadata waivers, including an identity or collision hold, still
suppresses the case. The case row's update time is not written, so backlog
publication does not look like a new filing to follower alerts. Opinion text,
a source checksum, and a verified court row are still not required.

## Alternatives considered

- Keep retrying a timed-out tier until the budget ends. Rejected: that is the
  scan that saturated the database on Nov 16.
- Scan until 5,000 rows match, but stop on the first timeout. Rejected: the
  single statement would still be an unbounded walk.
- Drop the duplicate-docket hold or publish every draft with a caption. That
  is a different rule change and is not part of this repair.

## Benefits

A pass either commits a short, indexed slice or stops. The following pass
starts where the cursor left off, including cases that arrived after the
cursor.

## Costs and risks

Drafts that stay draft are not reconsidered until a later lap reaches them
again. The cursor is the lap. A window that loses the race to `statement_timeout`
does not advance, so the next cycle repeats that same slice once. Two
publisher processes cannot run the slice at the same time.

## Reconsideration trigger

Revisit if a cycle still records `query_timeout`, if new cases stay draft
while older windows move, or if a sealed or colliding case appears on the
public site.

## Rollout

The production deploy recreates the worker with this code. Publishing stays
paused until the federal publication pause is resumed, which recreates only
that worker.
