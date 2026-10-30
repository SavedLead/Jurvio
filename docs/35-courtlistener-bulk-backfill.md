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
