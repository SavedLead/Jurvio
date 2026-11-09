# Show the Supreme Court record Jurvio already stores

Status: Accepted for the Nov 9, 2026 reveal.

## Context

A Supreme Court case page rendered the caption, docket number, a short
timeline, opinions that had passed publication review, and a capped citation
list. Several official tables were stored and not rendered on the case:
counsel, filing PDF links (including amicus and other briefs), order-list
items, and docket-header dates. Docket lines without a display flag were
hidden until the stored-docket reveal. Emergency applications already list
each public docket line, including amicus briefs, and count lines withheld
because they mention sealed material.

## Decision

On a published Supreme Court case, the page lists counsel, Court filing
links, order-list items matched by case or docket number, and the stored
header dates: docketed, lower court and its numbers, argued, certiorari,
and judgment. Text that matches the sealed-word pattern is omitted. The
queries do not write `docket_entry` or alert tables. The emergency-docket
rule that withholds a line mentioning sealed or restricted material is
unchanged.

## What was stored and not fully shown

| Stored | Before | After |
| --- | --- | --- |
| `docket_entry` without a display flag | Hidden | Shown by the stored-docket reveal, except sealed text |
| `scotus_counsel` | Not rendered | Listed |
| `scotus_filing_link` | Not rendered | Listed, up to 200, with the stored count |
| `scotus_order_list_item` | Activity feed only | Listed on the case, up to 100, with the stored count |
| `scotus_docket_status` header (parties, lower court, docketed, cert, judgment) | Used inside standing prose when present | Listed as fields |
| `scdb_case.argued_on` | Not on the case page | Listed when linked |
| Documents without a display flag | Hidden | Unchanged in this change; Court PDF links in `scotus_filing_link` are the stored public copies |
| Citation edges | First 50 on the page, full count in the heading | Unchanged; the heading already states the stored count |
| Emergency lines that mention sealed material | Withheld and counted | Still withheld |

Production row counts depend on the live database and are not invented here.

## Alternatives considered

- Copy filing links and order-list items into `docket_entry`. Rejected:
  alerts key off `docket_entry.created_at`, and history must not alert.
- Relax the emergency sealed-line filter. Rejected: a line that mentions
  sealed material can be the ruling, and the existing page already says how
  many such lines were withheld.

## Benefits

A Supreme Court case page shows the official record Jurvio has already
saved, including counsel and the Court's own PDF links.

## Costs and risks

The case page runs four extra indexed reads for Supreme Court cases only.
A case with more than 200 filing links shows the count and the newest 200.

## Reconsideration trigger

Revisit if a Supreme Court case page becomes slow, or if a sealed filing
link appears because its description does not contain the seal words.

## Rollout

The next production release. No worker and no alert cursor change.
