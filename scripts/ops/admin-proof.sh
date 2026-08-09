#!/bin/sh
# Gathers the root-only end-state proofs AFTER /etc/sudoers.d/j is removed.
# Runs AS ROOT via a transient jurvio-admin systemd oneshot (jurvio-runner no
# longer has sudo at this point). Writes results to a jurvio-admin-readable file
# and self-removes the transient unit.
set -u
OUT=/home/jurvio-admin/jurvio-final-proof.txt
{
  echo "=== /etc/sudoers.d listing ==="
  ls -la /etc/sudoers.d/
  echo "=== /etc/sudoers.d/j presence ==="
  if [ -e /etc/sudoers.d/j ]; then echo "STILL-PRESENT: /etc/sudoers.d/j"; else echo "GONE: /etc/sudoers.d/j removed"; fi
  echo "=== jurvio-admin scoped sudo policy (intact) ==="
  cat /etc/sudoers.d/90-jurvio-admin 2>/dev/null || echo "(missing)"
  echo "=== jurvio-runner effective sudo (should be none) ==="
  sudo -n -l -U jurvio-runner 2>&1 || echo "jurvio-runner: no sudo privileges"
  echo "=== sudoers ruleset validation ==="
  visudo -c
  echo "=== sshd config test ==="
  sshd -t && echo "SSHD-CONFIG-OK"
} > "$OUT" 2>&1
chmod 644 "$OUT"
rm -f /etc/systemd/system/jurvio-oneshot-proof.service
