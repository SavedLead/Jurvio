// The production scheduler's job table, kept free of side effects so lane
// assignments can be tested. run-production-scheduler.ts imports it.
export const SCHEDULER_LANES = ["coa", "core", "citations"] as const;
export type SchedulerLane = (typeof SCHEDULER_LANES)[number];

export type ScheduledJob = {
  lane: SchedulerLane;
  name: string;
  initialDelayMs: number;
  intervalMs: number;
  /** Hard stop. The scheduler kills the child when this elapses so a stuck job cannot hold the lane. */
  budgetMs: number;
  command: string[];
};

const minute = 60_000;

export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  // Citation work runs in its own "citations" lane (worker-citations container) so
  // it never shares a scheduler, child-process slots or start-up with the heavy
  // ingestion loops. See ADR 0076.
  {
    lane: "citations",
    name: "case-citation-graph",
    initialDelayMs: 2 * minute,
    // The candidate query reads published opinion text. Every 2 minutes it never
    // finished before the next pass and kept the disk busy under search.
    intervalMs: 15 * minute,
    budgetMs: 12 * minute,
    // Live work (new/changed opinions, priority 10) first, looping 500-row
    // batches for up to 6 minutes, then at most 4 backfill batches. The bulk
    // backfill drains on builder-01 (citation-backfill-builder.yml), so this
    // lane stops well inside its 12-minute kill budget (ADR 0090). Discovery,
    // publication and backlog stats are skipped, not killed, past the 600s
    // deadline (they overran the budget under load on Nov 1, 2026).
    command: ["jobs/run-case-citations.mjs", "--limit=500", "--discover=10", "--budget-seconds=360", "--pause-ms=500", "--backfill-batches=4", "--publish-limit=200", "--deadline-seconds=600"],
  },
  {
    // Daily offline resolution of new missing citations against the newest
    // CourtListener bulk citation map (free, no API calls, minutes per run).
    // Resolve-only: the multi-hour bulk import stays an on-demand workflow.
    lane: "citations",
    name: "cited-case-bulk-resolution",
    initialDelayMs: 20 * minute,
    intervalMs: 24 * 60 * minute,
    budgetMs: 90 * minute,
    command: ["jobs/resolve-cited-cases-bulk.mjs", "--snapshot-date=latest"],
  },
  {
    // Writes sitemap_document. Public /sitemap.xml only reads that table, so a
    // slow rebuild cannot 500 the request. Skip if the previous pass is still running.
    lane: "citations",
    name: "sitemap-snapshot",
    initialDelayMs: 10 * minute,
    intervalMs: 60 * minute,
    budgetMs: 50 * minute,
    command: ["jobs/refresh-sitemap-snapshot.mjs"],
  },
  {
    // Nightly citation catch-up (ADR 0090, D13): hourly tick, works once per ET
    // day between 01:00 and 05:00; cheap bounded SQL only.
    lane: "citations",
    name: "citation-nightly",
    initialDelayMs: 7 * minute,
    intervalMs: 60 * minute,
    budgetMs: 15 * minute,
    command: ["jobs/run-citation-nightly.mjs"],
  },
  {
    // Precomputed Cites / Cited-by edges and counts (case_citation_edge,
    // case_citation_count). Drains the dirty set (cases whose opinions,
    // identities or visibility changed), then advances the resumable weekly
    // full sweep (off-peak 1-6 AM ET; the first sweep starts at once).
    // Replaced the 2-hour full recount, citation-count-snapshot. ADR 0090.
    lane: "citations",
    name: "citation-edges",
    initialDelayMs: 4 * minute,
    intervalMs: 10 * minute,
    budgetMs: 60 * minute,
    command: ["jobs/refresh-case-citation-edges.mjs", "--budget-seconds=3300"],
  },
  {
    // Fills court_public_stats and judge_public_stats so /courts, /courts/[id],
    // the /cases court facet and /judges read stored counts instead of
    // aggregating every published case per request. Small committed batches
    // with a pause between them, one connection, own advisory lock. ADR 0080.
    lane: "citations",
    name: "public-directory-stats",
    initialDelayMs: 6 * minute,
    intervalMs: 30 * minute,
    budgetMs: 25 * minute,
    command: ["jobs/refresh-public-directory-stats.mjs"],
  },
  {
    // Fills public_case_search so /cases?q=, party= and firm= narrow to trigram
    // candidates instead of walking every published case per request. Committed
    // 1,000-case keyset batches with a pause, resumable cursor, own advisory
    // lock. Readers wait for the first full sweep. ADR 0081.
    lane: "citations",
    name: "public-case-search",
    initialDelayMs: 8 * minute,
    intervalMs: 15 * minute,
    budgetMs: 12 * minute,
    command: ["jobs/refresh-public-case-search.mjs", "--max-batches=150"],
  },
  {
    // Precomputes court_freshness for /internal/freshness: one grouped pass over
    // legal_case for ~108 federal courts. Feed jobs also refresh the courts they
    // touch, so this pass only has to catch bulk loads and publication changes.
    lane: "core",
    name: "court-freshness",
    initialDelayMs: 1 * minute,
    intervalMs: 30 * minute,
    budgetMs: 10 * minute,
    command: ["jobs/refresh-court-freshness.mjs"],
  },
  {
    // New SCOTUS dockets from supremecourt.gov's per-docket JSON (draft cases).
    // Probes just past the stored per-series watermark, then backfills newest
    // first; ~15 polite requests when nothing is new. See docs/operations/live-feeds.md.
    lane: "core",
    name: "scotus-live-dockets",
    initialDelayMs: 4 * minute,
    intervalMs: 3 * 60 * minute,
    budgetMs: 12 * minute,
    command: ["jobs/run-live-feeds.mjs", "--source=scotus"],
  },
  {
    // Supreme Court emergency docket (approved 2026-11-04): conditional re-reads
    // (If-Modified-Since) of open emergency application docket pages, a probe of
    // the next few application numbers and a small seed batch. At most one
    // request a second, usually 10 to 40 small requests, mostly 304s; no PDFs.
    // Never reads /rss/. See src/modules/ingestion/live-feeds/scotus-emergency.ts.
    lane: "core",
    name: "scotus-emergency",
    initialDelayMs: 3 * minute,
    intervalMs: 10 * minute,
    budgetMs: 8 * minute,
    command: ["jobs/run-scotus-emergency.mjs", "--max-requests=60", "--seed=15"],
  },
  // The CourtListener API live tail ("courtlistener-tail") was dropped on
  // 2026-10-31 (David Rosenberg): it shared the API token's daily quota and kept
  // hitting 429. New federal data comes from the official court feeds and the
  // CourtListener bulk-file loaders, which are unchanged.
  {
    // "In the news" for case pages: GDELT DOC API (one request every 10 s, at
    // most 40 per run, with a growing cooldown after throttling) plus Courthouse
    // News RSS matched against every recent SCOTUS and appeals case. SCOTUS and appeals cases first. Stores
    // headline/outlet/date/link and the feed's own short description only.
    // Google News RSS is off (2026-11-01): its terms are personal, non-commercial only.
    lane: "core",
    name: "case-news",
    initialDelayMs: 11 * minute,
    intervalMs: 30 * minute,
    budgetMs: 14 * minute,
    command: ["jobs/run-case-news.mjs", "--gdelt-max-requests=25", "--gdelt-max-ms=420000", "--candidates=300"],
  },
  {
    // Followed-case docket alert digests. Every 10 minutes; each user is emailed at
    // most once per plan cadence (Free daily, Plus hourly, Pro/Team every tick).
    // No-op until RESEND_API_KEY, EMAIL_FROM and EMAIL_POSTAL_ADDRESS are set.
    lane: "core",
    name: "account-alerts",
    initialDelayMs: 4 * minute,
    intervalMs: 10 * minute,
    budgetMs: 8 * minute,
    command: ["jobs/run-account-alerts.mjs", "--max-users=500"],
  },
  {
    lane: "core",
    name: "judge-case-matching",
    initialDelayMs: 8 * minute,
    intervalMs: 15 * minute,
    budgetMs: 12 * minute,
    command: ["jobs/match-judges.mjs", "--limit=1000"],
  },
  {
    lane: "core",
    name: "fjc-judge-roster",
    initialDelayMs: 3 * minute,
    intervalMs: 24 * 60 * minute,
    budgetMs: 40 * minute,
    command: ["jobs/import-fjc-judges.mjs", "--limit=50000"],
  },
  {
    // Official agency sources of federal case filings: DOJ (OPA + 94 USAOs), SEC
    // litigation releases and administrative proceedings, FTC cases, state AGs and
    // settlement administrators. Each source has its own polite budget; a run is a
    // few dozen requests. See docs/operations/agency-sources.md.
    lane: "core",
    name: "agency-sources",
    initialDelayMs: 9 * minute,
    intervalMs: 60 * minute,
    budgetMs: 20 * minute,
    command: ["jobs/run-agency-sources.mjs", "--source=all"],
  },
  {
    lane: "core",
    name: "usao-case-attribution",
    initialDelayMs: 6 * minute,
    intervalMs: 60 * minute,
    budgetMs: 20 * minute,
    command: ["jobs/backfill-usao-case-attribution.mjs", "--limit=2000"],
  },
  {
    lane: "core",
    name: "district-court-source-scout",
    initialDelayMs: 15 * minute,
    intervalMs: 7 * 24 * 60 * minute,
    budgetMs: 40 * minute,
    command: [
      "jobs/scout-district-court-sources.mjs",
      "--limit=94",
      "--output=/var/lib/jurvio/artifacts/reports/district-court-scout.json",
    ],
  },
  {
    lane: "core",
    name: "scotus-pre500-backfill",
    initialDelayMs: 30_000,
    // Was every 5 minutes and overlapped the other core parsers. worker-core
    // hit 417% CPU while Postgres was nearly idle.
    intervalMs: 20 * minute,
    budgetMs: 18 * minute,
    command: ["jobs/run-scotus-pre500-backfill.mjs"],
  },
  {
    // Extract the earliest U.S. Reports volumes (roughly 1-111) from the Library of
    // Congress, which the supremecourt.gov PDF parser cannot read. Feeds the shared
    // SCOTUS publish path; closes the last coverage gap toward the full corpus.
    lane: "core",
    name: "loc-us-reports-backfill",
    initialDelayMs: 8 * minute,
    intervalMs: 20 * minute,
    budgetMs: 18 * minute,
    command: ["jobs/run-loc-us-reports-backfill.mjs"],
  },
  {
    lane: "coa",
    // District CM/ECF RSS (79 courts): 16 courts per run, each court at most
    // every 2 h (feeds cover 24 h), one isolated try/catch per court.
    name: "direct-court",
    initialDelayMs: 0,
    intervalMs: 10 * minute,
    budgetMs: 8 * minute,
    command: ["jobs/ingest-direct-court-feeds.mjs", "--court=all", "--max-courts=16", "--budget-ms=360000", "--min-interval-minutes=120"],
  },
  {
    lane: "coa",
    name: "appellate-official",
    initialDelayMs: 1 * minute,
    intervalMs: 5 * minute,
    budgetMs: 15 * minute,
    command: [
      "jobs/run-appellate-ingestion.mjs",
      "--court=all",
      "--watch=false",
      "--discovery-concurrency=13",
      "--processing-concurrency=52",
    ],
  },
  // Advance one durable circuit cursor per cycle. Database-backed selection
  // prevents later circuits from being starved when unrelated deployments
  // restart this process before long in-memory stagger delays can fire.
  // Seven-minute spacing stays below the shared DEMO_KEY limit; a configured
  // free key automatically enables the importer's multi-page mode.
  {
    lane: "coa",
    name: "appellate-govinfo-backfill",
    initialDelayMs: 2 * minute,
    intervalMs: 7 * minute,
    budgetMs: 12 * minute,
    command: [
      "jobs/ingest-govinfo-appellate.mjs",
      "--court=next",
      "--page-size=1000",
      "--pages-per-court=10",
    ],
  },
  // REMOVED: the CourtListener REST/API appellate backfill lane. The public
  // v4 API rate-limits us to a perpetual "429 Too Many Requests" loop that
  // published nothing while burning a scheduler slot and network retries every
  // 10 minutes. The COA corpus now comes from govinfo (complete for all 13
  // circuits) and, for full-text/citation enrichment, the free CourtListener
  // BULK download path (out-of-band, not scheduler-driven) -- neither needs the
  // API lane. There is no env/DB toggle for a lane, so removing it here is the
  // durable disable. See throughput-freewins-once.yml for the interim checkpoint
  // muzzle that stopped it before this shipped.
  {
    // Each circuit's own opinion feed (7 of 13 have one), one isolated budget
    // per court: at most 4 requests each, 1.5 s apart. Draft cases only.
    lane: "coa",
    name: "coa-live-feeds",
    initialDelayMs: 3 * minute,
    intervalMs: 60 * minute,
    budgetMs: 10 * minute,
    command: ["jobs/run-live-feeds.mjs", "--source=coa"],
  },
  {
    // GovInfo USCOURTS: new opinions for all 94 districts and 13 circuits,
    // cross-checked against the other sources (govinfo_crosscheck). Hourly fits
    // DEMO_KEY (one page per run); a configured free key reads up to 10 pages.
    lane: "coa",
    name: "govinfo-daily",
    initialDelayMs: 11 * minute,
    intervalMs: 60 * minute,
    budgetMs: 15 * minute,
    command: ["jobs/run-live-feeds.mjs", "--source=govinfo"],
  },
  {
    // Appellate CM/ECF public RSS (orders, opinions, judgments) for the seven
    // circuits that publish it; one request per court, cross-source deduped.
    lane: "coa",
    name: "appellate-pacer-rss",
    initialDelayMs: 13 * minute,
    intervalMs: 30 * minute,
    budgetMs: 8 * minute,
    command: ["jobs/run-live-feeds.mjs", "--source=appellate-rss"],
  },
  {
    // District court website opinion lists (ded, nhd, pamd, vid, wied, wvsd).
    lane: "coa",
    name: "court-site-opinions",
    initialDelayMs: 17 * minute,
    intervalMs: 3 * 60 * minute,
    budgetMs: 8 * minute,
    command: ["jobs/run-live-feeds.mjs", "--source=court-site"],
  },
  {
    // Live-feed opinion text (ADR 0090, D11): fetch + pdftotext the opinion PDFs the
    // live feeds above recorded (court sites, circuit feeds, GovInfo districts) so
    // the citation parser sees them. Draft documents only; no OCR here (scanned
    // PDFs wait for the builder workflow live-opinion-text-builder.yml).
    lane: "coa",
    name: "live-opinion-text",
    initialDelayMs: 9 * minute,
    intervalMs: 20 * minute,
    budgetMs: 13 * minute,
    command: ["jobs/run-live-opinion-text.mjs", "--limit=60", "--budget-seconds=660", "--backfill-days=3"],
  },
  {
    // CourtListener's public per-court opinion Atom feeds (not the REST API, no
    // token or quota) for gasd, msnd, oknd and vaed: no public PACER RSS and no
    // GovInfo packages there. One request per court, cross-source deduped.
    lane: "coa",
    name: "courtlistener-court-feeds",
    initialDelayMs: 19 * minute,
    intervalMs: 3 * 60 * minute,
    budgetMs: 8 * minute,
    command: ["jobs/run-live-feeds.mjs", "--source=cl-feed"],
  },
  {
    lane: "coa",
    name: "appellate-backfill-report",
    initialDelayMs: 8 * minute,
    intervalMs: 15 * minute,
    budgetMs: 8 * minute,
    command: ["jobs/report-appellate-backfill.mjs"],
  },
  {
    lane: "core",
    name: "scotus-enriched",
    initialDelayMs: 14 * minute,
    intervalMs: 20 * minute,
    budgetMs: 18 * minute,
    command: [
      "jobs/ingest-enriched-official-scotus.mjs",
      "--term=__CURRENT_SCOTUS_TERM__",
      // The enriched job fans this budget out per stage: the network-bound
      // fetch/enrich/docket stages clamp to their 100 ceiling internally, while the
      // pure-DB publish/extract drain stages use the full amount. A large budget
      // therefore drains the SCOTUS publish/extract backlog fast without exceeding
      // any network stage's cap (the over-large value is what used to crash-loop it).
      // 1000 every 20 minutes instead of 5000 every 5: the Node parse work was a
      // large share of worker-core's 417% CPU spike.
      "--limit=1000",
      "--resume=true",
      "--attempts=10",
    ],
  },
  {
    lane: "core",
    name: "scotus-publish",
    initialDelayMs: 90_000,
    intervalMs: 10 * minute,
    budgetMs: 12 * minute,
    // Publishes verified/approved official SCOTUS opinions ON THE BOX. This lane
    // was previously MISSING entirely: the only thing that ever published SCOTUS
    // was the DO_HOST `publish-official-scotus-opinions` workflow, retired in the
    // two-server migration — which is why ~12k already-approved opinions sat
    // unpublished for days. Publication is pure DB work (one transaction per
    // opinion), so a large per-cycle limit is safe; it self-limits as the backlog
    // drains and then just keeps pace with newly approved opinions.
    command: ["jobs/publish-official-scotus-opinions.mjs", "--limit=500"],
  },
  {
    lane: "core",
    name: "scotus-orders-index",
    initialDelayMs: 15 * minute,
    intervalMs: 6 * 60 * minute,
    budgetMs: 5 * minute,
    // Index rows only. No PDF fetch, no docket_entry write, no subscriber alert.
    // Skips itself until migration 0201 is present.
    command: ["jobs/sync-official-scotus-orders.mjs"],
  },
  {
    lane: "core",
    name: "scotus-official-history",
    initialDelayMs: 2 * minute,
    intervalMs: 20 * minute,
    budgetMs: 12 * minute,
    // supremecourt.gov only, docket years 2017 through now. Drafts, no PDFs,
    // no subscriber alerts. Checkpointed. Not run on the public web.
    command: ["jobs/backfill-scotus-official-history.mjs", "--max-requests=120", "--min-interval-ms=1500"],
  },
  // Federal loops self-throttle via a bounded adaptive worker pool:
  // --start-concurrency climbs only after clean windows and halves on distress
  // (source 429s or DB pressure), capped by --max-concurrency, with a finite
  // --max-items runaway guard. Concurrency 14 stacked Node parse work until
  // worker-core hit 417% CPU while Postgres was nearly idle. Cap each loop at 4
  // so ingestion continues without that pile-up.
  {
    lane: "core",
    name: "federal-new-cases",
    initialDelayMs: 2 * minute,
    intervalMs: 20 * minute,
    budgetMs: 18 * minute,
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=new-case-discovery",
      "--start-concurrency=2",
      "--max-concurrency=4",
      "--max-items=25000",
    ],
  },
  {
    lane: "core",
    name: "federal-material-decisions",
    initialDelayMs: 12 * minute,
    intervalMs: 20 * minute,
    budgetMs: 18 * minute,
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=material-decisions",
      "--start-concurrency=2",
      "--max-concurrency=4",
      "--max-items=25000",
    ],
  },
  {
    lane: "core",
    name: "federal-publication",
    initialDelayMs: 22 * minute,
    intervalMs: 12 * minute,
    budgetMs: 10 * minute,
    // Publication is pure DB work (each publish opens a transaction). Runs often and
    // drains a large batch per cycle so the publish backlog (and the outbox that
    // depends on it) keeps pace with ingestion instead of falling behind.
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=publication-quarantine",
      "--start-concurrency=2",
      "--max-concurrency=4",
      "--max-items=5000",
    ],
  },
  {
    lane: "core",
    name: "federal-active-cases",
    initialDelayMs: 32 * minute,
    intervalMs: 6 * 60 * minute,
    budgetMs: 20 * minute,
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=active-case-updates",
      "--start-concurrency=2",
      "--max-concurrency=4",
      "--max-items=300",
    ],
  },
  {
    lane: "core",
    name: "federal-history",
    initialDelayMs: 42 * minute,
    intervalMs: 24 * 60 * minute,
    budgetMs: 18 * minute,
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=historical-backfill",
      "--start-concurrency=2",
      "--max-concurrency=4",
      "--max-items=20000",
    ],
  },
];


export function isSchedulerLane(value: string): value is SchedulerLane {
  return (SCHEDULER_LANES as readonly string[]).includes(value);
}

/** Jobs for one lane, with the lane's safety rules enforced. */
export function jobsForLane(lane: string): ScheduledJob[] {
  if (!isSchedulerLane(lane)) {
    throw new Error(`JURVIO_SCHEDULER_LANE must be one of ${SCHEDULER_LANES.join(", ")}; received ${lane}`);
  }
  const active = SCHEDULED_JOBS.filter((job) => job.lane === lane);
  if (active.length === 0) throw new Error(`No jobs configured for scheduler lane ${lane}`);
  if (lane !== "core" && active.some((job) => job.name.startsWith("scotus-"))) {
    throw new Error(`${lane} scheduler must never include SCOTUS jobs`);
  }
  return active;
}
