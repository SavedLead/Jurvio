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
| Snapshot files during the load (deleted after; kept in Spaces) | ~66 GB |
| **Volume to provision** | **500 GB** (resizable upward later) |

Duration: the loader runs on web-01 itself (no new droplet), capped at 2 CPUs
and 2 GB of memory so PostgreSQL, the workers and the site keep the rest. The
measured rates on 4 dedicated vCPUs were ~7,800 dockets/s and ~300 opinions/s
(~6 hours of work). Sharing a 4-vCPU box with live ingestion, plan for **1–3
days**. The pilot (section 4) replaces this estimate with real numbers. A
temporary CPU/RAM resize of web-01 (same droplet) is the one lever that
shortens it.

The loader stops cleanly (exit 75) once the database reaches 300 GB
(`JURVIO_BACKFILL_MAX_DATABASE_GB`), so a wrong estimate cannot fill the volume.

## 1. Setup on the existing droplets (operator)

No new droplet. Everything runs on `jurvio-web-01`, which already hosts
PostgreSQL. `jurvio-public-01` keeps serving the site and `jurvio-builder-01`
stays free for deploys and backups. The one purchase is a Block Storage
volume: web-01's disk cannot hold ~170 GB more database.

1. **Take a verified backup** first (`nightly-db-backup.yml`, then
   `verify-backup-restore.yml`).
2. **Create a 500 GB Block Storage volume** in web-01's region and attach it to
   `jurvio-web-01`. It grows later without downtime but never shrinks.
3. **Move PostgreSQL's data onto the volume** (maintenance window; the copy runs at
   roughly a few minutes per 10 GB). The volume is mounted at `/mnt/jurvio-data`. Its
   `postgres` directory is bind-mounted at Docker's own path for the
   `jurvio_postgres` volume, so `docker-compose.production.yml` and every
   workflow keep working unchanged:

   ```bash
   cd /opt/jurvio
   VOLDATA=$(docker volume inspect jurvio_jurvio_postgres --format '{{ .Mountpoint }}')
   echo "$VOLDATA"                      # normally /var/lib/docker/volumes/jurvio_jurvio_postgres/_data
   DEV=/dev/disk/by-id/scsi-0DO_Volume_<volume-name>
   sudo mkfs.ext4 -L jurvio-data "$DEV"   # new volume only
   sudo mkdir -p /mnt/jurvio-data
   echo "$DEV /mnt/jurvio-data ext4 defaults,nofail,discard,noatime 0 2" | sudo tee -a /etc/fstab
   sudo mount /mnt/jurvio-data
   sudo mkdir -p /mnt/jurvio-data/postgres /mnt/jurvio-data/courtlistener
   docker compose -f docker-compose.production.yml stop app worker-core worker-coa worker-supervisor postgres
   sudo rsync -aHAX --numeric-ids "$VOLDATA/" /mnt/jurvio-data/postgres/
   sudo mv "$VOLDATA" "${VOLDATA}.pre-volume"   # keep until verified
   sudo mkdir "$VOLDATA"
   # required-by: if the volume is ever missing at boot, Docker does not start,
   # rather than PostgreSQL initializing a new, empty database in its place.
   echo "/mnt/jurvio-data/postgres $VOLDATA none bind,nofail,x-systemd.requires-mounts-for=/mnt/jurvio-data,x-systemd.before=docker.service,x-systemd.required-by=docker.service 0 0" | sudo tee -a /etc/fstab
   sudo systemctl daemon-reload && sudo mount "$VOLDATA" && df -h "$VOLDATA"
   docker compose -f docker-compose.production.yml start postgres app worker-core worker-coa worker-supervisor
   ```

   Verify with `ingestion-status.yml`, then delete `${VOLDATA}.pre-volume` to
   free the root disk.
4. **Optional: resize web-01 up for the load window** (CPU and RAM only, same
   droplet, so it can be resized back down). If you do, set
   `JURVIO_PG_SHARED_BUFFERS` to ~25% of the new RAM in **both**
   `/opt/jurvio/.env` and `/opt/jurvio/.env.production`, raise
   `JURVIO_BACKFILL_CPUS`, then
   `docker compose -f docker-compose.production.yml up -d postgres`.
5. **Spaces**: no new bucket. The snapshot mirror goes to
   `jurvio-raw-evidence/courtlistener/bulk-mirror/<date>/`. Add a lifecycle rule
   (or a calendar reminder) to keep only the two newest snapshot prefixes.

## 2. Prerequisite still open: backups at scale

The nightly backup writes `pg_dump | gzip` to web-01's root disk and keeps two
copies plus the one in progress, under a 90-minute job timeout. At the projected
database size that refills the root disk (the 2026-08-16 failure mode) and
exceeds the timeout. **Do not start the full run (section 5) until backups write
to object storage or the volume, run in parallel, and fit the job window.** The
pilot (section 4) adds little data and may run first.

## 3. Prepare the load (on web-01)

Deploy the release containing migration `0116` first; the loader refuses to run
without its tables. Then on web-01:

```bash
sudo apt-get install -y rclone          # only for the Spaces mirror
cd /opt/jurvio                          # this release's docker-compose.loader.yml,
                                        # scripts/ and ops/ must be present here
# Download (~66 GB, resumable), verify sizes, checksum, and mirror to Spaces.
# Credentials come from the existing .env.production; nothing new to store.
set -a; . ./.env.production; set +a
scripts/fetch-courtlistener-snapshot.sh 2026-09-30 /mnt/jurvio-data/courtlistener --mirror

docker compose -f docker-compose.production.yml exec -T postgres \
  psql -U jurvio -d jurvio -v ON_ERROR_STOP=1 < ops/postgres/bulk-load-tuning.sql
```

## 4. Pilot (one court of each kind)

```bash
cd /opt/jurvio
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
sudo -E docker compose -f docker-compose.loader.yml up -d
docker compose -f docker-compose.loader.yml logs -f --since 10m backfill | grep -v '"progress":true'
```

- `docker compose -f docker-compose.loader.yml ps -a` shows the exit code.
  **Exit 0**: every stage completed. **Exit 75**: stopped at a batch boundary
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

- The loader is capped at `JURVIO_BACKFILL_CPUS` (default 2) and
  `JURVIO_BACKFILL_MEMORY` (default 2g), and backs off when a batch takes longer
  than `--target-batch-ms` (default 4 s), so live ingestion and the site keep
  priority. If the site slows, lower the CPU cap; if it is fine and the load is
  slow, raise it.

## 6. After the load

1. `ops/postgres/bulk-load-tuning-reset.sql` on web-01.
2. `VACUUM (ANALYZE)` the large tables (`legal_case`, `case_identifier`,
   `opinion_cluster`, `judicial_opinion`, `document`, `document_content`,
   `opinion_search_projection`) in a quiet window.
3. If web-01 was resized: remove `JURVIO_PG_SHARED_BUFFERS` (or set it for the
   final plan), resize back down, `docker compose ... up -d postgres`.
4. `docker compose -f docker-compose.loader.yml down` and delete
   `/mnt/jurvio-data/courtlistener/<date>`; the snapshot stays in Spaces.
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
