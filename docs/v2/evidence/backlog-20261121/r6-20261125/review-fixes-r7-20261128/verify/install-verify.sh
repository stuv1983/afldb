#!/usr/bin/bash
# install-verify.sh (R6 r7, MED-2): PROSPECTIVE owner install of the afldb-verify owner verifier. Run by the OWNER, AS ROOT, from a
# ROOT-OWNED staging copy of the reviewed R7/verify/ directory (never from the checkout, never as arm). Nothing here was run on
# production by Claude. Usable on production (--role prod: g0, a2) and on streamanator (--role offhost: g0b).
#   bash /root/afldb-verify-staging/install-verify.sh --role prod|offhost --key /root/afldb-verify-staging/afldb_verify.pub
# It: checks the staging directory is root-owned and protected and every bundle file matches bundle/SHA256SUMS (and the set is exact);
# creates the system group and user afldb-verify (shell /bin/sh, home /var/lib/afldb-verify root:root 0755 and empty, no password,
# supplementary groups: systemd-journal, and afldb-backup-read on --role prod, which the backup install must have created);
# installs /usr/local/lib/afldb-verify/ (root:root 0755; files 0755/0644; any other file there is removed), /etc/afldb-verify/role,
# /etc/ssh/afldb-verify/authorized_keys (ONE key line: restrict,command="<entry>" <the given public key>), the sshd drop-in, the root
# facts socket and service; validates sshd (sshd -t; afldb-verify is forced, arm is not); reloads ssh; enables the socket; then runs
# verify-verify-install.sh. It never writes the checkout or anything under /home, and never touches PostgreSQL: the role, grants and
# pg_hba/pg_ident lines (verifier-db.sql, pg-auth-lines.txt) are a separate owner step, printed at the end (--role prod).
# Exit 0 only when every step and the read-only verification passed.
set -uo pipefail; export LC_ALL=C PATH=/usr/sbin:/usr/bin; umask 022
die() { echo "INSTALL-VERIFY STOP: $*"; exit 1; }
ROLE=; KEY=
while [ $# -gt 0 ]; do case $1 in --role) ROLE=${2:-}; shift 2;; --key) KEY=${2:-}; shift 2;; *) die "unknown argument $1";; esac; done
[[ $ROLE =~ ^(prod|offhost)$ ]] && [ -n "$KEY" ] || die "usage: install-verify.sh --role prod|offhost --key <public key file in the staging directory>"
[ "$(id -u)" = 0 ] || die "run as root"
ST=$(cd "$(dirname "$0")" && pwd -P) || die "cannot resolve the staging directory"
B=$ST/bundle; VB=/usr/local/lib/afldb-verify
. "$B/lib.sh" 2>/dev/null || die "no bundle/lib.sh in $ST"   # functions only (trusted_path); checked against SHA256SUMS below
trusted_path "$ST" dir && trusted_path "$B" dir && trusted_path "$B/SHA256SUMS" file || die "staging is not root-owned and protected: $TP_WHY"
echo "== install-verify $(date -u +%FT%TZ) host=$(hostname) role=$ROLE staging=$ST"
mapfile -t L < "$B/SHA256SUMS"; NAMES=()
for l in "${L[@]}"; do
  [[ $l =~ ^([0-9a-f]{64})\ \ ([A-Za-z0-9@._-]{1,64})$ ]] || die "malformed SHA256SUMS line"
  want=${BASH_REMATCH[1]}; n=${BASH_REMATCH[2]}; NAMES+=("$n"); trusted_path "$B/$n" file || die "staging file: $TP_WHY"
  h=$(sha256sum < "$B/$n"); [ "${h%% *}" = "$want" ] || die "$B/$n does not match SHA256SUMS"
done
[ "$(printf '%s\n' "${NAMES[@]}" SHA256SUMS | sort)" = "$(ls -A "$B" | sort)" ] || die "bundle/ holds files SHA256SUMS does not list"
echo "PASS staging bundle: ${#NAMES[@]} files match SHA256SUMS ($(sha256sum < "$B/SHA256SUMS" | cut -c1-64))"
case $KEY in /*) ;; *) KEY=$ST/$KEY;; esac
trusted_path "$KEY" file || die "key file: $TP_WHY"
mapfile -t K < "$KEY"
[ "${#K[@]}" = 1 ] && [[ ${K[0]} =~ ^(ssh-ed25519\ AAAAC3NzaC1lZDI1NTE5[A-Za-z0-9+/]{40,80}={0,2})(\ [A-Za-z0-9@._-]{1,64})?$ ]] \
  || die "the key file must hold exactly one ssh-ed25519 public key line (no options)"
KLINE="restrict,command=\"$VB/afldb-verify-entry\" ${BASH_REMATCH[1]} afldb-verify-owner"
for f in python3.12 bash dash env timeout journalctl systemctl; do [ -x "/usr/bin/$f" ] || die "missing /usr/bin/$f"; done

# accounts (DESIGN 2)
getent group afldb-verify > /dev/null || groupadd --system afldb-verify || die "groupadd afldb-verify"
if ! getent passwd afldb-verify > /dev/null; then
  useradd --system --gid afldb-verify --home-dir /var/lib/afldb-verify --no-create-home --shell /bin/sh afldb-verify || die "useradd afldb-verify"
fi
G=systemd-journal
if [ "$ROLE" = prod ]; then getent group afldb-backup-read > /dev/null || die "group afldb-backup-read is missing: install the sealed backup (R7/backup) first"; G=$G,afldb-backup-read; fi
usermod --gid afldb-verify --groups "$G" --home /var/lib/afldb-verify --shell /bin/sh --password '*' afldb-verify || die "usermod afldb-verify"
install -d -o root -g root -m 0755 /var/lib/afldb-verify || die "home"
[ -z "$(ls -A /var/lib/afldb-verify)" ] || die "/var/lib/afldb-verify is not empty"
[ -z "$(getent group afldb-verify | cut -d: -f4)" ] || die "group afldb-verify has supplementary members ($(getent group afldb-verify | cut -d: -f4)): only the verifier may connect to the root facts socket"
echo "PASS account: $(id afldb-verify); shell $(getent passwd afldb-verify | cut -d: -f7); home $(stat -c '%U:%G %a' /var/lib/afldb-verify)"

# bundle
install -d -o root -g root -m 0755 "$VB" || die "bundle directory"
for n in $(ls -A "$VB"); do printf '%s\n' "${NAMES[@]}" SHA256SUMS | grep -qxF "$n" || rm -f -- "$VB/$n"; done
for n in "${NAMES[@]}" SHA256SUMS; do
  case $n in afldb-verify-entry|afldb-verify-dispatch|*-core.sh|afldb-verify-py|afldb-verify-rootfacts|afldb-settle-failure-status.sh) m=0755;; *) m=0644;; esac
  install -o root -g root -m "$m" "$B/$n" "$VB/$n" || die "install $n"
done
install -d -o root -g root -m 0755 /etc/afldb-verify /etc/ssh/afldb-verify || die "config directories"
printf '%s\n' "$ROLE" > /etc/afldb-verify/role.tmp && chmod 0644 /etc/afldb-verify/role.tmp && mv -f /etc/afldb-verify/role.tmp /etc/afldb-verify/role || die "role file"
printf '%s\n' "$KLINE" > /etc/ssh/afldb-verify/authorized_keys.tmp && chmod 0644 /etc/ssh/afldb-verify/authorized_keys.tmp \
  && mv -f /etc/ssh/afldb-verify/authorized_keys.tmp /etc/ssh/afldb-verify/authorized_keys || die "authorized_keys"
install -o root -g root -m 0644 "$B/afldb-verify-rootfacts.socket" /etc/systemd/system/afldb-verify-rootfacts.socket || die "socket unit"
install -o root -g root -m 0644 "$B/afldb-verify-rootfacts@.service" /etc/systemd/system/afldb-verify-rootfacts@.service || die "service unit"
grep -qE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config || die "/etc/ssh/sshd_config does not Include /etc/ssh/sshd_config.d/*.conf"
install -d -o root -g root -m 0755 /etc/ssh/sshd_config.d
install -o root -g root -m 0644 "$B/60-afldb-verify.conf" /etc/ssh/sshd_config.d/60-afldb-verify.conf || die "sshd drop-in"
install -d -o root -g root -m 0755 /run/sshd 2>/dev/null
sshd -t || die "sshd -t rejects the configuration (the drop-in is in place: fix or remove /etc/ssh/sshd_config.d/60-afldb-verify.conf)"
T=$(sshd -T -C user=afldb-verify,host=verify.invalid,addr=127.0.0.1 2>&1)
grep -qx "forcecommand $VB/afldb-verify-entry" <<< "$T" && grep -qx 'permittty no' <<< "$T" && grep -qx 'authorizedkeysfile /etc/ssh/afldb-verify/authorized_keys' <<< "$T" \
  || die "sshd does not force the verifier for afldb-verify"
T=$(sshd -T -C user=arm,host=verify.invalid,addr=127.0.0.1 2>&1)
! grep -q "^forcecommand $VB" <<< "$T" || die "the drop-in's Match leaks onto other users"
systemctl daemon-reload || die "daemon-reload"
systemctl enable --now afldb-verify-rootfacts.socket || die "enable the root facts socket"
if systemctl is-active --quiet ssh.service; then systemctl reload ssh.service || die "reload ssh"; fi
echo "PASS installed: $VB ($(sha256sum < "$VB/SHA256SUMS" | cut -c1-64) = the bundle digest the wrapper pins), role $ROLE, sshd drop-in, root facts socket"
if [ "$ROLE" = prod ]; then
  echo "NEXT (owner, separate step, production only): apply $ST/verifier-db.sql as the database owner and the two lines of $ST/pg-auth-lines.txt"
fi
bash "$ST/verify-verify-install.sh" --role "$ROLE" || die "the read-only install verification failed"
echo "INSTALL-VERIFY RESULT PASS"
