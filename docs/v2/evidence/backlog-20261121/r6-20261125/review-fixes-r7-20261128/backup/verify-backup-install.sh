#!/usr/bin/bash
# verify-backup-install.sh: R6 r7 (28 Nov 2026) READ-ONLY check of the sealed nightly backup installation (DESIGN.md 2-4). Run it
# as root and then as arm (in a NEW login, so arm's process carries afldb-backup-read). It writes nothing, starts nothing and
# changes no state; its one database action (as root only) is a peer-authenticated `SELECT current_user` as afldb-backup.
#   bash verify-backup-install.sh        prints PASS/FAIL lines and "BACKUP INSTALL RESULT PASS|FAIL" (exit 0 only on PASS)
# It sources the INSTALLED gate library /usr/local/lib/afldb-backup/sealed-origin.sh only after checking its path and its pinned
# digest, and runs sealed_origin_install (trusted paths, pinned code and drop-in digests, the effective unit as PID 1 has it).
set -u -o pipefail
export LC_ALL=C PATH=/usr/sbin:/usr/bin
cd / || exit 90
LIB=/usr/local/lib/afldb-backup/sealed-origin.sh
LIB_SHA=48827fb1791d3a1e6d9cfd827be1f4e6c5471c2d6292de01b246b7e2c54f98f5
CODE=/usr/local/lib/afldb-backup; DR=/var/lib/afldb-backup; DID=/etc/systemd/system/afldb-backup.service.d
DSN='postgresql://afldb_backup@/afldb_prod?host=/var/run/postgresql'
F=0
ok() { printf 'PASS %s\n' "$*"; }
bad() { printf 'FAIL %s\n' "$*"; F=1; }
info() { printf 'INFO %s\n' "$*"; }
ME=$(id -un); printf '== verify-backup-install %s as %s\n' "$(date -u +%FT%TZ)" "$(id)"

# The library: a root-owned path without symbolic links, the pinned digest; then sealed_origin_install.
s=$(stat -c '%u %a %h %F' -- / /usr /usr/local /usr/local/lib $CODE $LIB 2>&1 | tr '\n' ';')
[[ $s =~ ^(0\ [0-7]*[0145][0145]\ [0-9]+\ directory\;){5}0\ [0-7]*[0145][0145]\ 1\ regular\ file\;$ ]] || { bad "the installed library path is not root-owned without group/other write: $s"; }
h=$(sha256sum < $LIB 2>/dev/null | cut -c1-64)
if [ "$h" != "$LIB_SHA" ]; then bad "$LIB has sha256 '${h:0:16}', not the pinned ${LIB_SHA:0:16}"; printf 'BACKUP INSTALL RESULT FAIL\n'; exit 1; fi
# shellcheck source=/dev/null
. $LIB
if sealed_origin_install; then ok "sealed_origin_install: trusted paths, pinned digests (run, sealer, backup.sh, drop-in), effective unit"
else bad "sealed_origin_install: $SO_REASON"; fi
(cd $CODE && sha256sum --strict --quiet -c SHA256SUMS > /dev/null 2>&1) && ok "$CODE/SHA256SUMS matches the installed files" || bad "$CODE/SHA256SUMS does not match"
[ ! -e $DID/60-afldb-backup-attest.conf ] && ok "the r6 attest drop-in is absent" || bad "the r6 attest drop-in $DID/60-afldb-backup-attest.conf is present"

# Accounts (DESIGN 2).
IFS=: read -r _ _ bu _ _ home shell <<< "$(getent passwd afldb-backup)"
[ "$home:$shell" = /nonexistent:/usr/sbin/nologin ] && ok "afldb-backup (uid $bu): home /nonexistent, shell /usr/sbin/nologin" || bad "afldb-backup: home '$home' shell '$shell'"
[ "$(id -Gn afldb-backup 2>/dev/null)" = afldb-backup ] && ok "afldb-backup's only group is afldb-backup" || bad "afldb-backup's groups: '$(id -Gn afldb-backup 2>&1)'"
[ -z "$(getent group afldb-backup | cut -d: -f4)" ] && ok "group afldb-backup has no members" || bad "group afldb-backup has members: $(getent group afldb-backup | cut -d: -f4)"
ag=" $(id -Gn arm 2>/dev/null) "
[[ $ag == *" afldb-backup-read "* ]] && ok "arm is in afldb-backup-read (account database)" || bad "arm is not in afldb-backup-read: $ag"
[[ $ag != *" afldb-backup "* ]] && ok "arm is not in afldb-backup" || bad "arm is in afldb-backup"
info "timer: enabled=$(systemctl is-enabled afldb-backup.timer 2>&1) active=$(systemctl is-active afldb-backup.timer 2>&1) $(systemctl show afldb-backup.timer -p TimersCalendar -p Persistent -p RandomizedDelayUSec | tr '\n' ' ')"
shopt -s nullglob; seals=($DR/seals/*.seal); pubs=($DR/published/*.dump); shopt -u nullglob
info "seals: ${#seals[@]}; published dumps: ${#pubs[@]}; last seal: ${seals[${#seals[@]}-1]:-none}"

if [ "$ME" = root ]; then
  hba=0; idn=0
  for f in /etc/postgresql/*/main/pg_hba.conf; do
    first=$(awk '!/^[[:space:]]*(#|$)/ && $1 == "local" { $1 = $1; print; exit }' "$f")
    [ "$first" = "local afldb_prod afldb_backup peer map=afldbbackup" ] && { ok "$f: the first local line is the afldb_backup peer line"; hba=1; } \
      || bad "$f: the first local line is '$first', not 'local afldb_prod afldb_backup peer map=afldbbackup'"
    g=${f%pg_hba.conf}pg_ident.conf
    awk '!/^[[:space:]]*#/ { $1 = $1; print }' "$g" | grep -qx 'afldbbackup afldb-backup afldb_backup' && { ok "$g maps afldb-backup to afldb_backup"; idn=1; } \
      || bad "$g lacks 'afldbbackup afldb-backup afldb_backup'"
  done
  [ "$hba$idn" = 11 ] || bad "no PostgreSQL configuration with both lines was found"
  u=$(setpriv --reuid=afldb-backup --regid=afldb-backup --clear-groups --no-new-privs env -i PATH=/usr/bin HOME=/nonexistent psql -X -At "$DSN" -c 'SELECT current_user' 2>&1)
  [ "$u" = afldb_backup ] && ok "afldb-backup authenticates by peer as afldb_backup (no secret)" || bad "afldb-backup peer login: '${u:0:200}' (reload PostgreSQL after the pg_hba/pg_ident lines?)"
elif [ "$ME" = arm ]; then
  [[ " $(id -Gn) " == *" afldb-backup-read "* ]] && ok "this arm process carries afldb-backup-read" || bad "this arm process lacks afldb-backup-read: log in again after the install"
  e=$(ls -A $DR/staging 2>&1) && bad "arm can list $DR/staging: $e" || ok "arm cannot list $DR/staging (${e##*: })"
  for d in $DR $DR/staging $DR/seals $DR/published $DR/state $CODE $CODE/tools/maintenance $DID; do
    [ -w "$d" ] && bad "arm can write $d" || ok "arm cannot write $d"
  done
  e=$(ls $DR/published 2>&1) && ok "arm can list $DR/published (read only: off-host pull, restore)" || bad "arm cannot list $DR/published: $e"
  e=$(env -i PATH=/usr/bin HOME=/nonexistent psql -X -At "$DSN" -c 'SELECT current_user' 2>&1) && bad "arm authenticated as afldb_backup: $e" \
    || ok "arm cannot authenticate by peer as afldb_backup (${e:0:120})"
else
  info "run as $ME: only the root-independent checks above apply"
fi
[ "$F" = 0 ] && { printf 'BACKUP INSTALL RESULT PASS\n'; exit 0; }
printf 'BACKUP INSTALL RESULT FAIL\n'; exit 1
