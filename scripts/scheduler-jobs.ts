// The production scheduler's job table, kept free of side effects so lane
// assignments can be tested. run-production-scheduler.ts imports it.
export const SCHEDULER_LANES = ["coa", "core", "citations"] as const;
export type SchedulerLane = (typeof SCHEDULER_LANES)[number];

export type ScheduledJob = {
  lane: SchedulerLane;
  name: string;
  initialDelayMs: number;
  intervalMs: number;
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
    command: ["jobs/resolve-cited-cases-bulk.mjs", "--snapshot-date=latest"],
  },
  {
    // Writes sitemap_document. Public /sitemap.xml only reads that table, so a
    // slow rebuild cannot 500 the request. Skip if the previous pass is still running.
    lane: "citations",
    name: "sitemap-snapshot",
    initialDelayMs: 10 * minute,
    intervalMs: 60 * minute,
    command: ["jobs/refresh-sitemap-snapshot.mjs"],
  },
  {
    // Fills case_citation_count so a case page does not scan every posting
    // for a popular reporter key. Separate from the citation-graph lock.
    // The corpus pass is one heavy statement, so it runs every 2 hours
    // instead of sitting on Postgres for half of each hour.
    lane: "citations",
    name: "citation-count-snapshot",
    initialDelayMs: 4 * minute,
    intervalMs: 2 * 60 * minute,
    command: ["jobs/refresh-case-citation-counts.mjs"],
  },
  {
    lane: "core",
    name: "judge-case-matching",
    initialDelayMs: 8 * minute,
    intervalMs: 15 * minute,
    command: ["jobs/match-judges.mjs", "--limit=1000"],
  },
  {
    lane: "core",
    name: "fjc-judge-roster",
    initialDelayMs: 3 * minute,
    intervalMs: 24 * 60 * minute,
    command: ["jobs/import-fjc-judges.mjs", "--limit=50000"],
  },
  {
    lane: "core",
    name: "usao-case-attribution",
    initialDelayMs: 6 * minute,
    intervalMs: 60 * minute,
    command: ["jobs/backfill-usao-case-attribution.mjs", "--limit=2000"],
  },
  {
    lane: "core",
    name: "district-court-source-scout",
    initialDelayMs: 15 * minute,
    intervalMs: 7 * 24 * 60 * minute,
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
    command: ["jobs/run-loc-us-reports-backfill.mjs"],
  },
  {
    lane: "coa",
    name: "direct-court",
    initialDelayMs: 0,
    intervalMs: 5 * minute,
    command: ["jobs/ingest-direct-court-feeds.mjs", "--court=all"],
  },
  {
    lane: "coa",
    name: "appellate-official",
    initialDelayMs: 1 * minute,
    intervalMs: 5 * minute,
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
    lane: "coa",
    name: "appellate-backfill-report",
    initialDelayMs: 8 * minute,
    intervalMs: 15 * minute,
    command: ["jobs/report-appellate-backfill.mjs"],
  },
  {
    lane: "core",
    name: "scotus-enriched",
    initialDelayMs: 14 * minute,
    intervalMs: 20 * minute,
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
    command: [
      "jobs/run-federal-ingestion-loop.mjs",
      "--loop=active-case-updates",
      "--start-concurrency=2",
      "--max-concurrency=4",
      "--max-items=15000",
    ],
  },
  {
    lane: "core",
    name: "federal-history",
    initialDelayMs: 42 * minute,
    intervalMs: 24 * 60 * minute,
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
