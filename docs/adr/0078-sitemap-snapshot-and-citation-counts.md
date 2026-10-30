# Stored sitemap pages and precomputed citation counts

Status: Proposed in the follow-up to #536 and #537. Not applied in production until that change is released.

## Context

Four hours after #536, `/sitemap.xml` still listed only `static.xml`, and `sitemap_document` was empty. The citations-lane job `sitemap-snapshot` (`jobs/refresh-sitemap-snapshot.mjs`, hourly, `worker-citations`) was registered. It collected every page cursor before writing a row, then re-ran the indexable scan for each window, and wrote the index only after every kind finished. A pass still walking that cursor list leaves the table empty, and the scheduler skips the next hour while that child is alive. The request path then keeps the static fallback.

The case-page citation total was still about 4.8 seconds after the distinct-document change. Counting "cited by" for one popular reporter key walks every posting. `worker-core` reached 417% CPU while Postgres was nearly idle, from overlapping core-lane Node jobs rather than from database scans.

## Decision

1. The sitemap job writes each page from the ids it just read and publishes the index after that page. A later timeout leaves the pages already stored.
2. `case_citation_count` (migration 0129) holds cited, cited-on-Jurvio, and cited-by per case. The case page reads that row. A missing table or a missing row still runs the live query, so tests and not-yet-refreshed cases keep a number. `citation-count-snapshot` on the citations lane refreshes the table every two hours under its own advisory lock (`jurvio-case-citation-counts-v1`), which is not the citation-graph lock and not the sitemap lock. The first release wrote every row in one statement. That insert commits only at the end, so on the cd1b816 deploy the table was still empty 13 minutes after the worker restarted and case pages still took about 4.7 seconds. The job now commits about 100 cases at a time. A 45-second timeout shrinks the batch. A single case that still times out is skipped and keeps the live query.
3. Core-lane work is staggered and capped, and ingestion jobs stay scheduled. SCOTUS pre-500 and Library of Congress backfill move from every 5 minutes to every 20 and start apart. Enriched SCOTUS drops from 5,000 every 5 minutes to 1,000 every 20. SCOTUS publish drops from 2,000 every 3 minutes to 500 every 10. Judge matching drops from 5,000 to 1,000 per pass. USAO attribution drops from 10,000 every 30 minutes to 2,000 every 60. Federal discovery, material decisions, active-case updates, and historical backfill drop from concurrency 14 to 4. The court-of-appeals lane is unchanged.
4. Cloudflare range fetches send `User-Agent: Jurvio-Diagnostic/1.0 (contact@jurvio.com)` and fall back to `ops/cloudflare-ip-ranges.txt`. The public nginx log format records `CF-Connecting-IP`. Restricting `jurvio-public-web-bootstrap` so ports 80 and 443 accept only Cloudflare ranges is a separate workflow that keeps SSH and does not run with this change.

## Alternatives

- **Leave sitemap generation on the request path.** Already rejected: it hit the web statement timeout and returned 500.
- **Add another per-request citation index.** The distinct-document plan was still 4.8 seconds, because the postings for a popular key are read before the joins shrink.
- **Stop the core jobs that spike CPU.** That would pause federal and SCOTUS ingestion. Lower concurrency and longer intervals keep the same jobs running.
- **Change the DigitalOcean firewall in the same release.** A bad range list would lock public HTTP. The workflow is prepared and gated on `confirm=RESTRICT`.

## Costs and risks

- Citation totals can lag the graph by up to two hours. The refresh uses `publication_current.displayable` only; the live fallback also accepts the latest `publication_decision` when the mirror row is missing, so a case not yet in the table can differ slightly until the job writes it.
- A batch that times out is retried smaller. One skipped case stays on the live query; earlier batches stay stored. The pass can run long enough that the next two-hour tick is skipped while it is still going.
- The first sitemap pass can still take a long time. Pages appear as each one is stored, instead of only at the end.
- Embedded Cloudflare ranges go stale. Workflows try the live list first.

## Reconsideration trigger

Revisit if `citation-count-snapshot` still exceeds its statement timeout after 0129, if `sitemap_document` stays empty after a citations-lane deploy, or if worker-core stays above one core while these lower caps are in effect.

## Verification

Scheduler lane tests include `citation-count-snapshot`. The sitemap reader test still forbids a corpus-wide `row_number()`, and the writer publishes the index inside the page loop. The citation count source reads `case_citation_count` and ignores only SQLSTATE `42P01`.
