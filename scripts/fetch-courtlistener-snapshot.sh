#!/usr/bin/env bash
# Download one CourtListener bulk snapshot, verify it, checksum it, and optionally
# mirror it to Spaces (the cold tier in ADR 0075).
#
#   scripts/fetch-courtlistener-snapshot.sh <YYYY-MM-DD> <dest-root> [--mirror] [--files=a,b]
#
# Writes <dest-root>/<date>/<name>-<date>.csv.bz2 for every bulk file CourtListener
# published for that date (or only the --files kinds), plus SHA256SUMS. Re-running
# resumes partial downloads and skips files already complete. --mirror uploads the
# directory to s3://$JURVIO_SPACES_BUCKET/courtlistener/bulk-mirror/<date>/ with
# rclone, using the JURVIO_SPACES_* credentials from the environment.
#
# Host requirements: bash, curl, python3, sha256sum; rclone for --mirror.
set -euo pipefail

snapshot=${1:?usage: fetch-courtlistener-snapshot.sh <YYYY-MM-DD> <dest-root> [--mirror] [--files=a,b]}
root=${2:?usage: fetch-courtlistener-snapshot.sh <YYYY-MM-DD> <dest-root> [--mirror] [--files=a,b]}
shift 2
mirror=false
files=""
for argument in "$@"; do
  case "$argument" in
    --mirror) mirror=true ;;
    --files=*) files=${argument#--files=} ;;
    *) echo "unknown argument: $argument" >&2; exit 2 ;;
  esac
done
case "$snapshot" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) echo "snapshot must be YYYY-MM-DD" >&2; exit 2 ;; esac

bucket_url=https://com-courtlistener-storage.s3-us-west-2.amazonaws.com
dest="$root/$snapshot"
mkdir -p "$dest"
cd "$dest"

# List the snapshot's files with their sizes (S3 ListObjectsV2, paginated).
python3 - "$bucket_url" "$snapshot" "$files" > listing.txt <<'PY'
import sys, urllib.parse, urllib.request, xml.etree.ElementTree as ET
base, snapshot, only = sys.argv[1], sys.argv[2], {f for f in sys.argv[3].split(",") if f}
ns = "{http://s3.amazonaws.com/doc/2006-03-01/}"
token, found = None, 0
while True:
    query = {"list-type": "2", "prefix": "bulk-data/", "max-keys": "1000"}
    if token:
        query["continuation-token"] = token
    with urllib.request.urlopen(f"{base}/?{urllib.parse.urlencode(query)}", timeout=60) as response:
        tree = ET.fromstring(response.read())
    for item in tree.iter(f"{ns}Contents"):
        key = item.find(f"{ns}Key").text
        name = key.rsplit("/", 1)[-1]
        if f"-{snapshot}." not in name:
            continue
        if only and name.split(f"-{snapshot}.")[0] not in only:
            continue
        print(item.find(f"{ns}Size").text, name)
        found += 1
    if tree.find(f"{ns}IsTruncated").text != "true":
        break
    token = tree.find(f"{ns}NextContinuationToken").text
if not found:
    sys.exit(f"no bulk files found for {snapshot}")
PY

needed=$(awk '{ total += $1 } END { print total }' listing.txt)
available=$(( $(df -Pk . | awk 'NR == 2 { print $4 }') * 1024 ))
already=0
while read -r size name; do
  if [[ -f "$name" ]]; then already=$(( already + $(stat -c %s "$name") )); fi
done < listing.txt
if (( needed - already > available )); then
  echo "need $(( (needed - already) / 1024**3 )) GiB free in $dest, have $(( available / 1024**3 )) GiB" >&2
  exit 1
fi

while read -r size name; do
  if [[ -f "$name" && $(stat -c %s "$name") == "$size" ]]; then
    echo "have $name"
    continue
  fi
  echo "fetch $name ($(( size / 1024**2 )) MiB)"
  curl -fsSL --retry 8 --retry-delay 5 --retry-all-errors -C - -o "$name" "$bucket_url/bulk-data/$name"
  actual=$(stat -c %s "$name")
  if [[ "$actual" != "$size" ]]; then
    echo "$name is $actual bytes, expected $size" >&2
    exit 1
  fi
done < listing.txt

# Checksum in parallel; the backfill records these as each file's provenance hash.
# Entries for files outside this run's --files selection are kept.
awk '{ print $2 }' listing.txt | xargs -P "$(nproc)" -n 1 sha256sum > SHA256SUMS.new
if [[ -f SHA256SUMS ]]; then
  awk 'NR == FNR { fetched[$2] = 1; next } !($2 in fetched)' SHA256SUMS.new SHA256SUMS >> SHA256SUMS.new
fi
sort -k 2 SHA256SUMS.new > SHA256SUMS.tmp
rm SHA256SUMS.new
mv SHA256SUMS.tmp SHA256SUMS
echo "verified $(wc -l < listing.txt) files ($(( needed / 1024**3 )) GiB); SHA256SUMS lists $(wc -l < SHA256SUMS)"

if [[ "$mirror" == true ]]; then
  : "${JURVIO_SPACES_ACCESS_KEY_ID:?JURVIO_SPACES_ACCESS_KEY_ID is required for --mirror}"
  : "${JURVIO_SPACES_SECRET_ACCESS_KEY:?JURVIO_SPACES_SECRET_ACCESS_KEY is required for --mirror}"
  endpoint=${JURVIO_SPACES_ENDPOINT:-https://nyc3.digitaloceanspaces.com}
  RCLONE_CONFIG_SPACES_TYPE=s3 \
  RCLONE_CONFIG_SPACES_PROVIDER=DigitalOcean \
  RCLONE_CONFIG_SPACES_ENDPOINT=${endpoint#https://} \
  RCLONE_CONFIG_SPACES_ACCESS_KEY_ID=$JURVIO_SPACES_ACCESS_KEY_ID \
  RCLONE_CONFIG_SPACES_SECRET_ACCESS_KEY=$JURVIO_SPACES_SECRET_ACCESS_KEY \
    rclone copy . "spaces:${JURVIO_SPACES_BUCKET:-jurvio-raw-evidence}/courtlistener/bulk-mirror/$snapshot/" \
      --include "*-$snapshot.*" --include SHA256SUMS --size-only --transfers 4 --s3-chunk-size 64M
  echo "mirrored to ${JURVIO_SPACES_BUCKET:-jurvio-raw-evidence}/courtlistener/bulk-mirror/$snapshot/"
fi
