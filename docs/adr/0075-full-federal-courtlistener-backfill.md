# Full federal CourtListener backfill: topology, storage and load strategy

Status: Proposed for David Rosenberg's approval (requested 2026-10-05).

Scope requested: every federal court in the CourtListener bulk snapshot, all
years back to the 1700s, **including bankruptcy**, without degrading live
ingestion or the public site, and with costs that fall back after the load.

## Facts this decision rests on

Measured on 2026-10-05 against snapshot `2026-09-30` and the current code:

| Input | Compressed size |
|---|---|
| `opinions-2026-09-30.csv.bz2` (all courts, state + federal) | 55.3 GB |
| `dockets-2026-09-30.csv.bz2` | 5.1 GB |
| `opinion-clusters-2026-09-30.csv.bz2` | 2.5 GB |
| `oral-arguments` / `citation-map` / `parentheticals` / `citations` | 0.7 / 0.5 / 0.3 / 0.1 GB |

- Each opinion row carries up to eight text renderings (`plain_text`, `html`,
  `html_lawbox`, `html_columbia`, `html_anon_2020`, `xml_harvard`, `xml_scan`,
  `html_with_citations`). The importer already selects one
  (`providers/courtlistener/bulk-opinions.ts`), so the decompressed file size is
  not the stored size.
- Download from the CourtListener S3 bucket ran at about 40 MB/s from a test
  container (200 MB in 4.9 s); the full snapshot transfers in well under an hour.
- Decompression uses single-threaded `bzip2 -dc`. On a 55 GB file that is likely
  the first throughput ceiling.
- The bulk importer writes each opinion with roughly ten separate
  `INSERT ... ON CONFLICT` statements (raw artifact, document, opinion,
  identifiers, content, search projection, outbox). That is correct for
  thousands of rows and slow for millions.
- Opinion text is stored several times: the immutable raw artifact in Spaces,
  `document_content.content_text` + `content_html`, and
  `opinion_search_projection.body` with a generated `tsvector`.
- `jurvio-web-01` runs PostgreSQL (`shared_buffers=512MB`), all ingestion workers
  and the app on one droplet whose local disk filled on 2026-08-16.
- `jurvio-public-01` is `s-2vcpu-4gb`; `jurvio-builder-01` is the runner/bastion.

Not yet measured (the pilot in step 3 below produces them): federal row counts,
bytes per stored opinion, and import rows/second.

## Decision

### 1. Roles for the three droplets plus one temporary loader

| Host | Role during backfill | Role after |
|---|---|---|
| `jurvio-web-01` | PostgreSQL + live workers. **PostgreSQL data moves to an attached Block Storage volume.** Temporarily resized up (CPU/RAM-only resize, so it can be resized back down). | Resized back down; volume stays. |
| `jurvio-public-01` | Unchanged; serves the public site from cache (section 4). | Same. |
| `jurvio-builder-01` | Orchestrates jobs through the existing operator workflows. Runs no load itself. | Same. |
| `jurvio-loader-01` (new, temporary) | Runs the bulk passes over the private VPC. Hourly billed, CPU-optimized. | **Destroyed** when the backfill verifies. |

Separating the loader means the bulk job can use every core it has without
taking CPU from live ingestion or PostgreSQL, and its cost stops when it is
destroyed. Putting PostgreSQL on a volume decouples disk from droplet size: disk
grows in place without a migration, and compute can shrink after the load.

### 2. Storage tiers

| Tier | Where | What |
|---|---|---|
| Hot | PostgreSQL on the volume | Metadata, identities, docket fields, citation graph, publication state, **one** plain-text copy for full-text search. |
| Warm | Spaces `jurvio-raw-evidence`, content-addressed, gzip | Opinion HTML and the raw source artifact. Fetched by the page renderer and cached (section 4). |
| Cold | Spaces, prefix `courtlistener/bulk/<snapshot>/` | Byte-for-byte mirror of the bulk snapshot. Gives provenance, reproducible re-imports and retries without re-downloading. Lifecycle keeps the last two snapshots. |

Schema change: stop storing HTML and a second full-text copy in PostgreSQL for
bulk-imported opinions. `opinion_search_projection` keeps its `tsvector` but
reads its body from `document_content.content_text` instead of duplicating it,
and `content_html` moves to Spaces with a pointer. This needs a migration and a
renderer change, so it lands as its own PR with tests before the load.

### 3. Load method

1. **Mirror** the snapshot from CourtListener S3 into the cold tier, verifying
   size and ETag.
2. **Decompress in parallel** with `lbzip2 -dc` in place of `bzip2 -dc`
   (falls back to `bzip2` when absent).
3. **Pilot**: courts plus 50,000 federal opinions, timed, to record rows/second,
   bytes per opinion and DB growth. Every later estimate is recomputed from it.
4. **Bulk write path**: parse in batches (~10k rows), `COPY` into `UNLOGGED`
   staging tables, then one set-based `INSERT ... SELECT ... ON CONFLICT` per
   canonical table per batch. Raw artifacts upload to Spaces concurrently with
   bounded parallelism. The existing per-row path stays for live/delta ingestion.
5. **Order** (each step verified before the next): courts → people/positions →
   dockets (all federal incl. bankruptcy, all years, `--min-year=1700`) →
   opinion clusters → opinions → citations, citation map, parentheticals →
   oral-argument metadata (audio stays linked at its source, not copied).
6. **Index strategy**: secondary indexes on the largest new tables are built
   after their initial pass, not maintained row by row during it. Unique keys
   that `ON CONFLICT` depends on stay in place.
7. **Resumable and idempotent**: checkpoint per file and batch (file, byte
   offset, last provider id) so a crash or deploy resumes rather than restarts.
8. **Load governor**: the existing adaptive worker pool throttles on PostgreSQL
   commit latency and pauses when volume use passes 75% or live-queue lag grows.
   Loader-session settings (`synchronous_commit=off`, larger
   `maintenance_work_mem`) apply only to the loader's connections; server
   settings (`max_wal_size`, checkpoint spacing, autovacuum on the big tables,
   `shared_buffers` at ~25% of RAM) are raised for the load window.
9. **Delta catch-up**: after verification, the REST `modified` cursor and
   webhooks advance from `2026-09-30` so nothing between snapshot and now is lost.

Ingesting is not publishing. Every record is stored, but the existing
publication policy decides what becomes an indexable page. Bankruptcy dockets
and thin records stay unpublished/`noindex` unless they pass that policy.

### 4. Serving and caching

- **Cloudflare in front of `jurvio-public-01`** (already in the approved cost
  envelope, doc 29). Court opinions are immutable once filed, so opinion pages
  get long edge caching (`s-maxage` of a day or more plus
  `stale-while-revalidate`), purged by URL when a source hash changes.
- **Next.js revalidation** on opinion and case pages instead of per-request
  rendering, so the origin and PostgreSQL are hit once per revalidation window.
- **nginx micro-cache** on `jurvio-public-01` for anonymous GETs as a second
  layer when the edge misses.
- **Opinion HTML from Spaces** behind the same cache, keeping large bodies out of
  PostgreSQL buffer cache.
- **Search** stays on PostgreSQL full text until the reconsideration trigger in
  ADR 0002 fires; that ADR already selects OpenSearch as a rebuildable projection.

### 5. Backups

A database of this size makes nightly `pg_dump` slow to take and slow to
restore. Before the load, move to WAL archiving with incremental base backups
to Spaces (pgBackRest or WAL-G), and run the existing restore-verification
workflow against it once before and once after the backfill.

## Cost shape

List prices to confirm in the DigitalOcean console before provisioning:

- Block Storage volume: about $0.10/GB-month; size from the pilot and start no
  larger than ~1.5× the projected database.
- Spaces: $5/month includes 250 GB; about $0.02/GB-month beyond.
- `jurvio-web-01` temporary resize (e.g. 8 vCPU / 16 GB, about double the
  current $48/month rate, prorated hourly), then resized back down.
- `jurvio-loader-01`: hourly, destroyed after; cost is days, not months.
- Cloudflare: free or Pro tier is enough for this caching.

The recurring increase after the load is mainly the volume and Spaces growth.
Doc 29 sets a ~$250/month pre-revenue infrastructure target; the pilot
must show the post-load monthly total against that target before step 5 starts.

## Alternatives considered

- **Run the load on `jurvio-web-01` as today.** No new hosts, but it competes
  with live ingestion and PostgreSQL, single-threaded decompression and per-row
  inserts make it slow, and the disk repeats the 2026-08-16 failure.
- **Permanently upsize `jurvio-web-01`.** Simple, but pays peak-load compute
  every month for a one-off job, and disk stays tied to droplet size.
- **DigitalOcean Managed PostgreSQL.** Removes backup/failover work, but costs
  more per GB of storage and limits server tuning during a bulk load.
  Reconsider when uptime requirements or team size justify it.
- **Store everything in PostgreSQL.** One system, but text stored three to four
  times inflates disk, backups and buffer cache pressure.
- **OpenSearch now.** Better relevance, but adds a cluster before search demand
  exists; ADR 0002 already defines when to add it.
- **REST API crawl instead of bulk files.** Fresher, but rate limits make the
  full history impractical; it is the delta lane only.

## Benefits

Live ingestion and the public site stay responsive during the load. Compute cost
returns close to today's level afterward. Disk scales independently of compute.
Snapshots are reproducible from Spaces. Imports resume after failure.

## Costs and risks

- Code work before the load: `lbzip2`, the batched `COPY` path, the storage
  schema change, checkpointing and backups, each with tests.
- Moving PostgreSQL's data directory to a volume needs a short maintenance
  window and a verified backup first.
- Bankruptcy and pre-1900 records add volume with low publication value; they
  are stored but must not leak into indexable pages.
- Row-count and size estimates are unknown until the pilot; the plan may need
  resizing after it.
- CourtListener's bulk-data terms and attribution requirements must be
  re-checked for the 2026-09-30 snapshot before republishing any text.

## Reconsideration triggers

- Pilot shows the post-load monthly cost above the doc 29 target.
- Database exceeds ~70% of its volume or restore time exceeds the agreed RTO.
- Public p95 latency on cached opinion pages regresses after launch.
- PostgreSQL full-text search fails the ADR 0002 relevance or latency benchmark.
- CourtListener changes the bulk format, cadence or license.
