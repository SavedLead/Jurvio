#!/usr/bin/env bash
# Run one bundled Jurvio job on THIS builder runner against the production
# database, so heavy parsing/downloading never runs on jurvio-web-01 (the DB
# server). Used by the citation-web workflows (ADR 0090).
#
#   scripts/ops/builder-job.sh jobs/<job>.mjs [job args...]
#
# Needs: SSH to $INGESTION_USER@$DB_HOST already configured (SSH_CONFIG_FILE or ~/.ssh), GH_TOKEN with
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
# SSH_CONFIG_FILE: per-run config written by the workflow (keeps ~/.ssh untouched).
ssh_cfg=(); [ -n "${SSH_CONFIG_FILE:-}" ] && ssh_cfg=(-F "$SSH_CONFIG_FILE")
# ONE multiplexed SSH connection for every remote call and the DB tunnel: web-01
# rate-limits new SSH connections, and the 7th connection in a few seconds (the
# tunnel) was refused (coverage report run 41326100876).
cm="$(mktemp -u /tmp/jvcm.XXXXXXXX)"
ssh_cfg+=(-o "ControlPath=$cm")
target="$INGESTION_USER@$DB_HOST"
cleanup() {
  ssh "${ssh_cfg[@]}" -O exit "$target" >/dev/null 2>&1 || true
  rm -rf "$work" "$cm"
}
trap cleanup EXIT
for attempt in 1 2 3 4; do
  ssh "${ssh_cfg[@]}" -o ControlMaster=yes -o ControlPersist=no -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -fN "$target" && break
  [ "$attempt" = 4 ] && { echo "::error::cannot open SSH to web-01"; exit 1; }
  sleep $((attempt * 20))
done
remote() { ssh "${ssh_cfg[@]}" "$target" "$@"; }
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
  # Free local port per run (concurrent builder jobs must not share 15432).
  port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')"; host=127.0.0.1
  ssh "${ssh_cfg[@]}" -O forward -L "127.0.0.1:$port:$bind_host:5432" "$target" >/dev/null
  up=""
  for _ in $(seq 1 20); do timeout 2 bash -c "</dev/tcp/127.0.0.1/$port" 2>/dev/null && { up=1; break; }; sleep 1; done
  [ -n "$up" ] || { echo "::error::database tunnel via web-01 did not come up"; exit 1; }
  echo "database route: ssh tunnel via web-01 (multiplexed, local port $port)"
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
