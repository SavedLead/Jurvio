# District-Court New-Case Coverage

## Objective

Jurvio must have a tracked, official-source path for every one of the 94 active
federal judicial districts. A court is never silently absent: every court is
classified as either direct-feed capable or covered by authenticated
reconciliation.

## Authoritative directory

Use PACER's live CM/ECF Court Lookup JSON:

`https://pacer.uscourts.gov/file-case/court-cmecf-lookup/data.json`

The audit script derives the full district-court population from this directory
and fails if it does not return exactly 94 courts. This prevents a stale,
hand-maintained list from creating unnoticed coverage holes.

## Per-court source ladder

1. **Official CM/ECF RSS, when verified**  
   Poll at the configured cadence. This is the real-time, no-cost lane for
   newly docketed activity and may expose newly opened cases.

2. **Authenticated CM/ECF New Cases / Civil Cases report**  
   For RSS-negative courts, run a narrow court-specific report using a saved
   cursor (last successful filing time and docket number). This is the primary
   discovery source for newly opened public civil cases. Courts customise
   CM/ECF, so this adapter is court-specific and must be verified before being
   enabled.

3. **PACER Case Locator API daily reconciliation**  
   Query the official national index by court and filing-date window. This
   catches report/feed downtime and confirms that a court has no missed new
   cases. PCL is normally updated daily, so it is never the real-time source.

4. **CourtListener/RECAP reconciliation**  
   Use only as a secondary free cross-check and historical bridge, never as the
   claim that a case is current.

5. **Written Opinions Report**  
   Collect designated judicial opinions independently from new-case discovery.
   The official opinion itself is free, but it does not replace initial case
   discovery because many cases never produce a written opinion.

## Publication and alert rules

- Show case-update subscriptions only if that court has a healthy primary source
  and the individual case is matched with high confidence.
- State the source and update cadence internally for every alert-eligible case.
- Suppress sealed/restricted events and documents.
- Never treat an RSS failure as proof that no case was filed; queue the court for
  CM/ECF/PCL reconciliation.
- Maintain per-court checkpoints, failure counts, cost ledger entries, and a
  visible coverage state.

## PACER operating constraints

PACER's authentication and PCL APIs require the Jurvio PACER account. PCL and
CM/ECF reports are billable under PACER's fee schedule; use strict date windows,
deduplication, rate limits, and a cost ceiling. Run bulk work only during PACER's
recommended 6 p.m.–6 a.m. Central window.

## Running the capability audit

```bash
npx tsx scripts/audit-federal-district-court-feeds.ts > district-court-coverage.json
```

The generated JSON is an operational report, not source code. It records the
official CM/ECF endpoint, the RSS probe result, and the mandatory fallback lane
for every district court.
