#!/usr/bin/env bash
# Run one bundled Jurvio job on THIS builder runner against the production
# database, so heavy parsing/downloading never runs on jurvio-web-01 (the DB
# server). Used by the citation-web workflows (ADR 0090).
#
#   scripts/ops/builder-job.sh jobs/<job>.mjs [job args...]
#
# Needs: SSH to $INGESTION_USER@$DB_HOST already configured, GH_TOKEN with
# packages:read (to pull the image), docker on the runner.
# Optional: JOB_CPUS (default 1.25), JOB_MEMORY (default 2500m),
#   JOB_ENV_KEYS (extra env names copied from the worker, space separated).
#
# Secrets: the worker's DATABASE_URL (and any JOB_ENV_KEYS) are read over SSH
# straight into a mode-600 env file, masked, never printed, and deleted on exit.
set -euo pipefail
job="$1"; shift
: "${INGESTION_USER:?}" "${DB_HOST:?}" "${GH_TOKEN:?}"
JOB_CPUS="${JOB_CPUS:-1.25}"; JOB_MEMORY="${JOB_MEMORY:-2500m}"
work="$(mktemp -d)"; chmod 700 "$work"
tunnel_pid=""
cleanup() {
  [ -n "$tunnel_pid" ] && kill "$tunnel_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

remote() { ssh "$INGESTION_USER@$DB_HOST" "$@"; }
worker="$(remote "sudo -n docker ps --filter label=com.docker.compose.project=jurvio --filter label=com.docker.compose.service=worker-citations --format '{{.ID}}' | head -n1")"
[ -n "$worker" ] || worker="$(remote "sudo -n docker ps --filter label=com.docker.compose.project=jurvio --filter label=com.docker.compose.service=worker-core --format '{{.ID}}' | head -n1")"
[ -n "$worker" ] || { echo "::error::no running jurvio worker container on web-01"; exit 1; }
image="$(remote "sudo -n docker inspect -f '{{.Config.Image}}' $worker")"
pg="$(remote "sudo -n docker ps --filter label=com.docker.compose.project=jurvio --filter label=com.docker.compose.service=postgres --format '{{.ID}}' | head -n1")"
bind="$(remote "sudo -n docker port $pg 5432/tcp" | grep -E '^[0-9.]+:5432$' | head -n1 || true)"
bind_host="${bind%:*}"; [ -n "$bind_host" ] || bind_host=127.0.0.1
echo "image=$image postgres_bind=$bind_host"

# Copy the needed env from the worker without echoing it.
keys="DATABASE_URL INGESTION_USER_AGENT ${JOB_ENV_KEYS:-}"
remote "sudo -n docker exec $worker sh -c 'for k in $keys; do v=\$(printenv \$k || true); [ -n \"\$v\" ] && printf \"%s=%s\n\" \"\$k\" \"\$v\"; done'" > "$work/raw.env"
chmod 600 "$work/raw.env"
grep -q '^DATABASE_URL=' "$work/raw.env" || { echo "::error::worker has no DATABASE_URL"; exit 1; }

port=5432; host="$bind_host"
if [ "$bind_host" = "127.0.0.1" ] || ! timeout 5 bash -c "</dev/tcp/$bind_host/5432" 2>/dev/null; then
  port=15432; host=127.0.0.1
  ssh -N -o ExitOnForwardFailure=yes -L "127.0.0.1:$port:$bind_host:5432" "$INGESTION_USER@$DB_HOST" &
  tunnel_pid=$!
  for _ in $(seq 1 20); do timeout 2 bash -c "</dev/tcp/127.0.0.1/$port" 2>/dev/null && break; sleep 1; done
  echo "database route: ssh tunnel via web-01"
else
  echo "database route: direct over the private VPC"
fi
python3 - "$work/raw.env" "$work/job.env" "$host" "$port" <<'PY'
import sys, urllib.parse
src, dst, host, port = sys.argv[1:5]
out = []
for line in open(src):
    line = line.rstrip("\n")
    if not line or "=" not in line: continue
    k, v = line.split("=", 1)
    if k == "DATABASE_URL":
        u = urllib.parse.urlsplit(v)
        if u.password: print(f"::add-mask::{u.password}")
        print(f"::add-mask::{v}")
        auth = u.netloc.rsplit("@", 1)[0]
        v = urllib.parse.urlunsplit((u.scheme, f"{auth}@{host}:{port}", u.path, u.query, u.fragment))
        print(f"::add-mask::{v}")
    out.append(f"{k}={v}")
open(dst, "w").write("\n".join(out) + "\n")
PY
chmod 600 "$work/job.env"; rm -f "$work/raw.env"

printf '%s' "$GH_TOKEN" | docker login ghcr.io -u SavedLead --password-stdin >/dev/null
docker pull -q "$image" >/dev/null
echo "=== running $job $* on $(hostname) (cpus=$JOB_CPUS mem=$JOB_MEMORY)"
set +e
docker run --rm --network host --cpus "$JOB_CPUS" --memory "$JOB_MEMORY" --cpu-shares 256 \
  --env-file "$work/job.env" -e NODE_ENV=production -e TZ=America/New_York \
  -e JURVIO_ARTIFACT_ROOT=/tmp/artifacts -e RAW_ARTIFACT_DIR=/tmp/artifacts \
  "$image" node "$job" "$@"
rc=$?
set -e
exit $rc
