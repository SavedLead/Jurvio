# Live district and appeals feeds on their own worker

Status: Accepted. David asked for this on Nov 17, 2026.

## Context

District court RSS feeds and the seven courts of appeals that publish a PACER RSS feed only keep about 24 hours of filings. Those polls ran inside `worker-coa`, next to GovInfo and opinion backfill. Quarantine publishing runs in `worker-core` and can saturate the database. Either one stopping the scheduler process, or starving it, drops filings that the court will not show again tomorrow.

## Decision

`direct-court` and `appellate-pacer-rss` run in a new `live` lane on `worker-live`. A watchdog during New York court hours (weekdays 08:00–18:00) writes `live.stale` when no new district item has arrived in 90 minutes or no new appeals item in 60 minutes. Docker restarts that container, at most once each 30 minutes. Public lists are `https://jurvio.com/feeds/district`, `https://jurvio.com/feeds/appeals`, the homepage “Recently updated cases” band, and `https://jurvio.com/cases`. `https://jurvio.com/api/health/feeds` returns ages only. A feed handler that throws serves the last XML that process built.

## Alternatives considered

- Leave the jobs on `worker-coa`. Rejected: a backfill crash in that process stops the 24-hour polls.
- Restart on any quiet hour, including nights. Rejected: courts do not file overnight, so the lane would restart all night.
- Add a database index for the freshness read. Rejected for this change: the district read uses the existing `last_seen_at` index, and appeals uses the existing BRIN index on `docket_entry.created_at`.

## Benefits

A quarantine or GovInfo failure no longer shares a process with the current-events polls. A stuck lane restarts itself during the day. Monitors can read one JSON URL.

## Costs and risks

One more container and two database connections. A genuinely quiet court morning can restart the lane once. The restart does not create filings the courts have not posted.

## Reconsideration trigger

Revisit if `worker-live` restarts more than twice in a court day while `/api/health/feeds` shows `ok: true`, or if the 90-minute district window misses filings that the court feed then drops.
