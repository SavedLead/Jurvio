# CourtListener bulk backfill

## Decision

Jurvio uses separate lanes for separate jobs:

1. Quarterly CourtListener bulk snapshots establish and refresh the historical baseline.
2. CourtListener webhooks and the REST modified cursor keep that baseline current.
3. CourtListener MCP supports agent research and targeted verification. It is not the canonical bulk transport.
4. Direct PACER retrieval fills missing or time-sensitive federal records after checking RECAP first.

Bulk inputs remain provider data. Jurvio maps them into its canonical tables and retains provider identifiers and snapshot checkpoints. Public pages stay in draft until deterministic validation and publication review pass.

## Cost-aware sequence

Import in dependency and value order:

1. Courts.
2. Recent federal dockets for the initial court cohort.
3. Opinion clusters and opinion text for cases selected for publication.
4. Citation edges and parentheticals for published opinions.
5. Judge and position data.

Do not retain decompressed snapshots on the application server. Stream compressed CSV input, validate each row, upsert selected records, record the snapshot checkpoint, and delete the transport file after verification.

## First command

```bash
pnpm ingest:bulk:courts /data/courts-2026-03-31.csv.bz2 2026-03-31
```

The docket importer must apply court/date/value filters while streaming because the current docket snapshot is too large to expand permanently on the initial server.

## Nightly bulk docket load (`load-courtlistener-bulk-dockets-nightly.yml`)

Dispatch-only, `confirm=LOAD_DOCKETS`, on builder-01; a routine dispatches it at about 01:20 America/New_York.
It runs `jobs/load-courtlistener-bulk-dockets.mjs` from its checkpoint (`courtlistener:bulk-dockets:v1:<date>`)
with no low row cap, inside the 1–7am ET window, with the loader's load/latency pauses, the 30% free-disk floor
and a 90-minute budget. The snapshot file stays cached in the `jurvio_artifacts` volume on web-01
(`/var/lib/jurvio/artifacts/bulk/dockets-<date>.csv.bz2`); it is downloaded only if missing or the snapshot
date changes, and deleted once the checkpoint reports `stopped=complete`. `snapshot_date=auto` (default)
keeps loading the cached or unfinished snapshot so a new monthly export never restarts an in-progress load.

Loader semantics (since this workflow): `--row-limit` counts rows merged in this run, not cumulatively; a
budget stop keeps the checkpoint at the last merged chunk, so rows read but not yet merged are read again
next run; and a resumed run clears the previous run's `stopped` flag so the file's tail is merged and
marked complete.

## Bulk opinion text (Step C): `jobs/load-courtlistener-bulk-opinions.mjs`

Modeled on the bulk docket loader. It streams `opinions-<date>.csv.bz2` (≈51 GiB compressed) straight from
S3 through `bzip2 -dc` with `openBulkCsvFromUrl` (Range-resume on dropped connections), so nothing lands on
disk. Opinions are read in chunks (1,000 rows or 32 MiB of text). For each chunk the loader:

1. looks up the chunk's cluster ids in `opinion_cluster` (→ `legal_case` → `court`) with one `= ANY` query
   and keeps **federal courts only** (no SCOTUS, which belongs to the official pipeline, and no bankruptcy);
2. drops opinions already in `judicial_opinion` (existing rows, published or not, are never touched);
3. `COPY`s the rest into the unlogged `courtlistener_opinion_stage` (migration 0132) and merges them
   set-based in one transaction into `raw_artifact`, `document` (draft), `judicial_opinion`,
   `document_identifier`, `document_content`, `opinion_search_projection` and `publication_review` (pending);
4. holds the new text from both automatic publishers: a `citation_publication_hold` per document and a
   `federal_publication_hold` per draft case, both with reason `bulk_opinion_text_pending_review` under
   the publishers' current rule versions. (The per-row writer instead deletes missing-text holds; the bulk
   path deliberately does not.)

It uses the same safety gates as the docket loader: 1–7am ET window, CPU and public-query latency pauses,
30% free-disk floor and a 90-minute budget. The checkpoint is `courtlistener:bulk-opinions:v2:<date>` (see
below; v1 is ignored); a stop keeps it at the last saved row. Raw opinion JSON is not copied to the artifact store
(`raw_artifact.response_metadata.objectStored=false`, and the object key points into the bulk file); the
text lives in `document_content`. Measure with `measure-courtlistener-bulk-opinions-once.yml`
(`confirm=MEASURE_OPINIONS`, `row_limit` default 50,000).

## Opinion clusters before opinion text (Step C0): `jobs/load-courtlistener-bulk-clusters.mjs`

Why: the first opinion measurement (run 41004172635, snapshot 2026-09-30) read 1,783,737 rows in 90 minutes and
merged 0. 1,701,717 rows were unmatched because the loader resolved opinions only through *existing*
`opinion_cluster` rows, and production had almost no clusters for the federal dockets that the bulk docket
load is creating. The opinions file links an opinion to a cluster id; only the clusters file links a cluster
to a docket.

The cluster loader streams `opinion-clusters-<date>.csv.bz2` (≈2.5 GB compressed) from S3 and, per 5,000-row
chunk, `COPY`s into the unlogged `courtlistener_cluster_stage` (migration 0133) and merges set-based:

- cluster already in `opinion_cluster` → left alone (`alreadyPresent`);
- docket resolves (`case_identifier` `courtlistener_docket_id`) to a federal case (no SCOTUS, no bankruptcy)
  that is draft or published, and the cluster is not blocked and its caption is not sealed / minor /
  juvenile / grand jury / qui tam → new `opinion_cluster` on that case (case name, date filed, precedential
  status, citation count, judges, syllabus, procedural history; short fields in `provider_metadata`, long
  free text such as headmatter listed in `_omitted`). Draft cases stay draft and get a
  `federal_publication_hold` (`bulk_opinion_text_pending_review`). One `raw_artifact` per snapshot file.
- docket resolves to a non-federal case → `nonFederal`; restricted or suppressed case or restricted cluster →
  `restricted` (no cluster, so no text is ever loaded for it);
- docket not loaded → `courtlistener_pending_cluster` (unlogged, slim) while the docket load for the snapshot
  is unfinished, otherwise just counted (`unmatched`).

Every cluster run first resolves pending clusters whose docket has since been loaded (one hash join, then
5,000-row transactions), so later docket loads attach them without re-reading the clusters file. Once the
docket load for a snapshot (or a newer one) is complete, pending rows from that snapshot are pruned. A
finished snapshot never re-opens the file. Checkpoint: `courtlistener:bulk-clusters:v1:<date>`. Citations
(reporter cites) are a separate export (`citations-<date>.csv.bz2`) and are not loaded here;
`opinion_cluster.citations` stays `[]` and `citation_count` is set.

Measure with `measure-courtlistener-bulk-clusters-once.yml` (`confirm=MEASURE_CLUSTERS`); it prints a `MATCH`
line with the federal match rate.

### Opinion loader changes (checkpoint v2, passes, fast skip)

- At run start the loader loads the ids of every federal cluster on a draft or published case into a sorted
  in-memory `Float64Array` (tens of MB for millions of ids). Rows whose cluster is not in it are skipped
  with no DB lookup or staging; the checkpoint is saved every 50,000 skipped rows. With no federal clusters
  at all the run stops at once (`no-clusters`) without opening the 55 GB file.
- The CSV parser now appends whole slices between special characters instead of one character at a time
  (about 7x faster on a real 233 MB opinions sample; output is identical, checked by a randomized
  equivalence test against the old parser).
- Passes: the checkpoint records `pass`, `passStartedAt` and `clustersSince`. When a pass completes and
  federal clusters were created after it began (pending clusters resolved by later docket loads), the next
  run starts pass + 1 over the same file but only stages opinions of clusters created since the previous pass
  began. Otherwise a completed snapshot is not read again.
- The v1 checkpoint from the measurement run is ignored (its 1.78M "consumed" rows were consumed before any
  cluster existed), so the snapshot is read again from row 0 under `v2`.

### Nightly order

`load-courtlistener-bulk-dockets-nightly.yml` (same dispatch, `confirm=LOAD_DOCKETS`, new `stages` input,
default `dockets,clusters,opinions`) runs three jobs in order: dockets → clusters → opinions, each with its own
90-minute budget, the 1–7am ET window, pauses and the 30% disk floor. Clusters and opinions use the docket
load's snapshot. The opinions job waits until both the docket and the cluster checkpoints for that snapshot are
`complete`, so a full 55 GB pass is not spent while most clusters cannot resolve yet.
