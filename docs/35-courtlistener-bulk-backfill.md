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
