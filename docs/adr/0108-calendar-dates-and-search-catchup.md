# Calendar dates and search catch-up

Status: Accepted for the filing-date display bug and the bulk-publish search gap, 2026-11-10.

## Context

At 11:48 PM ET on November 9, 2026, the case listing showed Eastern District of California matters `1:26-cv-09271` and `1:26-cv-09272` as filed November 10. The feed stores a timestamp. Taking the first ten characters of the UTC instant, or formatting that instant in UTC, uses the next calendar day while the court is still on November 9. A date-only value formatted with the server zone on one side and the browser zone on the other also disagrees across hydration.

`/cases` showed 811,501 published cases while `/coverage` counted a larger published corpus. `scripts/bulk-publish-complete-drafts.sh` sets `jurvio.defer_search_refresh` inside each publish transaction, so the text index (`public_case_search`) is not updated there. The bulk job was already running and must keep running. Follower alerts key off `legal_case.updated_at`, which that job already leaves unchanged.

The sitemap stored only cases whose current decision was indexable. Bulk publication marks those rows displayable and not indexable, so a rebuild of the old query would still omit them. The sitemap writer stores XML. It does not call Google.

## Decision

1. Date-only fields are formatted from the year, month, and day. A timestamp is converted in the court's IANA zone. When the caller has no court zone, the fallback is `America/New_York`. Clock times use that zone and the label `ET`. The district feed writes `filed_on` from the court zone. A later sighting of the same event replaces a stored UTC day with the court day and assigns `updated_at` to itself.
2. A separate ingestion-host script corrects filing days seen in the last three days when the stored day equals the UTC day and differs from the court day. It sets `updated_at` to its current value. The same script inserts missing `public_case_search` rows in batches of 500 with a short pause. Future bulk runs do one such slice after each committed range, outside the deferred transaction. Neither path cancels the running bulk job or runs on web-01.
3. Sitemap case pages include every displayable published case that is not search-excluded. The scheduled citations-lane snapshot rebuilds the stored files after deploy. This change does not submit the sitemap to Google and does not start an extra sitemap pass on web-01.

## Alternatives

- **Format every date in UTC.** That is the bug. A Pacific filing late in the evening becomes the next day.
- **Format every date in Eastern time, including date-only columns.** A `YYYY-MM-DD` value read as UTC midnight shifts back one day for most of the United States.
- **Turn search refresh back on inside the bulk transaction.** Each range would refresh the index while holding the publish transaction. That is the load the deferral was added to avoid, and the running process would not pick up the edit.
- **Restart the bulk job so it runs the new script.** That drops the in-flight range and was ruled out.
- **Keep the sitemap limited to indexable opinion pages.** Bulk-published cases would stay out of the sitemap after a rebuild.

## Costs and risks

- A timestamp that was stored to mean a calendar date at exactly UTC midnight moves to the previous Eastern day. Date columns are still formatted as themselves.
- The catch-up reads party names for each new search row. Batches are 500 rows, with a 30 second statement timeout and a 3 second lock timeout, so a slow batch is skipped instead of piling onto the bulk job.
- The date correction only rewrites rows seen in the last three days whose stored day matches the UTC day. Older UTC-shifted feed dates stay until the feed sees them again.
- The sitemap gains a URL for each displayable published case. The next scheduled snapshot on the citations lane does more work than an opinion-only pass. It still writes stored pages and does not run on the request path.

## Reconsider when

Revisit the fallback zone if a court outside Eastern time shows filing days that are still one day off after the court-zone conversion. Revisit the catch-up batch size if the text index falls more than one bulk range behind for a full scheduler interval, or if the ingestion host's database CPU stays high while both jobs run. Revisit sitemap inclusion if displayable metadata-only case pages should stay out of the index.
