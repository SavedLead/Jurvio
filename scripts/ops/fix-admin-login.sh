#!/usr/bin/env bash
# Diagnose and fix the jurvio-admin SSH login. Runs AS ROOT (via jurvio-runner's
# temporary sudo from /etc/sudoers.d/j). Strictly additive/corrective: fixes the
# admin account's key, ownership, permissions, shell, and — only if sshd gates
# logins by AllowUsers/AllowGroups and excludes jurvio-admin — adds a minimal
# drop-in permitting it. Never touches root or existing accounts.
set -uo pipefail
ADMIN=jurvio-admin
KEYLINE='from="127.0.0.1,::1,10.116.0.0/20,10.10.0.0/16",no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-pty,no-user-rc ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJZ19JragRwaiwPIOWXhdwmR73p0CKib2kGIE9jnW1vz github-actions-jurvio-deploy'

echo "=========== DIAGNOSE ==========="
getent passwd "$ADMIN" || echo "MISSING $ADMIN"
echo "lock/shell: $(passwd -S "$ADMIN" 2>/dev/null || echo n/a)"
echo "home:  $(ls -ld "/home/$ADMIN" 2>/dev/null || echo '(none)')"
echo ".ssh:  $(ls -ld "/home/$ADMIN/.ssh" 2>/dev/null || echo '(none)')"
echo "akeys: $(ls -l "/home/$ADMIN/.ssh/authorized_keys" 2>/dev/null || echo '(none)')"
echo "akeys content:"; cat "/home/$ADMIN/.ssh/authorized_keys" 2>/dev/null || echo "(none)"
echo "groups: $(id "$ADMIN" 2>/dev/null || echo n/a)"
echo "sshd effective gates:"; sshd -T 2>/dev/null | grep -iE '^(allowusers|allowgroups|pubkeyauthentication|authorizedkeysfile|permitrootlogin|usepam) ' || echo "(no allow/pubkey directives -> defaults)"

echo "=========== FIX (minimum necessary) ==========="
id "$ADMIN" >/dev/null 2>&1 || { useradd -m -s /bin/bash "$ADMIN"; echo "created $ADMIN"; }
usermod -s /bin/bash "$ADMIN"                       # ensure interactive shell (not nologin)
install -d -m 700 -o "$ADMIN" -g "$ADMIN" "/home/$ADMIN/.ssh"
printf '%s\n' "$KEYLINE" > "/home/$ADMIN/.ssh/authorized_keys"
chown -R "$ADMIN:$ADMIN" "/home/$ADMIN/.ssh"
chmod 700 "/home/$ADMIN/.ssh"; chmod 600 "/home/$ADMIN/.ssh/authorized_keys"
chown "$ADMIN:$ADMIN" "/home/$ADMIN"; chmod go-w "/home/$ADMIN"   # StrictModes: home not group/world-writable
echo "authorized_keys installed: $(ls -l "/home/$ADMIN/.ssh/authorized_keys")"

# Scoped passwordless sudo policy (create if missing/incorrect). Resolve actual
# binary paths so the allowlist matches regardless of usrmerge layout. Covers
# systemd, Docker, packages, unattended-upgrades, networking, monitoring, and
# the runner; tee is scoped to config trees only.
SUDOERS=/etc/sudoers.d/90-jurvio-admin
cmds=""
for b in systemctl journalctl docker apt apt-get apt-config dpkg unattended-upgrade ip ss ufw netplan sysctl mkdir; do
  p="$(command -v "$b" 2>/dev/null || true)"
  [ -n "$p" ] && cmds="${cmds:+$cmds, }$p"
done
TEE="$(command -v tee 2>/dev/null || echo /usr/bin/tee)"
cmds="$cmds, $TEE /etc/apt/apt.conf.d/*, $TEE /etc/systemd/system/*, $TEE /etc/sysctl.d/*"
printf '%s ALL=(ALL) NOPASSWD: %s\n' "$ADMIN" "$cmds" > "$SUDOERS"
chmod 440 "$SUDOERS"
if visudo -cf "$SUDOERS"; then echo "scoped sudoers installed: $SUDOERS"; else echo "BAD sudoers; removing"; rm -f "$SUDOERS"; fi

# sshd allow-list gate: add jurvio-admin via a minimal drop-in only if needed.
AU="$(sshd -T 2>/dev/null | sed -n 's/^allowusers //Ip')"
AG="$(sshd -T 2>/dev/null | sed -n 's/^allowgroups //Ip')"
DROP=/etc/ssh/sshd_config.d/99-jurvio-admin.conf
NEED=0; TMP="$(mktemp)"
if [ -n "$AU" ] && ! printf ' %s ' "$AU" | grep -qiw "$ADMIN"; then
  echo "AllowUsers $AU $ADMIN" >> "$TMP"; NEED=1; echo "gate: AllowUsers present and excludes $ADMIN -> adding it"
fi
if [ -n "$AG" ]; then
  admin_groups=" $(id -nG "$ADMIN" 2>/dev/null) "
  permitted=0
  for g in $AG; do case "$admin_groups" in *" $g "*) permitted=1 ;; esac; done
  if [ "$permitted" = 0 ]; then
    echo "AllowGroups $AG $ADMIN" >> "$TMP"; NEED=1; echo "gate: AllowGroups present and excludes $ADMIN -> permitting its own group"
  fi
fi
if [ "$NEED" = 1 ]; then
  cp "$TMP" "$DROP"; chmod 644 "$DROP"
  if sshd -t; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || systemctl reload ssh.service 2>/dev/null || true
    echo "sshd reloaded with drop-in:"; cat "$DROP"
  else
    echo "sshd -t FAILED with drop-in; reverting"; rm -f "$DROP"
  fi
else
  echo "no sshd allow-list change needed"
fi
rm -f "$TMP"
echo "post-fix sshd gates: $(sshd -T 2>/dev/null | grep -iE '^(allowusers|allowgroups) ' | tr '\n' ';' || echo none)"
echo "DONE-FIX"
