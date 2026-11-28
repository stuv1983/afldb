#!/usr/bin/bash
# verify-verify-install.sh (R6 r7, MED-2): READ-ONLY check of an installed afldb-verify (production --role prod, streamanator
# --role offhost). Run as root (complete: sshd -T needs root) or as any user (sshd checks are then reported as SKIPPED, not passed).
# Writes nothing. Prints PASS/FAIL lines and "VERIFY-INSTALL RESULT PASS|FAIL"; exit 0 only on PASS.
#   bash verify-verify-install.sh --role prod|offhost
set -uo pipefail; export LC_ALL=C PATH=/usr/sbin:/usr/bin
VB=/usr/local/lib/afldb-verify; F=0
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; F=1; }
ROLE=; [ "${1:-}" = --role ] && ROLE=${2:-}
[[ $ROLE =~ ^(prod|offhost)$ ]] || { echo "usage: verify-verify-install.sh --role prod|offhost"; exit 2; }
. "$VB/lib.sh" 2>/dev/null || { echo "FAIL no installed $VB/lib.sh"; echo "VERIFY-INSTALL RESULT FAIL"; exit 1; }
echo "== verify-verify-install $(date -u +%FT%TZ) host=$(hostname) role=$ROLE as $(id -un)"
# bundle
if trusted_path "$VB" dir && trusted_path "$VB/SHA256SUMS" file; then
  n=0; bf=0
  while read -r h f; do n=$((n + 1)); trusted_path "$VB/$f" file || { bad "bundle file: $TP_WHY"; bf=1; continue; }
    a=$(sha256sum < "$VB/$f"); [ "${a%% *}" = "$h" ] || { bad "$VB/$f does not match SHA256SUMS"; bf=1; }; done < "$VB/SHA256SUMS"
  [ "$(cut -d' ' -f3 "$VB/SHA256SUMS" | cat - <(echo SHA256SUMS) | sort)" = "$(ls -A "$VB" | sort)" ] || { bad "the bundle directory holds unlisted files"; bf=1; }
  [ "$bf" = 0 ] && ok "bundle: $n files match SHA256SUMS; bundle digest $(sha256sum < "$VB/SHA256SUMS" | cut -c1-64)"
else bad "bundle directory: $TP_WHY"; fi
for p in afldb-verify-rootfacts.socket:/etc/systemd/system/afldb-verify-rootfacts.socket afldb-verify-rootfacts@.service:/etc/systemd/system/afldb-verify-rootfacts@.service \
         60-afldb-verify.conf:/etc/ssh/sshd_config.d/60-afldb-verify.conf; do
  trusted_path "${p#*:}" file && cmp -s "${p#*:}" "$VB/${p%%:*}" && ok "${p#*:} = bundle copy" || bad "${p#*:} missing, untrusted or not the bundle copy"
done
for x in "$VB/afldb-verify-entry" "$VB/afldb-verify-dispatch"; do [ -x "$x" ] && ok "$x executable" || bad "$x not executable"; done
trusted_path /etc/afldb-verify/role file && [ "$(cat /etc/afldb-verify/role)" = "$ROLE" ] && ok "role file = $ROLE" || bad "role file"
if trusted_path /etc/ssh/afldb-verify/authorized_keys file; then
  n=$(grep -c . /etc/ssh/afldb-verify/authorized_keys); r=$(grep -c "^restrict,command=\"$VB/afldb-verify-entry\" ssh-ed25519 " /etc/ssh/afldb-verify/authorized_keys)
  [ "$n" -ge 1 ] && [ "$n" = "$r" ] && ok "authorized_keys: $n key line(s), every one restrict + forced command" || bad "authorized_keys: $n lines, $r restricted"
else bad "authorized_keys: $TP_WHY"; fi
# account
E=$(getent passwd afldb-verify)
[[ $E =~ ^afldb-verify:[^:]*:[0-9]+:[0-9]+:[^:]*:/var/lib/afldb-verify:/bin/sh$ ]] && ok "account: $E" || bad "account entry '$E'"
[ "${E#*:*:}" != "${E}" ] && [ "$(id -u afldb-verify 2>/dev/null)" != 0 ] && [ "$(id -u afldb-verify 2>/dev/null)" != "$(id -u arm 2>/dev/null)" ] || bad "afldb-verify uid is root or arm's"
WANT="afldb-verify systemd-journal"; [ "$ROLE" = prod ] && WANT="afldb-backup-read afldb-verify systemd-journal"
HAVE=$(id -Gn afldb-verify | tr ' ' '\n' | sort | tr '\n' ' '); HAVE=${HAVE% }
[ "$HAVE" = "$WANT" ] && ok "groups: $HAVE" || bad "groups '$HAVE' (expected '$WANT')"
[ -z "$(getent group afldb-verify | cut -d: -f4)" ] && ok "group afldb-verify has no supplementary member (arm cannot reach the root facts socket)" || bad "group afldb-verify members: $(getent group afldb-verify | cut -d: -f4)"
! id -Gn arm 2>/dev/null | tr ' ' '\n' | grep -qx afldb-verify && ok "arm is not in group afldb-verify" || bad "arm is in group afldb-verify"
trusted_path /var/lib/afldb-verify dir && [ -z "$(ls -A /var/lib/afldb-verify 2>/dev/null)" ] && ok "home /var/lib/afldb-verify root-owned and empty" || bad "home not root-owned/empty"
# socket
[ "$(systemctl is-active afldb-verify-rootfacts.socket)" = active ] && [ "$(systemctl is-enabled afldb-verify-rootfacts.socket)" = enabled ] \
  && ok "afldb-verify-rootfacts.socket active and enabled" || bad "afldb-verify-rootfacts.socket not active/enabled"
s=$(stat -c '%U:%G %a %F' /run/afldb-verify-rootfacts.sock 2>/dev/null); [ "$s" = "root:afldb-verify 660 socket" ] && ok "socket file $s" || bad "socket file '$s'"
# sshd
if [ "$(id -u)" = 0 ]; then
  T=$(sshd -T -C user=afldb-verify,host=verify.invalid,addr=127.0.0.1 2>&1)
  for w in "forcecommand $VB/afldb-verify-entry" 'permittty no' 'allowtcpforwarding no' 'allowagentforwarding no' 'x11forwarding no' 'permittunnel no' \
           'permituserenvironment no' 'permituserrc no' 'authorizedkeysfile /etc/ssh/afldb-verify/authorized_keys' 'passwordauthentication no'; do
    grep -qx "$w" <<< "$T" && ok "sshd for afldb-verify: $w" || bad "sshd for afldb-verify lacks '$w'"
  done
  T=$(sshd -T -C user=arm,host=verify.invalid,addr=127.0.0.1 2>&1); ! grep -q "^forcecommand $VB" <<< "$T" && ok "sshd for arm: not forced into the verifier" || bad "sshd forces arm into the verifier"
else echo "SKIPPED sshd -T checks (not root)"; fi
[ "$F" = 0 ] && { echo "VERIFY-INSTALL RESULT PASS"; exit 0; }
echo "VERIFY-INSTALL RESULT FAIL"; exit 1
