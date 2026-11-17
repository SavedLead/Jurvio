# An emergency application number does not 404

Status: Accepted after the 1:22 AM ET check on 2026-11-17. 26A688 was listed and its page returned 404. The other twelve applications on that list returned 200.

## Context

The list reads `scotus_application`. The application page uses the same row, then extra case and opinion lookups. A statement timeout on those lookups discarded the row and the page called `notFound()`. The Court's own docket for 26A688 was public.

## Decision

A well-formed application number always renders. When Jurvio has the row, the page shows it. When the full read times out, a shorter read of the application and its docket lines is used. When no row is stored, the page links to the Court's public docket (`26a688.html`) and does not invent a date. Dates that are shown stay on the Eastern calendar the Court uses.

## Alternatives

- Leave the 404 until the next ingestion run. Rejected: the list already links to the page.
- Hide the list row. Rejected: the application is public on supremecourt.gov.

## Benefits

26A688 and any later number that is listed before its lines are stored open instead of 404.

## Costs and risks

A page with only the Court link is thin and is `noindex`. The shorter read omits the Jurvio case link until the full read succeeds.

## Reconsideration trigger

Revisit if the short read still times out, or if the Court changes the public docket URL.
