# Federal ingestion, top down

Planning only. This document does not change ingestion, publish anything, or spend money. The section "Why it stalls around 600k cases" is the bottleneck analysis David asked for after two months of the current flow. It records what the repo already runs and the order David Rosenberg set on October 29, 2026: Supreme Court from supremecourt.gov, then the 13 courts of appeals from their own sites, then the 94 district courts, with CourtListener as the cheap historical fill. Federal metadata publication stays off until David turns it on.

Evidence is the code and docs on `main` at `0eff794`, plus cited public pages. This pass did not open a production session, so "running" means the job is on a `restart: unless-stopped` worker in `docker-compose.production.yml` and in `scripts/scheduler-jobs.ts`. Last-success times below are the ones written in ADRs and workflow comments, not a fresh log tail.

## Capacity we have to stay inside

web-01 is the ingestion box and the Postgres box: 8 vCPU, 16 GB RAM, 320 GB disk, database about 34 GB. ADR 0077 recorded the box at 33% disk on October 29, 2026. The public site uses the same Postgres. `worker-core` was capped for that reason (federal loops at concurrency 4, SCOTUS parsers every 20 minutes). New work stays on these containers. No new droplet and no new managed database.

`worker-coa` was not part of that cap. It still runs appellate discovery at concurrency 13 and processing at concurrency 52 every 5 minutes, on the same Postgres.

## What "official" means here

An official byte is one we fetched from the court's own host (or govinfo.gov for a court that publishes there) and stored as a raw artifact with a checksum. CourtListener, RECAP, and PACER-derived copies are supplements. They can fill a hole. They do not overwrite an official artifact, an official date, or an official caption.

Identity is the one already in ADR 0075: court plus docket number when both exist; otherwise a provider-scoped opinion id that resolves to the stored source record and a verified court. A caption alone does not merge two cases. Sealed, restricted, minor, juvenile, grand jury, and qui tam text stays out (`isRestrictedDocketText`).

## 1. Supreme Court

### Already built

| Piece | Where | What it fetches |
|---|---|---|
| Current-term slip opinions | `scotus-enriched` on `worker-core`, every 20 minutes, `--term` = current October Term, `--limit=1000` clamped to 100 for network stages | `https://www.supremecourt.gov/opinions/slipopinion/{term}` and the linked PDFs |
| Dockets for opinions we already have | Same job calls `ingestOfficialScotusDockets` | `https://www.supremecourt.gov/docket/docketfiles/html/public/{docket}.html`, plus a petition PDF when the page links one |
| Publish and text extract | `scotus-publish` every 10 minutes, `--limit=500`; the enriched job also publishes and extracts | Official candidates only. This is not the federal metadata flag |
| U.S. Reports PDFs | `scotus-pre500-backfill` every 20 minutes, up to 4 volume workers | supremecourt.gov bound volumes. Completed volumes are skipped. Volumes 91–501 that the Library of Congress path already covered are skipped. If nothing is unfinished, the process prints that and exits |
| Early volumes the Court's PDF parser cannot read | `loc-us-reports-backfill` every 20 minutes, 1 worker, 5 second pause | loc.gov volumes 2–111 by default |
| Manual repair | `scotus-freshness-guard.yml` | `workflow_dispatch` only. The schedule was removed because a 20-minute cap cancelled runs that needed about 27–29 minutes (runs 40437521053, 40419301760, 40389266736) |
| Public links only | `src/modules/scotus/domain/court-reference.ts` | Docket search, argument calendars, granted-and-noted list, orders of the Court, argument transcripts, argument audio. Nothing ingests those URLs |

Lane rule: SCOTUS jobs are rejected if they are placed on `coa` or `citations`.

### Production evidence

The on-box scheduler is the live path. ADR 0077 (late October 2026) says `worker-core` is what publishes SCOTUS after the DO-host workflow was retired, and that about 12,000 already-approved opinions had been waiting on that missing lane. The July 28, 2026 coverage audit (`docs/44-scotus-corpus-coverage-audit.md`) counted 68 published slip opinions and zero structured docket events on the sampled case. That audit is stale relative to the docket ingester that exists now; it is not a current corpus count.

### Gaps against David's rule

David's rule: every update for cases that are open or in the current term; no polling of closed or out-of-term cases; then backfill from recent backwards.

What runs today re-reads the current-term slip index every 20 minutes, then walks dockets only for opinions already staged. A granted case with no opinion yet is not on that list. Orders, the argument calendar, the granted-and-noted list, transcripts, and audio are display links, not connectors. There is no SCOTUS RSS client in the repo.

The bound-volume and Library of Congress jobs are backfill, not closed-case polling. They still wake every 20 minutes. After the unfinished volumes are done, each wake should exit immediately. Until then, `scotus-pre500-backfill` can still run four volume parsers. That is historical work on `worker-core`, competing with the current term.

### Plan

Keep the 20-minute current-term slip poll. Add three small current-term page reads on the same job, each capped at one HTTP response: orders of the Court, the argument calendar, and the granted-and-noted list. From the granted list, maintain the set of docket numbers that are in the current term and not yet decided. Poll those docket HTML pages once a day. When a docket shows a decision, or the term rolls, drop it from the daily set. Do not fetch dockets for older terms on this timer.

Backfill stays newest-first and one term or one volume at a time, on the existing coordinators. Do not add a fifth SCOTUS timer. Do not raise the 100-record network cap.

Cadence: slip index every 20 minutes (already); orders, calendar, and granted list every 60 minutes; open-docket HTML once a day; closed dockets never.

Disk: a term of slip PDFs and docket HTML is tens of megabytes. Bound-volume PDFs are the only SCOTUS object that can use gigabytes. They already land on the artifacts volume. Do not copy them into Postgres.

## 2. Courts of appeals

Thirteen courts: First through Eleventh Circuits, the D.C. Circuit, and the Federal Circuit. `APPELLATE_COURT_REGISTRY` has all thirteen, all `enabled: true`.

### Already built

| Piece | Where | What it does |
|---|---|---|
| Opinion discovery and publish | `appellate-official` on `worker-coa`, every 5 minutes, `--discovery-concurrency=13`, `--processing-concurrency=52` | Fetches each court's `opinionsUrl` HTML and keeps PDF links. Idempotent on `(court_code, document_url)`. Publishes the opinion when native text (or a small OCR retry) succeeds. This path does not consult the federal metadata flag |
| Freshness row | `appellate_source_registry` | `last_successful_retrieval`, `health_state`, `consecutive_failures`, `next_poll_at` |
| Govinfo history | `appellate-govinfo-backfill` every 7 minutes, `--court=next`, page size 1000, up to 10 pages | One circuit cursor per cycle, newest packages first. `GOVINFO_API_KEY` falls back to `DEMO_KEY`, and a demo key is forced to 1 page per cycle |
| RSS URLs | Seven courts in the registry | ca1, ca2, ca3, ca4, ca7, ca9, cafc have `rssUrl`. ca5, ca6, ca8, ca10, ca11, and cadc are `null`. Discovery never reads `rssUrl`. It only GETs `opinionsUrl` |
| CourtListener appellate REST | Removed from the scheduler | Comment in `scheduler-jobs.ts`: the v4 API returned 429 and published nothing. Bulk download remains the historical supplement, and it is not on a timer |
| Ops note | `docs/operations/appellate-ingestion.md` | Says the safe start was discovery 4, downloads 8, native extract 4, OCR 2. The live scheduler is far above that. PACER is disabled for this lane |

`appellate-backfill-report` runs every 15 minutes and only reports.

### Production evidence

`worker-coa` is `restart: unless-stopped`, so the 5-minute cycle is the resident loop. The lane watchdog (`.github/workflows/lane-watchdog.yml`, every 15 minutes) recreates the container when `coa.alive` is older than 180 seconds. A SCOTUS lane once sat dead for about 28 hours until a human restarted `worker-core`; the watchdog exists because of that. There is no dated "last successful circuit fetch" in the docs from this pass.

### Gaps

Ongoing updates exist, but they scrape HTML listings, including courts whose registry already names an RSS or XML feed. HTML parsers break when a court redesigns a page. RSS is the stabler ongoing signal where it exists.

The processing concurrency of 52 is the opposite of the `worker-core` throttle. It shares Postgres with the public site.

Govinfo backfill is newest-to-oldest per circuit, which matches David, but a demo key crawls one page per 7 minutes.

### Plan

Leave the 5-minute listing poll in place so current opinions keep moving. First code change, after David agrees: drop `processing-concurrency` from 52 to 8 and OCR retries stay at the existing default of 8 items. Discovery can stay at one worker per circuit (13) because those are single page fetches.

Then teach discovery to prefer `rssUrl` when it is non-null, and keep the HTML listing for the six courts without a feed. Same idempotency key. Same publish rule.

Govinfo stays the backfill, one circuit per cycle, newest package first. A free api.data.gov key, if David puts it in `GOVINFO_API_KEY`, raises the cycle from 1 page to the scheduler's 10. That is a free key, not a new service. Do not put the CourtListener appellate REST job back.

Cadence: listing or RSS every 5 minutes; govinfo historical cursor every 7 minutes; no poll of a circuit's old opinions except through that backfill cursor.

Disk: store each official PDF once on the artifacts volume. Do not also store the CourtListener copy of the same opinion. Judicial Business 2025 reports 41,824 filings in the regional courts of appeals. That is filings, not opinions, and it is the scale of this lane: large for a scraper, small next to district and bankruptcy filings.

## 3. District courts

There are 94 district courts. Migration `0097_all_district_court_source_registry.sql` inserts 94 rows. `scripts/scout-district-court-sources.ts` throws if the PACER CM/ECF directory does not return 94. The directory is `https://pacer.uscourts.gov/file-case/court-cmecf-lookup/data.json`. U.S. Courts describes the same 94: 89 state districts plus Puerto Rico, the Virgin Islands, the District of Columbia, Guam, and the Northern Mariana Islands.

Bankruptcy courts are separate units of the district courts. U.S. Courts says there are 90 of them. Judicial Business 2025 reports 557,376 bankruptcy petitions that year, against 382,692 district-court filings. This program does not ingest bankruptcy. `isNonBankruptcyFederalJurisdiction` already keeps bankruptcy out of the federal publisher, and the bulk opinion importer leaves bankruptcy off unless `--include-bankruptcy` is passed.

### Already built

| Piece | Where | What it actually does |
|---|---|---|
| All 94 endpoints, RSS off | `direct_court_registry` via migration 0097 | Every row is inserted with `rss_available = false`. The comment says RSS stays off until an audit sees XML |
| Twelve courts hardcoded on | `FEDERAL_COURT_REGISTRY` in `src/modules/ingestion/providers/courts/registry.ts` | txwd, nysd, njd, cand, casd, wawd, ded, dcd, mad, flsd, cacd, txed. Each has `rss_outside.pl` and `rssAvailable: true`, coverage window 24 hours |
| Live RSS poll | `direct-court` on `worker-coa`, every 5 minutes, `--court=all` | Polls only those twelve. Stores the feed XML as an `official_cmecf` artifact and opens cases from new items. It does not read `direct_court_registry.rss_available` |
| Weekly scout | `district-court-source-scout` on `worker-core`, every 7 days, `--limit=94` | Read-only. Writes `/var/lib/jurvio/artifacts/reports/district-court-scout.json`. No PACER login, no document download |
| Weekly audit workflow | `district-court-source-audit.yml`, Sundays 00:15 UTC | Runs `scripts/audit-federal-district-court-feeds.ts` on the builder and uploads `district-court-coverage.json` for 7 days. It does not update the registry |
| "Federal" case loops | `federal-new-cases`, `federal-material-decisions`, `federal-active-cases`, `federal-history`, `federal-publication` on `worker-core` | These are CourtListener REST streams (`ingestCourtListenerDocket`, `ingestCourtListenerOpinionCluster`), not court websites. Concurrency 2–4. New cases and material decisions every 20 minutes; active cases every 6 hours; history every 24 hours; publication every 12 minutes |
| Opinion chunk import | `worker-federal-import`, heap 768 MB, `restart: on-failure:20` | Imports CourtListener bulk opinion chunks from the artifacts volume. ADR 0077: 44 of 384 chunks of the 2026-09-30 snapshot were done (~44,000 of 383,824 matched opinions). Two detached launches on October 27 (runs 40487336239 and 40487685592) did not move the ledger. Remaining work was estimated at 4–6 hours at 20–25 opinions/second once the files are on the volume |

The ops doc `docs/operations/district-court-new-case-coverage.md` also describes authenticated CM/ECF reports and the PACER Case Locator as paid fallbacks. Neither is on the scheduler. PACER stays off.

### Production evidence

`federal-publication` is resident and will publish when the gate passes. ADR 0077: on October 27, 86,795 cases sat in `federal_publication_hold` (83,033 `missing_readable_content`, 17,564 `unverified_court_record`, 21 `duplicate_identity_collision`; tags overlap). Metadata-only publication is behind `JURVIO_PUBLISH_FEDERAL_METADATA_WITHOUT_OPINION_TEXT`, default off, enabled only by `enable-federal-metadata-publication-once.yml`. That flag stays off.

The twelve-court RSS poll is resident on `worker-coa`. Whether those feeds returned XML on a given day is not in the docs from this pass. The DB registry still says RSS is unavailable for every district, including the twelve the TypeScript list polls. Those two lists disagree.

### Gaps

Eighty-two districts have a row and no poller. The scout and the Sunday audit observe feeds and then throw the report away after 7 days. They never flip `rss_available`.

CM/ECF RSS, where a court serves it, is a free outside feed of recent docket events. The registry's own window is 24 hours. It does not contain the PDF. A missed day cannot be repaired from that feed. Backfill has to come from somewhere else.

Polling all 94 feeds every 5 minutes would copy the `worker-coa` pattern onto a much larger set. The twelve-court poll is already every 5 minutes on that worker.

### Plan

Treat the weekly scout as the inventory, not a second hand-maintained list of twelve. One registry: `direct_court_registry`. The scout may set `rss_available` only after it has fetched XML. The poller reads that flag. Until the scout has verified a court, that court is not polled. The twelve hardcoded courts stay polled only if the scout agrees; if the scout disagrees, the DB wins and the TypeScript list stops being the source of truth.

Cadence for a verified court: every 6 hours, staggered by court code, so a 24-hour feed is read four times and the box is not hitting 94 hosts at once. Unverified courts: no poll. The Sunday audit keeps running as the check that the scout and the registry match.

Backfill, after ongoing RSS is stable: CourtListener bulk dockets and opinion chunks, newest filing year first, one year-window at a time, concurrency 2, on `worker-core` or `worker-federal-import`. Not the REST API. Not PACER. Delete each compressed chunk after the ledger says it imported (`docs/35-courtlistener-bulk-backfill.md`).

Bankruptcy waits until David asks for it. The petition volume is larger than the district docket, and the current publisher is built to exclude it.

Disk: RSS XML is small (the scout caps HTML/XML reads at 1 MB per page). The growth risk is opinion text and any PDF we choose to keep. Do not download PACER documents. For the CourtListener text import, measure one finished chunk's bytes in Postgres before scheduling the rest. A planning sketch, not a measurement: if extracted text averaged 20 KB, about 340,000 remaining opinions would be on the order of 7 GB before indexes, on top of a 34 GB database. Indexes and the artifact files add more. Stop the import if free disk on the 320 GB volume falls below 30% or if public-page latency moves.

## 4. CourtListener

### Already in the repo

- REST v4 for federal docket and opinion streams (`scripts/run-federal-ingestion-loop.ts`), opinions (`scripts/ingest-courtlistener-opinions.ts`), and a bounded update command (`scripts/ingest-courtlistener-updates.ts`). Docs say the default token allowance is 5 requests per minute, 50 per hour, and 125 per day, with a 12.5-second gap. A missing or rejected token ends the federal cycle without moving the cursor.
- Quarterly bulk snapshots: courts, federal dockets, appellate opinions, federal opinions, citation map. `docs/35-courtlistener-bulk-backfill.md` says stream the compressed CSV, do not leave it decompressed on the server, and delete it after verification.
- Citation lookup is the bulk citation file plus a small REST discovery budget (`--discover=10` on the citations lane). The appellate REST backfill was removed after 429s.
- RECAP is the free PACER mirror inside those bulk docket and opinion files. The repo's rule is to check it before any paid PACER fetch. Paid PACER is not scheduled.
- People and judges: FJC roster on `worker-core` daily, CourtListener people as a one-shot workflow.
- MCP (`https://mcp.courtlistener.com`) is documented as an agent research tool, not as ingestion.

### What CourtListener sells, and what to use

Checked against CourtListener's own help pages and the Free Law Project post of May 7, 2026. Dollar membership rates on a third-party blog are not repeated here.

| Offering | Fit | Recommendation |
|---|---|---|
| Bulk CSV snapshots on S3, regenerated quarterly (last days of March, June, September, December). Snapshots, not deltas | Historical opinions, dockets, citations, judges. Free to download | Primary way to "get everything" we do not already have from the courts. Keep the streaming importers. This is the economical path |
| REST API v4. Free Law Project: a member can call the APIs, including PACER/RECAP APIs that used to need a separate agreement. Our docs and the long-standing default are 5/minute, 50/hour, 125/day. New accounts get that default; older heavy tokens were grandfathered | Live deltas and citation lookup | Keep for gaps and citation checks only. The federal loops already hit this ceiling. Do not point 94 courts at it |
| RECAP archive, included in the bulk files and the API | Federal documents someone already bought from PACER and donated | Use the copy inside the bulk snapshot. Do not buy PACER pages to fill holes |
| Webhooks (docket updates, alerts, RECAP fetch completion). CourtListener says organizations are charged and they will contact you. No public price | Would replace polling | Do not turn on. A fee conversation is a David decision, and RSS plus the quarterly snapshot cover the plan without it |
| Search and case alerts | Human or agent alerts | Not an ingestion bus |
| Citation lookup API | Same rate limit as the rest of REST | The bulk citation file remains the batch path. API lookup stays at the existing discover budget of 10 |
| Database replication: they host a logical Postgres replica (case law, RECAP, FJC civil, oral arguments, disclosures, judges) and bill a resync if the subscriber falls behind. No public price. It is a new managed database | Would duplicate our Postgres | Do not buy. It adds a service, a bill, and a second copy of data we are already putting in our own schema |

### Plan

One CourtListener role: historical fill and citation edges. Official feeds stay the live source for SCOTUS, the circuits, and any district whose RSS the scout has verified.

Order inside that role, matching `docs/35`: courts (done as a prerequisite), then recent federal dockets, then opinion text for cases we will actually publish, then citations. SCOTUS text stays on the official PDFs even if a bulk row exists.

Do not raise the REST rate, do not open a webhook, and do not subscribe to replication unless David sees a price and asks for it.

## Cross-source merge

1. Official artifact wins for bytes, decision date, and caption when the official record has them.
2. CourtListener may attach a cluster id, a citation, and opinion text only where we have no official text. It is stored as provider data with its own artifact. Publication still requires the federal gate, which stays in metadata-off mode.
3. Merge key: normalized court code plus normalized docket number. If the docket is missing, the provider-scoped id path from ADR 0075. Collision (`duplicate_identity_collision`) holds the case. Do not auto-merge.
4. A district RSS item that matches an existing CourtListener case updates the same `legal_case` and records the official fetch. It does not create a second case.
5. Appellate opinions already publish on their own official path. That stays. It is not a license to flip the federal metadata flag.

## CPU and throttles

| Worker | Leave it like this |
|---|---|
| `worker-core` | Pool max 2. Federal loops max concurrency 4. SCOTUS network stages max 100. No second historical backfill beside the one already running (bound volume or LoC or federal history, not all three piling new work) |
| `worker-coa` | Do not add courts here except the existing twelve until the scout is the registry. Recommended first change: processing concurrency 52 → 8. Discovery stays a single page fetch per circuit |
| `worker-federal-import` | Stays at 768 MB heap and pool max 2. It is the bulk opinion writer. Do not put RSS polls in it |
| `worker-citations` | Unchanged. Citation bulk resolution stays daily and resolve-only |

Public pages keep the existing search and case-page limits. If a backfill coincides with public latency moving back into seconds, the backfill stops and the pollers stay. Pollers are small HTTP reads. Backfills are the Postgres writers.

## Monitoring

Already present:

- `scheduler_lane_run` records each child exit, duration, and error tail.
- Lane watchdog recreates `worker-core`, `worker-coa`, and `worker-supervisor` when the heartbeat file is older than 180 seconds.
- `appellate_source_registry.last_successful_retrieval` and `health_state` are per circuit.
- `appellate_worker_heartbeat` older than 10 minutes is the stall signal the appellate cycle already selects.
- District scout JSON and the Sunday audit artifact are the feed inventory. They are not a freshness alarm.

Add, when implementation starts, one read-only freshness row per court, filled by the poller that already ran:

- SCOTUS: age of the newest current-term slip index fetch. Page is late if that age exceeds 3 hours during a week the Court is in session.
- Each circuit: age of `last_successful_retrieval`. Late if over 6 hours.
- Each district with `rss_available`: age of the last stored `official_cmecf` feed. Late if over 12 hours (the feed window is 24 hours, so 12 hours leaves one retry).
- Districts with RSS off: not late. They are "unverified," which is a coverage state, not an outage.

Alarm by the existing lane health path. Do not add a metrics host.

## What needs David's approval

1. This order and the decision to leave bankruptcy out.
2. Federal metadata publication remains off. No one runs `enable-federal-metadata-publication-once.yml`.
3. No PACER login, no PACER Case Locator, no CM/ECF paid report.
4. No CourtListener webhook, replication, or paid membership unless he is shown a price first.
5. Whether `worker-coa` processing concurrency drops from 52 to 8 before more district feeds are added. Recommended yes.
6. A free GovInfo API key in production if he wants the appellate backfill to do 10 pages per circuit instead of 1.
7. After the scout has marked a real RSS set, approval to poll those districts every 6 hours.
8. After one opinion chunk has been measured for disk, approval to let `worker-federal-import` finish the 2026-09-30 remainder.

## Implementation phases

Each phase is a later change. None of them is authorized by this document.

1. SCOTUS open-docket set. Orders, calendar, and granted list on the current-term job. Daily docket HTML only for dockets still open. Stop when the term ends.
2. Appellate RSS for the seven courts that already have a URL, HTML retained for the other six, and the concurrency drop if approved.
3. Point the district poller at `direct_court_registry`. Let the scout set `rss_available`. Stagger verified courts every 6 hours.
4. Resume CourtListener bulk opinion import only after the disk measurement, newest chunks first, then docket years newest to oldest for districts that have no official text.
5. Freshness query and a line in the lane watchdog output. Still no new infrastructure.

## Reconsideration

Open bankruptcy only if David asks, and only after district RSS coverage is visible per court. Buy a CourtListener feature only with a written price and a gap the quarterly bulk file cannot fill. Add a droplet only if, after the concurrency drop, Postgres CPU or public-page time is still dominated by these pollers. The pollers are designed not to be that load. The backfills are.

## Why it stalls around 600k cases

David's report: more than two months of the current flow produced about 600,000 cases, and the jobs keep getting stuck. He suspects a full-corpus re-scan about every 30 seconds.

There is no federal timer at 30 seconds. The 30-second loop in the scheduler is the liveness heartbeat, a write of one timestamp (`scripts/run-production-scheduler.ts` lines 143–151). The CourtListener client comment at `src/modules/ingestion/providers/courtlistener/client.ts` lines 56–59 says an older 30-second HTTP abort was replaced by a 60-second timeout because heavy list pages were being killed and retried. What looks like a continuous re-scan is a child that never exits. `run()` skips the next tick while that child is still alive (`scripts/run-production-scheduler.ts` lines 51–54). One long child is the whole lane for that job.

About 600,000 cases in about 60 days is about 10,000 cases a day if the inserts were steady. The documented free CourtListener cap is 5 requests per minute, 50 per hour, and 125 per day (`docs/34-courtlistener-mcp-and-live-ingestion.md`). A new docket costs at least three requests (the docket, its parties, and its entries). That cap is on the order of 40 new dockets a day, which cannot produce 600,000 cases. So most of those cases came from a faster token, from the bulk importers, or from both. The live loops can still be stuck re-processing rows that are already stored, and they are what keep the website's database busy.

### The live CourtListener path re-fetches rows it already has

`federal-new-cases` (`scripts/scheduler-jobs.ts` lines 204–215) runs every 20 minutes with `--max-items=25000`. `runDocketStream` pages the REST docket list and, for every row, calls `ingestCourtListenerDocket` (`scripts/run-federal-ingestion-loop.ts` lines 315–324 and 351–391). That function always performs a fresh HTTP GET of the docket, then the parties, then the entries (`src/modules/ingestion/application/ingest-courtlistener-docket.ts` lines 15–28). The list call does not send `If-None-Match` or `If-Modified-Since`. The client stores an ETag on the response (`client.ts` lines 108–118) and never sends one (`retrieve`, lines 54–106).

Each docket entry is its own transaction, and each document inside an entry takes an advisory lock (`src/modules/ingestion/application/ingest-courtlistener-docket-entries.ts` lines 19–28 and 84–86). A case with 30 entries is 30 commits plus one JSON artifact file per entry (lines 21–26). At 600,000 cases, even a modest 10 entries each is millions of small files on the artifacts volume. That is a plausible reason the box feels stuck before the database fills up.

The cursor itself is real (`ingestion_checkpoint`, lines 201–214 and 390–441). New-case discovery slides a two-day `date_modified` window (`lookbackDays` defaults to 2, line 81). Historical backfill walks one year at a time from 2000 (`federal-history`, every 24 hours, `--max-items=20000`, scheduler lines 259–270; window math at lines 255–261 and 430–438). A 401 or network failure exits without moving the cursor (lines 366–376 and 999–1005), so the next cycle repeats the same page. That is correct for not skipping data, and it is also how a bad token becomes a retry loop.

Cost, using the documented free caps: about 40 new dockets a day, so 5 million cases is on the order of centuries. If production is actually inserting about 10,000 cases a day, 5 million is still about 500 days, and only if none of those requests are repeats.

### Active updates select the same old rows again

`federal-active-cases` runs every 6 hours with `--max-items=15000` (scheduler lines 246–257). The query is every federal docket id, oldest `source_updated_at` first, nulls first (`scripts/run-federal-ingestion-loop.ts` lines 471–486). There is no "fetched after" watermark. `persistCourtListenerCase` sets `source_updated_at` to the CourtListener modification time (`src/modules/ingestion/application/persist-courtlistener-case.ts` lines 81 and 121), not to "we just downloaded this." A docket last modified in 2014 stays at the front of the sort after we download it. The next cycle, and the one after that, downloads those same 15,000 dockets again, each with parties, entries, a transaction per entry, and a new artifact when the body hash changes.

15,000 dockets times 3 requests is 45,000 requests. At 50 requests per hour that child runs for weeks. The scheduler then skips every later 6-hour tick. The job looks wedged because it is re-reading the oldest slice of the corpus for as long as the process lives.

### Material decisions have no cursor

`federal-material-decisions` runs every 20 minutes with `--max-items=25000` (scheduler lines 217–228). It counts recent docket entries for every court (lines 549–568), then for every federal court asks CourtListener for up to 250 newest cluster ids filed in the last two days (lines 588–601, cap at line 75). `fetchOpinionClusterIds` (`client.ts` lines 147–172) does not set a page size, so it uses the API default and follows `next` until it has 250 ids. It does not remember which ids were stored last time. Each id then fetches the cluster, the docket, and every opinion (`ingest-courtlistener-opinion-cluster.ts` lines 22–31).

Roughly 100 federal courts times a few list pages is hundreds to a thousand requests before a single opinion is saved, every 20 minutes, for opinions filed in a two-day window that were already saved on the previous run. At the free hourly cap this child does not finish inside 20 minutes, so it becomes the permanent occupant of that schedule.

### Publication re-scans drafts

`federal-publication` runs every 12 minutes, up to 5,000 cases (scheduler lines 230–244), in chunks of 250 (`PUBLICATION_CHUNK_SIZE`, line 78; loop at lines 947–956). `selectPublicationCandidates` (lines 669–789) is one row per draft case with many correlated subqueries: identifier count, a collision count the comment says used to be about 1.5 seconds per row before the docket index (lines 687–699), rejection count, three existence checks, a document count, and `string_agg` of every docket-entry description and every document title (lines 717–722). That aggregation is there to spot sealed text. It reads the whole docket of each candidate on every pass.

Cases that stay `draft` (the metadata flag is off, and most holds are `missing_readable_content`) come back on the next chunk. The query is the one most able to slow the public site, because it runs on the same Postgres and it is not a small keyed read.

### Appellate, district RSS, and the chunk importer

Appellate discovery downloads each circuit's full HTML listing every 5 minutes with no `If-None-Match` (`src/modules/ingestion/providers/appellate/official-opinions.ts` lines 46–51). It then inserts or updates one row per PDF link (`discover-official-appellate-opinions.ts` lines 14–33). The body hash is stored only after the download. Processing concurrency 52 then does per-item download, extract, and publish transactions.

The twelve district RSS feeds are fetched in full every 5 minutes, also with no conditional headers (`src/modules/ingestion/providers/courts/cmecf-rss.ts` lines 66–78).

The opinion chunk importer is the fast path and it is still row-at-a-time. For each opinion it looks up the cluster, writes one JSON file, and commits one transaction (`import-federal-opinion-chunk.ts` lines 66–99; `write-bulk-opinion-graph.ts` lines 93–100). ADR 0077 measured about 20–25 opinions a second once the files were readable: on the order of 70,000–90,000 opinions an hour. That is opinions whose cases already exist, not new cases, and it still multiplies files. It is not a `COPY`.

### What this costs against 5 million cases

| Path | Pace | Time to 5 million cases |
|---|---|---|
| Documented free REST cap, 3 requests per new docket, no repeats | about 40 cases a day | on the order of centuries |
| The observed ~10,000 cases a day, if every request were a new case | about 400 an hour | about 500 days |
| Same pace, with active-updates and material-decisions spending the token on rows already stored | lower, and the website shares the database | longer than 500 days, and the public pages slow down while it runs |
| Throttled bulk merge below | 5,000–20,000 cases an hour in a quiet window | a few weeks of nights |

The 5,000–20,000 figure is a planning target, not a benchmark. Raw `COPY` is faster than that. The cap is there so the merge stays off the public site's latency budget. Measure the first night and keep the number that does not move public-page time.

## Architecture that gets to millions without touching the site

Two pipes. They do not share a worker pool with request handling.

**Backfill pipe.** CourtListener quarterly bulk files only. Stream the compressed CSV from S3. `COPY` into an unlogged staging table in a quiet window (after the public traffic peak, one session, `statement_timeout` set, concurrency 1). Then one set-based `INSERT … ON CONFLICT` into the canonical tables. Delete the staging rows and the transport file when the checkpoint for that file is written. Do not write a JSON artifact per row. The snapshot file plus the row's content hash is the provenance. Do not call the REST API inside this pipe.

**Live pipe.** One watermark per source, advanced only after a successful fetch:

- SCOTUS: last slip-index fetch time, plus the set of open current-term docket numbers. Orders, calendar, and granted list as in the earlier section.
- Each circuit: `ETag` / `Last-Modified` on the listing or RSS. Skip the body on 304. The existing `appellate_source_registry.last_successful_retrieval` is the watermark.
- Each verified district: the RSS item guid or the hash of the feed, and the last successful fetch. No feed, no poll.
- CourtListener live tail, only after the bulk load: `date_modified` greater than the max `date_modified` already merged from the snapshot. One list page per cycle. No per-docket entry crawl unless that docket is on a watched case.

**Dedupe keys**, in order:

1. CourtListener docket id (`case_identifier` type `courtlistener_docket_id`) for bulk and REST rows.
2. Normalized court code plus normalized docket number (the same `regexp_replace` already used by `legal_case_normalized_docket_idx`) when both sides have a docket.
3. Official appellate PDF URL `(court_code, document_url)`.
4. Opinion identity: CourtListener opinion id, or cluster id plus opinion id. Official slip PDFs stay on the SCOTUS provider id and are never overwritten by a bulk row.

A collision holds the case. It does not merge on caption.

**What triggers indexing and publishing.** The bulk merge writes `publication = 'draft'` and does not insert `opinion_search_projection`. `indexable` stays false. Search and the sitemap do not see the row. Publishing happens only in the existing gates: SCOTUS official publish, appellate official publish, and `federal-publication` for everyone else. That last gate stays off for metadata-only until David runs the enable workflow. Readable official text can publish through the gates that already exist. A bulk opinion with text still waits in `draft` so a 5 million row load cannot publish 5 million pages in one night.

The public web pool is untouched. The backfill uses one connection named for the job, the same pattern as the citation snapshot, and it stops if that statement exceeds its timeout. It does not run in the same hours as a sitemap rebuild or a citation-count batch if those are still heavy.

## Small PRs

None of these is authorized by this document.

**PR A. Stop the re-scan.** Change `federal-active-cases` so a docket is selected only when CourtListener `date_modified` is newer than a `last_fetched_at` we set at the end of a successful ingest, and cap the cycle at a few hundred dockets, not 15,000. Change `federal-material-decisions` to store the newest cluster id it finished per court and to skip ids already in `opinion_cluster`. Drop `string_agg` out of `selectPublicationCandidates`. Check sealed text inside the per-case transaction on the one row being decided. Expected effect: those three jobs finish in minutes and the public site stops sharing a multi-second draft scan. Case throughput does not go up yet. Disk stops growing by one file per re-fetched entry.

**PR B. Bulk docket load.** Staging table, `COPY`, set-based merge on `courtlistener_docket_id`, federal non-bankruptcy filter, off-peak, one file per night, checkpoint row per snapshot. No REST, no per-row file. Target 5,000–20,000 cases an hour while public pages stay at their current times. From about 600,000 to 5 million is about 4.4 million rows: about 10 to 40 quiet nights at the low and high ends of that target (a 6-hour window). Stop for the night if free disk on the 320 GB volume drops under 30% or if case-page time moves. Database growth is the case, court, and identifier rows, not opinion text. A planning sketch: a few kilobytes of indexes per case, so 4.4 million cases is on the order of 10–20 GB of indexes if we do not also store entry text. Measure the first 100,000 rows and scale that number. Do not guess past the measurement.

**PR C. Bulk opinion text for cases PR B already loaded.** Same `COPY` shape. Skip empty text. One artifact for the snapshot, not one JSON file per opinion (`write-bulk-opinion-graph.ts` lines 93–98 is what we stop doing on this path). ADR 0077's 20–25 opinions a second is the old row loop, about 70,000–90,000 an hour. A set-based merge should beat that. The bound is disk and the public site, not the loop. Opinion text at a 20 KB sketch is about 10 GB for 500,000 opinions before indexes. Many of the 5 million cases have no opinion. Load text only for rows with a non-empty opinion, and keep them `draft`.

**PR D. Live watermarks.** The SCOTUS open-docket set, circuit `ETag`s, and district RSS gated by the scout, as already described. These add cases per day in the hundreds, not the millions. They are what keeps the corpus current after PR B. They run on the existing workers with the concurrency caps already in this plan, including appellate processing at 8 rather than 52.

**PR E. Freshness.** One read-only age per court, printed by the lane watchdog. No new host.

Order is A, then B, then C, then D. A is what makes the website safe to run B. D does not wait on C. E can ship with D. Bankruptcy, PACER, webhooks, and replication stay out.
