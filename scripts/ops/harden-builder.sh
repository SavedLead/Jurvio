#!/usr/bin/env bash
# P5: harden the self-hosted GitHub Actions runner on jurvio-builder-01.
# Run as root (via sudo) ON the builder. Idempotent. Does NOT restart the runner
# (this may run inside a runner job; Restart=always applies on the next exit and
# daemon-reload makes it the live policy immediately).
set -euo pipefail

echo "=== locate runner unit ==="
UNIT="$(systemctl list-unit-files 'actions.runner.*.service' --no-legend 2>/dev/null | awk '{print $1}' | head -1)"
if [ -z "${UNIT:-}" ]; then
  # Fall back to a loaded (running) unit if no unit-file symlink exists yet.
  UNIT="$(systemctl list-units 'actions.runner.*.service' --no-legend --all 2>/dev/null | awk '{print $1}' | head -1)"
fi
if [ -z "${UNIT:-}" ]; then
  echo "ERROR: no actions.runner.*.service unit found"
  systemctl list-units 'actions.runner.*' --all || true
  exit 1
fi
echo "runner unit: $UNIT"

echo "=== BEFORE ==="
systemctl show "$UNIT" -p Restart -p UnitFileState -p ActiveState -p SubState || true

echo "=== install Restart=always drop-in ==="
DROPIN="/etc/systemd/system/${UNIT}.d"
mkdir -p "$DROPIN"
cat > "$DROPIN/10-restart.conf" <<'EOF'
[Service]
Restart=always
RestartSec=10
EOF

systemctl daemon-reload
systemctl enable "$UNIT"
# Intentionally NO `systemctl restart`: the runner is (likely) executing this job.

echo "=== block unattended-upgrades automatic reboot ==="
cat > /etc/apt/apt.conf.d/99jurvio-no-reboot <<'EOF'
// Managed by Jurvio: never let unattended-upgrades reboot the CI builder.
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
EOF
chmod 644 /etc/apt/apt.conf.d/99jurvio-no-reboot

echo "=== VERIFY: runner service ==="
systemctl show "$UNIT" -p Restart -p RestartUSec -p UnitFileState -p ActiveState -p SubState
echo "is-enabled: $(systemctl is-enabled "$UNIT" 2>&1 || true)"
echo "is-active:  $(systemctl is-active "$UNIT" 2>&1 || true)"

echo "=== VERIFY: unattended-upgrades reboot policy (effective) ==="
apt-config dump 2>/dev/null | grep -i 'Unattended-Upgrade::Automatic-Reboot' || echo "(no Automatic-Reboot keys surfaced by apt-config)"
echo "--- files declaring Automatic-Reboot ---"
grep -rniE 'Automatic-Reboot' /etc/apt/apt.conf.d/ 2>/dev/null || true

echo "=== DONE ==="
