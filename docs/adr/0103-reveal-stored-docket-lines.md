# Show stored docket lines without a per-line display flag

Status: Accepted for the Nov 9, 2026 reveal.

## Context

A case page listed a docket line only when that line had a displayable
publication decision. The hourly publisher wrote that decision for lines
inserted in the last two days. The paced backfill walked a few dozen cases
per cycle. Anderson v. Google (`jv-c7mxm55hg0`) therefore showed two lines
while older stored lines on published cases stayed off the page.

## Decision

The public docket query reads `docket_entry` for a published, displayable
case and returns every line except sealed text and a publication decision
that withholds the line for a seal reason. A missing decision is not a hide.
The docket and timeline pages show 50 lines at a time, newest first, using
`docket_entry_case_filed_idx`. The case page previews the first page and
links to the full list. The header shows judge, case type, cause, nature of
suit, court jurisdiction, closed date, and parties when those stored values
exist. This change does not write `docket_entry`, follows, or alerts.

The metadata publisher already treats a caption and docket number as
sufficient and does not require an opinion. Cases that also have docket
entries are in that set. Batch order and the duplicate-docket gate stay with
the publisher cycle.

## Alternatives considered

- Keep writing one publication decision per stored line. Rejected: tens of
  millions of decisions would trail the rows already stored, and each insert
  is extra write load the page does not need.
- Render every line on the case page. Rejected: one case can hold thousands
  of lines, and the page has to stay fast.

## Benefits

Published cases show the docket Jurvio already stored, including lines that
never received a display flag, without sending alerts for history.

## Costs and risks

A case page now counts and reads that case's lines. The count is one index
range on `case_id`. Sealed wording and an explicit seal decision still hide a
line. Jury demand is not a stored column, so the page does not show it.

## Reconsideration trigger

Revisit if a case page's docket count exceeds a few hundred milliseconds, or
if a sealed line appears because its text does not match the seal pattern and
it has no withholding decision.

## Rollout

The next production release. No new worker and no change to alert cursors.
