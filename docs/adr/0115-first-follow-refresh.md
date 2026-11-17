# First follow refreshes the case before the next scheduled poll

Status: Accepted. David asked for this on Nov 17, 2026.

## Context

Following a case is free. The followed-case lane already rechecks a case every 15 minutes, and each check asked CourtListener for the docket, the parties, and one page of entries. A person who just followed a case waited for that lane, and the check spent three requests even when nothing had changed.

## Decision

A new follow returns after an immediate refresh, capped at 12 seconds. The same refresh runs on the existing 15-minute lane. Order:

1. The court's own free feed (district CM/ECF RSS, the seven appellate PACER RSS feeds, or supremecourt.gov for the Supreme Court), plus rows already stored.
2. One CourtListener docket read, using the stored validators, as a change signal (`date_modified`, `date_last_filing`, or HTTP 304).
3. One newest docket-entry page only when that signal is newer than the stored filing date and the free feed did not already have the line.

A daily checkpoint `courtlistener:follow-quota:YYYY-MM-DD` stops at 80 requests. The lane claims cases that have already been refreshed before cases that have never been refreshed, so a full budget serves existing follows first. Lines newer than the stored filing date are inserted with `created_at = now()` and can alert that follower. Older lines on the same page are inserted with `created_at` set to the filing date, so they do not alert and do not enter the 24-hour feed. Restricted text is not stored. `filed_on` stays the court-local calendar date. Parties are not fetched on this path.

## Alternatives considered

- Keep the three-call refresh. Rejected: an unchanged case should not spend a parties request and an entry request.
- Refresh only on the 15-minute lane. Rejected: the first follow is the moment the person is looking at the case.
- Alert every line on the first page. Rejected: a first look at an old docket would email the history.

## Benefits

An unchanged follow costs one CourtListener request, or zero when the free feed already has the new line or the case is at the Supreme Court. A changed case costs two. The documented daily cap is 125; this path keeps 45 requests for other jobs.

## Costs and risks

The follow request can take up to 12 seconds. A free feed that is behind CourtListener still spends the signal and, when the signal is newer, one entry page. The 80-request budget can leave a brand-new follow queued until the next day once existing follows have used it.

## Reconsideration trigger

Revisit if followed cases miss a filing that the free court feed posted, or if the daily checkpoint reaches 80 before the court day ends.
