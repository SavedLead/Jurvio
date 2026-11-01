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
    command: ["jobs/run-case-citations.mjs", "--limit=200", "--discover=10"],
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
    // Fills case_citation_count so a case page does not scan every posting
    // for a popular reporter key. Separate advisory lock from the citation
    // graph and from the sitemap job. Batches commit as they finish; the
    // one-statement refresh left the table empty until the whole corpus
    // distinct committed, which had not happened 13 minutes after restart.
    lane: "citations",
    name: "citation-count-snapshot",
    initialDelayMs: 4 * minute,
    intervalMs: 2 * 60 * minute,
    budgetMs: 90 * minute,
    command: ["jobs/refresh-case-citation-counts.mjs"],
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
  // The CourtListener API live tail ("courtlistener-tail") was dropped on
  // 2026-10-31 (David Rosenberg): it shared the API token's daily quota and kept
  // hitting 429. New federal data comes from the official court feeds and the
  // CourtListener bulk-file loaders, which are unchanged.
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
