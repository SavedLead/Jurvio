#!/usr/bin/env bash
# Create/refresh the jurvio-admin administrative account. Run AS ROOT on the
# target host. Idempotent and strictly additive: it never modifies root or any
# existing account, and never weakens sshd. Audit logging (sudo -> journald/
# auth.log) is left untouched so every privileged action stays recorded.
set -euo pipefail

ADMIN="${ADMIN_USER:-jurvio-admin}"
PUBKEY="${1:-}"
[ -n "$PUBKEY" ] || { echo "usage: ADMIN_USER=... bootstrap-admin.sh '<ssh-public-key>'" >&2; exit 2; }

if id "$ADMIN" >/dev/null 2>&1; then
  echo "user $ADMIN already exists"
else
  useradd --create-home --shell /bin/bash "$ADMIN"
  echo "created user $ADMIN"
fi

# Group membership (belt) plus an explicit NOPASSWD sudoers drop-in (braces).
usermod -aG sudo "$ADMIN" 2>/dev/null || true

install -d -m 700 -o "$ADMIN" -g "$ADMIN" "/home/$ADMIN/.ssh"
printf '%s\n' "$PUBKEY" > "/home/$ADMIN/.ssh/authorized_keys"
chown "$ADMIN:$ADMIN" "/home/$ADMIN/.ssh/authorized_keys"
chmod 600 "/home/$ADMIN/.ssh/authorized_keys"

SUDOERS="/etc/sudoers.d/90-jurvio-admin"
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$ADMIN" > "$SUDOERS"
chmod 440 "$SUDOERS"
visudo -cf "$SUDOERS"   # validate syntax; a bad file would break sudo, so fail loudly

echo "bootstrap complete for $ADMIN"
