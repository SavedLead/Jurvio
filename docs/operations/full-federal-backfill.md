# Full federal CourtListener backfill — runbook

Decision record: [ADR 0075](../adr/0075-full-federal-courtlistener-backfill.md).
Scope: every federal court in the CourtListener bulk snapshot (appellate, district,
special, bankruptcy and bankruptcy appellate panels), every year back to the
1700s. The Supreme Court is excluded because its official-source lane owns those
cases (`--include-scotus` overrides).

Everything loaded lands as **draft**. Nothing becomes public or indexable except
through the existing publication lanes and their rules.

## 0. Sizing (measured 2026-10-05, snapshot 2026-09-30)

Counted exactly by scanning the full dockets and clusters files (SCOTUS excluded):

| Records | Federal in scope | Notes |
|---|---|---|
| Dockets | **64,304,018** of 72,998,758 | 37,030,872 bankruptcy |
| Opinion clusters | **2,978,607** of 10,174,551 | 81,470 bankruptcy; 403 before 1800, 47,602 in the 1800s |
| Opinions | ~4.0 million (estimate) | ~1.35 opinions per cluster across the whole file |

Measured cost per row (local PostgreSQL 16, real data, indexes included):
~680 bytes per docket and ~26 KB per opinion.

| Item | Estimate |
|---|---|
| Dockets in PostgreSQL | ~45–60 GB |
| Opinions in PostgreSQL | ~105 GB |
| Clusters, citations, metadata | ~10 GB (not separately measured) |
| **Database growth** | **~160–180 GB** |
| WAL headroom during the load (`max_wal_size`) | 16 GB |
| **Volume to provision** | **400 GB** (resizable upward later) |
| Snapshot on the loader | ~66 GB; Spaces mirror the same |

Duration at the measured rates (about 7,800 dockets/s and 300 opinions/s on
4 vCPU): ~2.3 h for dockets, ~10 min for clusters, ~3.7 h for opinions. Over the
VPC against a database that is also serving live traffic, plan for 12–24 hours
of loader time. The pilot (section 4) replaces these estimates with production
numbers.

`docker-compose.loader.yml` stops cleanly (exit 75) once the database reaches
300 GB (`JURVIO_BACKFILL_MAX_DATABASE_GB`), so a wrong estimate cannot fill a
400 GB volume.

## 1. DigitalOcean changes (operator)

Do these in order. Nothing here needs code from this repo beyond what is merged.

1. **Take a verified backup** of production first (`nightly-db-backup.yml`, then
   `verify-backup-restore.yml`).
2. **Create a Block Storage volume** in web-01's region and attach it to
   `jurvio-web-01`. Size it from section 0. Volumes can grow later without
   downtime but never shrink, so start at the measured need plus headroom.
3. **Move PostgreSQL's data onto the volume** (maintenance window, ~minutes per
   10 GB copied). The volume is mounted *at Docker's own path* for the
   `jurvio_postgres` volume, so `docker-compose.production.yml` and every
   workflow keep working unchanged:

   ```bash
   cd /opt/jurvio
   VOLDATA=$(docker volume inspect jurvio_jurvio_postgres --format '{{ .Mountpoint }}')
   echo "$VOLDATA"                      # normally /var/lib/docker/volumes/jurvio_jurvio_postgres/_data
   DEV=/dev/disk/by-id/scsi-0DO_Volume_<volume-name>
   sudo mkfs.ext4 -L jurvio-pg "$DEV"   # new volume only
   sudo mkdir -p /mnt/jurvio-pg && sudo mount "$DEV" /mnt/jurvio-pg
   docker compose -f docker-compose.production.yml stop app worker-core worker-coa worker-supervisor postgres
   sudo rsync -aHAX --numeric-ids "$VOLDATA/" /mnt/jurvio-pg/
   sudo umount /mnt/jurvio-pg
   sudo mv "$VOLDATA" "${VOLDATA}.pre-volume"   # keep until verified
   sudo mkdir "$VOLDATA"
   # required-by: if the volume is ever missing at boot, Docker does not start,
   # rather than PostgreSQL initializing a new, empty database in its place.
   echo "$DEV $VOLDATA ext4 defaults,nofail,discard,noatime,x-systemd.before=docker.service,x-systemd.required-by=docker.service 0 2" | sudo tee -a /etc/fstab
   sudo mount "$VOLDATA" && df -h "$VOLDATA"
   docker compose -f docker-compose.production.yml start postgres app worker-core worker-coa worker-supervisor
   ```

   Verify with `ingestion-status.yml`, then delete `${VOLDATA}.pre-volume` to
   free the root disk.
4. **Resize web-01 up for the load** (CPU and RAM only, so it can be resized back
   down). A 16 GB plan is assumed by `ops/postgres/bulk-load-tuning.sql`. After
   the resize, add `JURVIO_PG_SHARED_BUFFERS=4GB` to **both** `/opt/jurvio/.env`
   and `/opt/jurvio/.env.production`, then
   `docker compose -f docker-compose.production.yml up -d postgres`.
5. **Create `jurvio-loader-01`**: same region and VPC, Ubuntu 24.04, CPU-optimized
   8 vCPU, tagged `jurvio`. It needs ~70 GB free for the snapshot; use a temporary
   volume if the plan's disk is smaller. Allow it to reach web-01 on TCP 5432 over
   the VPC (cloud firewall), and nothing public.
6. **Spaces**: no new bucket. The snapshot mirror goes to
   `jurvio-raw-evidence/courtlistener/bulk-mirror/<date>/`. Add a lifecycle rule
   (or a calendar reminder) to keep only the two newest snapshot prefixes.

## 2. Prerequisite still open: backups at scale

The nightly backup writes `pg_dump | gzip` to web-01's root disk and keeps two
copies plus the one in progress, under a 90-minute job timeout. At the projected
database size that refills the root disk (the 2026-08-16 failure mode) and
exceeds the timeout. **Do not start the full run (section 5) until backups write
to object storage or the volume, run in parallel, and fit the job window.** The
pilot (section 4) adds little data and may run first.

## 3. Prepare the loader

```bash
# on jurvio-loader-01
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 rclone
printf '%s' "$GH_TOKEN" | sudo docker login ghcr.io -u <user> --password-stdin
sudo mkdir -p /mnt/courtlistener /opt/jurvio-loader
# from a checkout of this repo:
sudo cp docker-compose.loader.yml scripts/fetch-courtlistener-snapshot.sh /opt/jurvio-loader/
cd /opt/jurvio-loader
sudo install -m 600 /dev/null .env.loader   # then write, never commit:
#   DATABASE_URL=postgres://jurvio:<password>@10.116.0.2:5432/jurvio
#   INGESTION_USER_AGENT=Jurvio-Backfill/1.0

# Download (~66 GB, resumable), verify sizes, checksum, and mirror to Spaces.
JURVIO_SPACES_ACCESS_KEY_ID=... JURVIO_SPACES_SECRET_ACCESS_KEY=... \
  ./fetch-courtlistener-snapshot.sh 2026-09-30 /mnt/courtlistener --mirror
```

Deploy the release containing migration `0116` to production first; the loader
refuses to run without its tables. Then on web-01:

```bash
cd /opt/jurvio
docker compose -f docker-compose.production.yml exec -T postgres \
  psql -U jurvio -d jurvio -v ON_ERROR_STOP=1 < ops/postgres/bulk-load-tuning.sql
```

## 4. Pilot (one court of each kind)

```bash
cd /opt/jurvio-loader
export SNAPSHOT_DATE=2026-09-30 JURVIO_IMAGE=ghcr.io/savedlead/jurvio:<sha>
sudo -E docker compose -f docker-compose.loader.yml run --rm backfill \
  node jobs/backfill-courtlistener-federal.mjs --snapshot-date=$SNAPSHOT_DATE \
  --snapshot-dir=/snapshots/$SNAPSHOT_DATE --courts=ca1,mad,mab
```

The pilot keeps its own progress rows (a `federal-scoped-…` key), so it never
marks the full run's stages done. Record from its log and the database:
rows/second per stage, `pg_database_size` before and after, and live-site
latency during the run. Re-estimate section 0 from these numbers before
continuing.

## 5. Full run

```bash
sudo -E docker compose -f docker-compose.loader.yml up --exit-code-from backfill
```

- **Exit 0**: every stage completed. **Exit 75**: stopped at a batch boundary
  (signal, `--time-budget-minutes`, or the `--max-database-gb` cap); run the same
  command again to resume. **Exit 1**: failed; the last committed batch is intact,
  fix the cause and rerun.
- Stop safely at any time with `docker compose -f docker-compose.loader.yml stop`
  (SIGTERM; the batch in flight commits first).
- Progress from any host with database access:

  ```sql
  SELECT stage, rows_scanned, rows_matched, rows_written, done, updated_at
  FROM cl_bulk_ingest_progress WHERE snapshot_date = '2026-09-30' ORDER BY stage;
  ```

- The loader backs off when a batch takes longer than `--target-batch-ms`
  (default 4 s), so live ingestion and the site keep priority. Lower it if the
  site slows; raise it if the load is too slow and the site is fine.

## 6. After the load

1. `ops/postgres/bulk-load-tuning-reset.sql` on web-01.
2. `VACUUM (ANALYZE)` the large tables (`legal_case`, `case_identifier`,
   `opinion_cluster`, `judicial_opinion`, `document`, `document_content`,
   `opinion_search_projection`) in a quiet window.
3. Remove `JURVIO_PG_SHARED_BUFFERS` (or set it for the final plan), resize web-01
   back down, `docker compose ... up -d postgres`.
4. Destroy `jurvio-loader-01` and its temporary volume. The snapshot stays in
   Spaces.
5. Start the delta lane (REST `modified` cursor from the snapshot date) so
   nothing between 2026-09-30 and now is missing.
6. Expect a long citation-graph backlog: every loaded opinion queues
   `document_citation_work`, processed in bounded batches by the existing
   scheduler. Watch `case_citation_work` and `document_citation_work` counts.

## Rollback

Loaded rows are drafts, so stopping the loader changes nothing public. To undo a
load entirely, restore the pre-load backup. To redo one stage, delete its row
from `cl_bulk_ingest_progress` and rerun. Merges are idempotent and skip
unchanged rows.
