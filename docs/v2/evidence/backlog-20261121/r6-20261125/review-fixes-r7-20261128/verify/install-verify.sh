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
# r8: refuses, before any change, a root session that descends from arm ("REFUSED: root session descends from arm: <test>"; a
# tripwire, not proof of F1), and sources or executes nothing from the staging directory before it is trusted and hash-checked.
# Exit 0 only when every step and the read-only verification passed.
set -uo pipefail; export LC_ALL=C PATH=/usr/sbin:/usr/bin; umask 022
die() { echo "INSTALL-VERIFY STOP: $*"; exit 1; }
ROLE=; KEY=
while [ $# -gt 0 ]; do case $1 in --role) ROLE=${2:-}; shift 2;; --key) KEY=${2:-}; shift 2;; *) die "unknown argument $1";; esac; done
[[ $ROLE =~ ^(prod|offhost)$ ]] && [ -n "$KEY" ] || die "usage: install-verify.sh --role prod|offhost --key <public key file in the staging directory>"
[ "$(id -u)" = 0 ] || die "run as root"
# r8 installer guard (R8 DEPENDENCIES.md, F1): refuse, BEFORE ANY CHANGE, a root session that descends from arm. Three tests, each
# named when it fires: (ancestor) a process from $$ up to PID 1 (PPid in /proc/<pid>/status) has arm's uid as its real or effective
# uid; (SUDO_USER/SUDO_UID) SUDO_USER=arm or SUDO_UID=<arm's uid>; (loginuid) /proc/$$/loginuid = arm's uid (unset, 4294967295, is
# allowed). A TRIPWIRE for the documented mistake (sudo in an arm login), NOT a proof of independence: root that arm already holds can
# start this script outside its own process tree, with a clean environment and an unset loginuid. F1 remains an owner action.
arm_guard() {
  local au pid=$$ hops=0 st k a b ru eu pp nm lu; local -a why=()
  au=$(id -u arm 2>/dev/null); [[ $au =~ ^[0-9]+$ ]] || { GUARD_WHY="there is no user arm on this host"; return 2; }
  while :; do
    st=$(cat -- "/proc/$pid/status" 2>/dev/null) || { why+=("test ancestor: /proc/$pid/status unreadable, the walk to PID 1 cannot complete"); break; }
    ru=; eu=; pp=; nm=
    while read -r k a b _; do case $k in Name:) nm=$a;; Uid:) ru=$a; eu=$b;; PPid:) pp=$a;; esac; done <<< "$st"
    if [ "$ru" = "$au" ] || [ "$eu" = "$au" ]; then why+=("test ancestor: pid $pid (${nm//[^A-Za-z0-9_.:-]/?}) has real/effective uid $ru/$eu, arm is $au"); fi
    [ "$pid" = 1 ] && break
    [[ $pp =~ ^[0-9]+$ ]] && [ "$pp" != 0 ] || break   # PPid 0: the top of this PID namespace
    pid=$pp; hops=$((hops + 1)); [ "$hops" -lt 4096 ] || { why+=("test ancestor: no PID 1 within 4096 hops"); break; }
  done
  [ "${SUDO_USER:-}" = arm ] && why+=("test SUDO_USER: SUDO_USER=arm")
  [ -n "${SUDO_UID:-}" ] && [ "${SUDO_UID:-}" = "$au" ] && why+=("test SUDO_UID: SUDO_UID=$au (arm)")
  lu=$(cat /proc/$$/loginuid 2>/dev/null); [[ $lu =~ ^[0-9]+$ ]] || lu=unreadable
  [ "$lu" = "$au" ] && why+=("test loginuid: /proc/$$/loginuid=$au (arm)")
  if [ "${#why[@]}" -gt 0 ]; then GUARD_WHY=$(printf '%s; ' "${why[@]}"); GUARD_WHY=${GUARD_WHY%; }; return 1; fi
  a=${SUDO_USER:-unset}; b=${SUDO_UID:-unset}
  GUARD_OK="no ancestor of pid $$ has arm's uid ($hops hops to pid $pid), SUDO_USER=${a//[^A-Za-z0-9_.-]/?} SUDO_UID=${b//[^0-9a-z]/?}, loginuid=$lu"
}
arm_guard; g=$?
[ "$g" = 2 ] && die "$GUARD_WHY"
if [ "$g" != 0 ]; then printf 'REFUSED: root session descends from arm: %s\n' "$GUARD_WHY"; printf 'INSTALL-VERIFY RESULT FAIL (nothing was changed)\n'; exit 1; fi
echo "session check: $GUARD_OK (a tripwire for sudo in an arm login, not a proof of an independent root path: README.md section 10)"
ST=$(cd "$(dirname "$0")" && pwd -P) || die "cannot resolve the staging directory"
B=$ST/bundle; VB=/usr/local/lib/afldb-verify
# r8: nothing from the staging directory is sourced or executed before it is trusted. pre_trusted_path is a verbatim copy of
# bundle/lib.sh's trusted_path (root-owned components, no group/other write, no symbolic link); lib.sh is then sourced only when
# its bytes equal its bundle/SHA256SUMS line (r7 sourced it first, so an arm-writable staging could run its own lib.sh as root).
pre_trusted_path() { # absolute-path dir|file|record
  local p=$1 want=$2 r c= i=0 u a n t out; local -a cs=(/)
  TP_WHY=
  [[ $p =~ ^(/[A-Za-z0-9_@.][A-Za-z0-9_@.-]{0,254}){1,32}$ && /$p/ != */./* && /$p/ != */../* ]] \
    || { TP_WHY="'${p//[^A-Za-z0-9\/._@-]/?}' is not a plain absolute path"; TP_WHY=${TP_WHY:0:200}; return 1; }
  r=${p#/}; while [ -n "$r" ]; do c=$c/${r%%/*}; cs+=("$c"); if [[ $r == */* ]]; then r=${r#*/}; else r=; fi; done
  out=$(stat -c '%u %a %h %F' -- "${cs[@]}" 2>/dev/null) || { TP_WHY="$p: missing, or a component cannot be read"; return 1; }
  while read -r u a n t; do
    c=${cs[i]}; i=$((i + 1))
    [[ $u =~ ^[0-9]+$ && $a =~ ^[0-7]{3,4}$ && $n =~ ^[0-9]+$ ]] || { TP_WHY="$c: unparsable stat output"; return 1; }
    [ "$t" != "symbolic link" ] || { TP_WHY="$c is a symbolic link"; return 1; }
    [ "$u" = 0 ] || { TP_WHY="$c is owned by uid $u, not root"; return 1; }
    if (( 8#$a & 8#022 )); then TP_WHY="$c has mode $a: group- or other-writable"; return 1; fi
    if [ "$i" -lt "${#cs[@]}" ] || [ "$want" = dir ]; then [ "$t" = directory ] || { TP_WHY="$c is a $t, not a directory"; return 1; }
    else [ "$t" = "regular file" ] || { TP_WHY="$c is a $t, not a regular file"; return 1; }; fi
    [ "$i" -lt "${#cs[@]}" ] || [ "$want" != record ] || [ "$n" = 1 ] || { TP_WHY="$c has $n hard links (need 1)"; return 1; }
  done <<< "$out"
  [ "$i" = "${#cs[@]}" ] || { TP_WHY="$p: stat printed $i lines for ${#cs[@]} components"; return 1; }
}
case "$ST/" in /home/*) die "the staging directory must not be under /home";; esac
pre_trusted_path "$ST" dir && pre_trusted_path "$B" dir && pre_trusted_path "$B/SHA256SUMS" file && pre_trusted_path "$B/lib.sh" file \
  || die "staging is not root-owned and protected: $TP_WHY"
LW=$(sed -n 's/^\([0-9a-f]\{64\}\)  lib\.sh$/\1/p' "$B/SHA256SUMS"); LH=$(sha256sum < "$B/lib.sh" | cut -c1-64)
[ -n "$LW" ] && [ "$LH" = "$LW" ] || die "bundle/lib.sh ($LH) does not match its bundle/SHA256SUMS line (${LW:-none}); refused before sourcing it"
. "$B/lib.sh" || die "cannot source the checked bundle/lib.sh"   # functions only (trusted_path, ...)
echo "== install-verify $(date -u +%FT%TZ) host=$(hostname) role=$ROLE staging=$ST"
mapfile -t L < "$B/SHA256SUMS"; NAMES=()
for l in "${L[@]}"; do
  [[ $l =~ ^([0-9a-f]{64})\ \ ([A-Za-z0-9@._-]{1,64})$ ]] || die "malformed SHA256SUMS line"
  want=${BASH_REMATCH[1]}; n=${BASH_REMATCH[2]}; NAMES+=("$n"); trusted_path "$B/$n" file || die "staging file: $TP_WHY"
  h=$(sha256sum < "$B/$n"); [ "${h%% *}" = "$want" ] || die "$B/$n does not match SHA256SUMS"
done
[ "$(printf '%s\n' "${NAMES[@]}" SHA256SUMS | sort)" = "$(ls -A "$B" | sort)" ] || die "bundle/ holds files SHA256SUMS does not list"
echo "PASS staging bundle: ${#NAMES[@]} files match SHA256SUMS ($(sha256sum < "$B/SHA256SUMS" | cut -c1-64))"
# r8 (checked before any change): verify-verify-install.sh, run at the end, is executed only when trusted and equal to its line in
# the packet SHA256SUMS (compare that file's digest, printed here, with README.md before relying on this run).
trusted_path "$ST/SHA256SUMS" file && trusted_path "$ST/verify-verify-install.sh" file || die "staging verify-verify-install.sh / SHA256SUMS: $TP_WHY"
VW=$(sed -n 's/^\([0-9a-f]\{64\}\)  verify-verify-install\.sh$/\1/p' "$ST/SHA256SUMS"); VH=$(sha256sum < "$ST/verify-verify-install.sh" | cut -c1-64)
[ -n "$VW" ] && [ "$VH" = "$VW" ] || die "verify-verify-install.sh ($VH) does not match the packet SHA256SUMS line (${VW:-none})"
echo "PASS staging verify-verify-install.sh = packet SHA256SUMS line (packet SHA256SUMS $(sha256sum < "$ST/SHA256SUMS" | cut -c1-64))"
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
