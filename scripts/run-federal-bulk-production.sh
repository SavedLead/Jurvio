#!/bin/sh
set -eu
YEAR=${YEAR:?YEAR is required}
JURISDICTION=${JURISDICTION:?JURISDICTION is required}
SNAPSHOT_DATE=${SNAPSHOT_DATE:?SNAPSHOT_DATE is required}
ROW_LIMIT=${ROW_LIMIT:?ROW_LIMIT is required}
ARTIFACT_ROOT=${JURVIO_ARTIFACT_ROOT:-/var/lib/jurvio/artifacts}
RUN_ROOT="$ARTIFACT_ROOT/federal-bulk"
LOCK_DIR="$RUN_ROOT/lock"
LOG_DIR="$RUN_ROOT/logs"
mkdir -p "$LOG_DIR"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  printf '%s skipped: another federal bulk cohort is already running\n' "$(date -u +%FT%TZ)" >> "$LOG_DIR/launcher.log"
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT INT TERM
case "$YEAR" in 19[0-9][0-9]|20[0-9][0-9]|2100) ;; *) exit 1 ;; esac
case "$JURISDICTION" in F|FD|FB) ;; *) exit 1 ;; esac
case "$SNAPSHOT_DATE" in ????-??-??) ;; *) exit 1 ;; esac
case "$ROW_LIMIT" in 100|1000|5000) ;; *) exit 1 ;; esac
LOG_FILE="$LOG_DIR/${YEAR}-${JURISDICTION}-$(date -u +%Y%m%dT%H%M%SZ).log"
exec >> "$LOG_FILE" 2>&1
printf '%s started year=%s jurisdiction=%s snapshot=%s limit=%s\n' "$(date -u +%FT%TZ)" "$YEAR" "$JURISDICTION" "$SNAPSHOT_DATE" "$ROW_LIMIT"
root="$ARTIFACT_ROOT/courtlistener/bulk/$SNAPSHOT_DATE"
mkdir -p "$root"
courts="$root/courts-$SNAPSHOT_DATE.csv.bz2"
dockets="$root/dockets-$SNAPSHOT_DATE.csv.bz2"
if [ ! -s "$courts" ] || [ ! -s "$dockets" ]; then
  base=https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data
  wget -c -O "$courts" "$base/courts-$SNAPSHOT_DATE.csv.bz2"
  wget -c -O "$dockets" "$base/dockets-$SNAPSHOT_DATE.csv.bz2"
fi
node jobs/ingest-courtlistener-bulk-courts.mjs "$courts" "$SNAPSHOT_DATE"
node jobs/ingest-courtlistener-bulk-federal-dockets.mjs --file="$dockets" --snapshot-date="$SNAPSHOT_DATE" --year="$YEAR" --jurisdiction="$JURISDICTION" --include-bankruptcy=true --row-limit="$ROW_LIMIT"
node jobs/enrich-bulk-federal-cohort.mjs --year="$YEAR" --jurisdiction="$JURISDICTION" --limit="$ROW_LIMIT" --delay-ms=1000
node jobs/run-federal-ingestion-loop.mjs --loop=publication-quarantine --limit="$ROW_LIMIT" --approve-scale-up=false --delay-ms=0
printf '%s finished successfully\n' "$(date -u +%FT%TZ)"
