#!/usr/bin/bash
# verify-backup-install.sh: R6 r7 (28 Nov 2026), r8 --as-arm. READ-ONLY check of the sealed nightly backup installation (DESIGN.md
# 2-4). It writes nothing, starts nothing and changes no state; its one database action (as root only) is a peer-authenticated
# `SELECT current_user` as afldb-backup. Modes:
#   as root:  bash verify-backup-install.sh            the root checks; ends "BACKUP INSTALL RESULT PASS|FAIL" (exit 0 only on PASS)
#   as root:  bash verify-backup-install.sh --as-arm   arm's checks, ACCEPTANCE evidence (r8): root re-executes the bytes of this same
#             root-owned script as arm WITHOUT arm's login:
#               setsid -w setpriv --reuid=arm --regid=arm --init-groups --reset-env /usr/bin/bash --noprofile --norc -c <bytes> ...
#             with stdin /dev/null, in a new session (no controlling terminal: the arm process cannot reach root's terminal), and its
#             output through a pipe that root prints sanitised (printable ASCII) and prefixed "[as arm] ". The script's bytes are
#             passed with -c because the staging directory may be root-only (arm cannot open the path); their sha256 is printed and
#             is the file's. The verdict is the child's EXIT STATUS (another arm process can write into the child's pipe, never
#             change its exit status), plus the dropped identity: `setpriv ... /usr/bin/id` must equal root's `id arm`.
#             Ends "BACKUP INSTALL RESULT PASS (as arm via setpriv, no login: <id>)" or "... FAIL ...".
#   as arm:   bash verify-backup-install.sh            INFO ONLY, never acceptance evidence: arm's own session and login environment
#             choose what that process is and prints. Ends "BACKUP INSTALL RESULT INFO-ONLY ...".
# It sources the INSTALLED gate library /usr/local/lib/afldb-backup/sealed-origin.sh only after checking its path and its pinned
# digest, and runs sealed_origin_install (trusted paths, pinned code and drop-in digests, the effective unit as PID 1 has it).
set -u -o pipefail
export LC_ALL=C PATH=/usr/sbin:/usr/bin
MODE=plain
case ${1:-} in '') ;; --as-arm) MODE=as-arm;; --as-arm-child) MODE=child;; *) printf 'usage: verify-backup-install.sh [--as-arm]\n'; exit 2;; esac
if [ "$MODE" = as-arm ]; then
  SELF=$(realpath -e -- "$0" 2>/dev/null) || { printf 'FAIL cannot resolve this script (%s)\nBACKUP INSTALL RESULT FAIL\n' "${0//[^A-Za-z0-9\/._-]/?}"; exit 1; }
fi
cd / || exit 90
LIB=/usr/local/lib/afldb-backup/sealed-origin.sh
LIB_SHA=a733e67b898879d03e76b7d446d0f8bfbe0dd13923a586c19b42cdffd828887e
CODE=/usr/local/lib/afldb-backup; DR=/var/lib/afldb-backup; DID=/etc/systemd/system/afldb-backup.service.d
DSN='postgresql://afldb_backup@/afldb_prod?host=/var/run/postgresql'
F=0
ok() { printf 'PASS %s\n' "$*"; }
bad() { printf 'FAIL %s\n' "$*"; F=1; }
info() { printf 'INFO %s\n' "$*"; }
ME=$(id -un)

# ---- --as-arm (root): drop to arm without arm's login, run the arm checks, judge by exit status and the dropped identity
if [ "$MODE" = as-arm ]; then
  printf '== verify-backup-install --as-arm %s as %s\n' "$(date -u +%FT%TZ)" "$(id)"
  [ "$(id -u)" = 0 ] || { printf 'FAIL --as-arm is run by root (it drops to arm itself)\nBACKUP INSTALL RESULT FAIL\n'; exit 1; }
  read -r su sa <<< "$(stat -c '%u %a' -- "$SELF" 2>/dev/null)"
  [ "$su" = 0 ] && [[ $sa =~ ^[0-7]{3,4}$ ]] && ! (( 8#$sa & 8#022 )) \
    || { printf 'FAIL %s is not a root-owned file without group/other write (uid %s mode %s)\nBACKUP INSTALL RESULT FAIL\n' "$SELF" "$su" "$sa"; exit 1; }
  BODY=$(cat -- "$SELF") || { printf 'FAIL cannot read %s\nBACKUP INSTALL RESULT FAIL\n' "$SELF"; exit 1; }
  id arm > /dev/null 2>&1 || { printf 'FAIL there is no user arm\nBACKUP INSTALL RESULT FAIL\n'; exit 1; }
  DROP=(setpriv --reuid=arm --regid=arm --init-groups --reset-env)
  WANT=$(id arm)
  GOT=$(setsid -w "${DROP[@]}" /usr/bin/id < /dev/null 2>&1 | tr -c '\n\40-\176' '?' | head -n 3); GOT=${GOT//$'\n'/ }
  printf 'script %s: file sha256 %s, bytes passed to the arm process sha256 %s\n' "$SELF" "$(sha256sum < "$SELF" | cut -c1-64)" "$(printf '%s\n' "$BODY" | sha256sum | cut -c1-64)"
  printf 'drop: setsid -w %s /usr/bin/bash --noprofile --norc -c <script> verify-backup-install.sh --as-arm-child < /dev/null\n' "${DROP[*]}"
  printf 'dropped identity (setsid -w %s /usr/bin/id): %s\n' "${DROP[*]}" "$GOT"
  printf "root's id arm:                                                            %s\n" "$WANT"
  OUT=$(setsid -w "${DROP[@]}" /usr/bin/bash --noprofile --norc -c "$BODY" verify-backup-install.sh --as-arm-child < /dev/null 2>&1); RC=$?
  printf '%s\n' "$OUT" | tr -c '\n\40-\176' '?' | sed 's/^/[as arm] /'
  printf 'arm process exit status %s\n' "$RC"
  if [ "$RC" = 0 ] && [ "$GOT" = "$WANT" ]; then printf 'BACKUP INSTALL RESULT PASS (as arm via setpriv, no login: %s)\n' "$GOT"; exit 0; fi
  printf 'BACKUP INSTALL RESULT FAIL (as arm via setpriv, no login: exit %s; dropped identity %s; id arm %s)\n' "$RC" "$GOT" "$WANT"; exit 1
fi

printf '== verify-backup-install %s as %s%s\n' "$(date -u +%FT%TZ)" "$(id)" "$([ "$MODE" = child ] && echo ' (--as-arm child: started by root through setpriv, no login)')"
if [ "$MODE" = child ] && [ "$ME" != arm ]; then printf 'FAIL --as-arm-child runs only as arm (started by --as-arm)\nAS-ARM CHILD RESULT FAIL\n'; exit 1; fi
if [ "$MODE" = plain ] && [ "$ME" = arm ]; then
  info "this run is in arm's own session: INFO ONLY, not acceptance evidence (arm's login environment chooses this process); the acceptance run is root's 'bash verify-backup-install.sh --as-arm'"
fi

# The library: a root-owned path without symbolic links, the pinned digest; then sealed_origin_install.
s=$(stat -c '%u %a %h %F' -- / /usr /usr/local /usr/local/lib $CODE $LIB 2>&1 | tr '\n' ';')
[[ $s =~ ^(0\ [0-7]*[0145][0145]\ [0-9]+\ directory\;){5}0\ [0-7]*[0145][0145]\ 1\ regular\ file\;$ ]] || { bad "the installed library path is not root-owned without group/other write: $s"; }
h=$(sha256sum < $LIB 2>/dev/null | cut -c1-64)
if [ "$h" != "$LIB_SHA" ]; then
  bad "$LIB has sha256 '${h:0:16}', not the pinned ${LIB_SHA:0:16}"
  [ "$MODE" = child ] && { printf 'AS-ARM CHILD RESULT FAIL\n'; exit 1; }
  printf 'BACKUP INSTALL RESULT FAIL\n'; exit 1
fi
# shellcheck source=/dev/null
. $LIB
if sealed_origin_install; then ok "sealed_origin_install: trusted paths, pinned digests (run, sealer, backup.sh, drop-in, base unit = deploy/afldb-backup.service), effective unit (exactly the drop-in, no environment or bind settings)"
else bad "sealed_origin_install: $SO_REASON"
  [[ $SO_REASON == *"FragmentPath"* ]] && info "the installed base unit differs from the repository's deploy/afldb-backup.service: every gate STOPs (fail closed) until it is replaced with that file and systemctl daemon-reload is run (README.md section 4 item 13)"
fi
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
last=none; [ "${#seals[@]}" -gt 0 ] && last=${seals[${#seals[@]}-1]}   # r8: r7 indexed an empty array ("bad array subscript")
info "seals: ${#seals[@]}; published dumps: ${#pubs[@]}; last seal: $last"

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
  info "arm's checks: run 'bash verify-backup-install.sh --as-arm' in this root session (acceptance evidence)"
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
if [ "$MODE" = child ]; then [ "$F" = 0 ] && { printf 'AS-ARM CHILD RESULT PASS\n'; exit 0; }; printf 'AS-ARM CHILD RESULT FAIL\n'; exit 1; fi
if [ "$ME" = arm ]; then
  [ "$F" = 0 ] && { printf "BACKUP INSTALL RESULT INFO-ONLY pass in arm's own session (not acceptance evidence: use --as-arm as root)\n"; exit 0; }
  printf "BACKUP INSTALL RESULT INFO-ONLY fail in arm's own session (not acceptance evidence: use --as-arm as root)\n"; exit 1
fi
[ "$F" = 0 ] && { printf 'BACKUP INSTALL RESULT PASS\n'; exit 0; }
printf 'BACKUP INSTALL RESULT FAIL\n'; exit 1
