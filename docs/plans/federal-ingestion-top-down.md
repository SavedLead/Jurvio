# Federal ingestion, top down

Planning only. This document does not change ingestion, publish anything, or spend money. It records what the repo already runs and the order David Rosenberg set on October 29, 2026: Supreme Court from supremecourt.gov, then the 13 courts of appeals from their own sites, then the 94 district courts, with CourtListener as the cheap historical fill. Federal metadata publication stays off until David turns it on.

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
