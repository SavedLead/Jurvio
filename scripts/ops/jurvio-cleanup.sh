#!/bin/sh
# Runs as root via a transient systemd oneshot (jurvio-admin's scoped sudo
# allowlist has no 'rm', so file removal is done this way rather than by
# broadening standing sudo). Removes the temporary /etc/sudoers.d/j grant,
# writes proof to jurvio-admin's home, then removes the transient unit itself.
set -u

rm -f /etc/sudoers.d/j

PROOF=/home/jurvio-admin/jurvio-proof.txt
{
  echo "=== /etc/sudoers.d listing (after removal) ==="
  ls -la /etc/sudoers.d/
  echo "=== presence check ==="
  if [ -e /etc/sudoers.d/j ]; then
    echo "STILL-PRESENT: /etc/sudoers.d/j"
  else
    echo "REMOVED: /etc/sudoers.d/j is gone"
  fi
  echo "=== sudoers validation (whole ruleset) ==="
  visudo -c
} > "$PROOF" 2>&1
chmod 644 "$PROOF"

# Self-remove the transient unit file.
rm -f /etc/systemd/system/jurvio-oneshot-cleanup.service
