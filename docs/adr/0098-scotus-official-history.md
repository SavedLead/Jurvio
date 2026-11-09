# Supreme Court history from the Court, 2017 onward

Status: Proposed. This does not publish cases or send alerts.

## Context

supremecourt.gov covers dockets, filings, orders, and slip opinions from the
2017 docket year forward. The live docket job only walks the current docket
year. CourtListener remains the citation map and, with loc.gov U.S. Reports,
the source for eras the Court site does not cover.

## Decision

A worker job, `scotus-official-history`, resumes from a checkpoint and requests
`https://www.supremecourt.gov/RSS/Cases/JSON/{docket}.json` for docket years 17
through the current docket year: paid `YY-1` upward, in forma pauperis
`YY-5001` upward, and applications `YYA1` upward. Fifteen consecutive 404s end
a series. One request every 1.5 seconds, at most 120 requests in ten minutes,
then the job waits. A docket that already has an official entry is not fetched
again.

Stored rows are draft cases, docket lines, counsel, and filing URLs. PDF bytes
are not downloaded, so filing checksums stay empty. Order-list and slip-opinion
indexes for a finished year are stored as links. Nothing writes an alert table
or a displayable publication decision.

Ongoing new dockets, emergency applications, orders, and slip opinions already
read supremecourt.gov. The CourtListener API live tail stays off, and the
federal bulk loaders skip `scotus`.

## Alternatives considered

- Copy CourtListener text onto 2017-and-later opinions. Rejected: the Court
  site is the source for those years.
- Download every filing PDF in the same pass. Rejected until a disk budget is
  set. Links are stored now.

## Benefits

The ingestion worker can fill 2017 through now without a person re-running a
script, and a restart continues at the checkpoint.

## Costs and risks

At about 1,200 requests an hour, a full walk is on the order of tens of hours
if most numbers exist, and longer if the Court answers 429. That figure is an
estimate from the rate, not a promise. Fifteen 404s in a row end a series even
if a later number exists.

## Reconsideration trigger

Revisit if the Court publishes a bulk docket file, or if a measured disk budget
allows filing-PDF download.

## Rollout

Deploy migration 0202 with the application. The job starts on worker-core.
Rollback is to stop the job and leave the draft rows; they are not public and
not alert inputs.
