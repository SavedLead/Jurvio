# Classify stored docket lines and state only explicit facts

Status: Accepted for the Nov 9, 2026 case-page reveal.

## Context

The stored-docket reveal lists every non-sealed line. Readers still need the
court's own label for each line, a count of orders, and a result only when
the line states one. Jury demand and the jurisdiction basis (diversity,
federal question) are often absent as columns. They do appear in the stored
cause or in a docket line.

## Decision

Each visible line is labeled from the court's bracket, or from the line's
words when there is no bracket: complaint, motion, order, summons, notice,
stipulation, judgment, letter, hearing, response, or docket entry. The page
says how many entries and how many orders are stored. The orders section
repeats an outcome only when the line says granted, denied, dismissed, or a
similar result. A party is named only when the entry contains that name.

Jury demand is shown only from a line that says "Jury Demand" and who
demanded it. Jurisdiction basis is shown from an explicit jurisdiction
phrase or from a statute already stored in the cause, such as 28 U.S.C. §
1332. The page also says that the feed may be incomplete and that
allegations are not findings of liability.

## Alternatives considered

- Call the CourtListener or FJC APIs while rendering the page. Rejected: that
  adds latency and a quota to every case view. The stored cause and docket
  text are the free sources already on hand.
- Infer that "Order on Motion to Dismiss" means the motion was denied.
  Rejected: the line does not state the result.

## Benefits

A reader can see what kind of filing each line is, how many orders are
stored, and the jury demand or jurisdiction basis when the record states them.

## Costs and risks

The order count is a case-id index scan plus a word match. It can count a
line that mentions an order inside a motion. The label on the line itself
still follows the court's bracket.

## Reconsideration trigger

Revisit if the order count and the labels disagree often enough to mislead,
or if a free bulk load starts storing jury demand as its own column.

## Rollout

The next production release. No alert writes.
