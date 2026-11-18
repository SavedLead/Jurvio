# Filing backfill stores nature of suit and cause

Status: Accepted. David asked on Nov 18, 2026 to publish the cases inserted by the filing backfill.

## Context

Runs 44380440319 and 44341348168 inserted 37,028 district cases and 443 appeals cases as drafts. The insert stored caption, docket number, court, and filed date. `bulk-publish-complete-drafts` treats a draft as incomplete unless it also has a cause, a nature of suit, a judge assignment, a party, or a docket entry. The CourtListener dockets snapshot has `nature_of_suit` and `cause`. It also has `assigned_to_str`.

## Decision

The backfill writes nature of suit and cause on insert. When a row already exists, empty values are filled and `updated_at` stays put. A fill pass re-reads the snapshot from its own checkpoint and only updates drafts. It does not insert, delete, or change publication. Sealed captions are still skipped.

`assigned_to_str` is not turned into a judge assignment. The safe matcher accepts a judge only when that judge had an eligible term on the court and the name is a unique roster match, and it is built for opinion authors with a source artifact. A free-text name in this scan does not meet that bar. Nature of suit or cause is enough for the completeness check.

## Alternatives considered

- Publish the thin drafts by relaxing the completeness rule. Rejected: the rule is what keeps a caption-only row off the site.
- Create a judge from `assigned_to_str`. Rejected: a surname match is not an assignment.
- Reuse the insert checkpoint and insert again. Rejected: that checkpoint is already complete, and a second insert is not wanted.

## Benefits

The drafts already inserted can pick up the snapshot's nature of suit and cause, then go through the existing publisher. Sealed captions and publication holds stay in place. Later backfill runs store the fields as they insert.

## Costs and risks

The fill pass reads the snapshot again on the ingestion host. Two snapshot rows for one docket keep the longer text. A draft whose snapshot row has neither field stays incomplete.

## Reconsideration trigger

Revisit if judge assignment gains a bulk path that only links an eligible, unique roster match, or if the publisher stops requiring one of these fields.
