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
30% free-disk floor and a 90-minute budget. The checkpoint is `courtlistener:bulk-opinions:v1:<date>`; a stop
keeps it at the last merged chunk. Raw opinion JSON is not copied to the artifact store
(`raw_artifact.response_metadata.objectStored=false`, and the object key points into the bulk file); the
text lives in `document_content`. Measure with `measure-courtlistener-bulk-opinions-once.yml`
(`confirm=MEASURE_OPINIONS`, `row_limit` default 50,000).
