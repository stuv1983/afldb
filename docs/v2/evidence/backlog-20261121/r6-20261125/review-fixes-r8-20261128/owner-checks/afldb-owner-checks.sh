#!/usr/bin/bash
# afldb-owner-checks.sh (R6 r8, 28 Nov 2026): READ-ONLY owner checks for the F1 root path (OWNER-PROCEDURE.md, Phase 2).
# PREPARED, NOT RUN ON PRODUCTION OR STREAMANATOR'S HOST BY CLAUDE. It changes nothing: no file is written (stdout only), no
# service is started, no account or group is changed, the database is only read (SELECT, as OS user postgres by peer).
#
# Run it AS ROOT from a ROOT-OWNED staged copy, in the admin root session (or the provider console logged in as root), NEVER in a
# session that descends from arm (an SSH login as arm, a console login as arm, `sudo` typed after either):
#   env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc \
#     /root/afldb-r8-owner-checks/afldb-owner-checks.sh --admin afldb-admin [--admin-fp SHA256:<43 chars>] [--accept <file>]
#   --admin NAME     the separate administrative account of Phase 1 (required for check F; absent or unusable = BLOCKED)
#   --admin-fp FP    the admin key's SHA256 fingerprint as read on the owner's workstation; the account must authorise exactly it
#   --accept FILE    a root-owned list (one absolute path per line) of arm-owned paths outside /home that the owner reviewed and
#                    accepts as never executed, sourced or installed by root (check E3)
#   --arm-env FILE   arm's .env (default /home/arm/projects/afldb/.env); read AS ARM, only the role NAME of each DSN is printed
#
# Output: one line per check, `CHECK <id> PASS|FAIL|UNKNOWN <fact>`, then `OWNER CHECKS RESULT PASS` (exit 0) or
# `OWNER CHECKS RESULT BLOCKED fail=<ids> unknown=<ids>` (exit 1). Usage errors exit 2. Secrets are never printed: no DSN, no
# password or hash, no key material (fingerprints only), no .env value (variable names and role names only).
# Checks: A session independence; B arm's sudo; C other arm->root routes; D PostgreSQL roles and peer maps; E arm's ability to
# modify protected components; F the admin path. If A fails, nothing else is independent and the result is BLOCKED.
set -u -o pipefail
export LC_ALL=C PATH=/usr/sbin:/usr/bin
umask 077
cd / || exit 90
ADMIN=; ADMIN_FP=; ACCEPT=; ARM_ENV=/home/arm/projects/afldb/.env
while [ $# -gt 0 ]; do
  case $1 in
    --admin) ADMIN=${2:-}; shift 2 || exit 2;;
    --admin-fp) ADMIN_FP=${2:-}; shift 2 || exit 2;;
    --accept) ACCEPT=${2:-}; shift 2 || exit 2;;
    --arm-env) ARM_ENV=${2:-}; shift 2 || exit 2;;
    *) echo "usage: afldb-owner-checks.sh --admin <name> [--admin-fp SHA256:...] [--accept <file>] [--arm-env <file>]"; exit 2;;
  esac
done
[ -z "$ADMIN" ] || [[ $ADMIN =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "usage: bad --admin name"; exit 2; }
[ -z "$ADMIN_FP" ] || [[ $ADMIN_FP =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]] || { echo "usage: --admin-fp must be SHA256:<43 base64 chars>"; exit 2; }

FAILS=(); UNKS=()
san() { printf '%s' "$*" | tr -c '\40-\176' '?' | cut -c1-400; }
chk() { # id PASS|FAIL|UNKNOWN fact...
  local id=$1 st=$2; shift 2
  printf 'CHECK %s %s %s\n' "$id" "$st" "$(san "$*")"
  case $st in FAIL) FAILS+=("$id");; UNKNOWN) UNKS+=("$id");; esac
}
have() { [ -x "$1" ]; }
# as_arm CMD...: run as arm, never through arm's startup files: no PAM session, environment reset, bash without profile or rc,
# stdin /dev/null. setpriv --init-groups gives arm its groups from the group database.
as_arm() { setpriv --reuid=arm --regid=arm --init-groups --reset-env "$@" < /dev/null; }
# trust_comp PATH: owner, group and mode of every component of PATH from /; sets TC_WHY and returns 1 when a component is owned by
# arm, is group- or other-writable, carries an ACL entry, or is a symbolic link. A missing leaf is reported, not failed (TC_ABSENT=1).
ARM_UID=$(id -u arm 2>/dev/null) || ARM_UID=
ARM_GIDS=" $(id -G arm 2>/dev/null) "
trust_comp() {
  local p=$1 cur= rest comp s u g a t acl; TC_WHY=; TC_ABSENT=0
  rest=${p#/}; local list=(/)
  while [ -n "$rest" ]; do comp=${rest%%/*}; cur=$cur/$comp; list+=("$cur"); [[ $rest == */* ]] && rest=${rest#*/} || rest=; done
  for c in "${list[@]}"; do
    if [ ! -e "$c" ] && [ ! -L "$c" ]; then TC_ABSENT=1; TC_WHY="absent: $c"; return 0; fi
    [ -L "$c" ] && { TC_WHY="$c is a symbolic link"; return 1; }
    s=$(stat -c '%u %g %a %F' -- "$c") || { TC_WHY="cannot stat $c"; return 1; }
    read -r u g a t <<< "$s"
    [ -n "$ARM_UID" ] && [ "$u" = "$ARM_UID" ] && { TC_WHY="$c is owned by arm ($s)"; return 1; }
    (( 8#$a & 8#022 )) && { TC_WHY="$c is group- or other-writable ($s)"; return 1; }
    if have /usr/bin/getfacl; then
      acl=$(getfacl -cpn -- "$c" 2>/dev/null | grep -Ev '^(user|group|other)::|^mask::|^$' | tr '\n' ' ')
      [ -z "$acl" ] || { TC_WHY="$c carries ACL entries: $acl"; return 1; }
    fi
  done
  return 0
}
fp_list() { # file (read by the caller's identity): sorted SHA256 fingerprints, one per line
  ssh-keygen -lf "$1" 2>/dev/null | awk '{print $2}' | grep -E '^SHA256:[A-Za-z0-9+/]{43}$' | sort -u
}

printf '== afldb-owner-checks (R6 r8) %s host=%s as uid=%s\n' "$(date -u +%FT%TZ)" "$(hostname)" "$(id -u)"
printf '   script sha256 %s\n' "$(sha256sum < "$0" 2>/dev/null | cut -c1-64)"

# ------------------------------------------------------------------------------------------------ A: is this session independent?
if [ "$(id -u)" != 0 ]; then chk A1 FAIL "not root (uid $(id -u)): run in the admin root session or the console as root"
else chk A1 PASS "running as root"; fi
if [ -z "$ARM_UID" ]; then chk A0 UNKNOWN "no account arm on this host: the checks are written for production's arm"; fi
DESC=0; CHAIN=; p=$$; n=0
while [ -n "$p" ] && [ "$p" -gt 0 ] 2>/dev/null && [ $n -lt 64 ]; do
  st=/proc/$p/status; [ -r "$st" ] || break
  read -r _ ru eu su fu < <(grep '^Uid:' "$st")
  comm=$(tr -c 'A-Za-z0-9._()@:-' '?' < "/proc/$p/comm" | cut -c1-24); lu=$(cat "/proc/$p/loginuid" 2>/dev/null || echo ?)
  sudo_u=$(tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | sed -n 's/^SUDO_USER=//p;s/^SUDO_UID=/uid:/p' | tr '\n' ',' | tr -c 'A-Za-z0-9_:,-' '?')
  for x in "$ru" "$eu" "$su" "$fu" "$lu"; do [ -n "$ARM_UID" ] && [ "$x" = "$ARM_UID" ] && DESC=1; done
  case ",$sudo_u" in *,arm,*|*,uid:"$ARM_UID",*) [ -n "$ARM_UID" ] && DESC=1;; esac
  CHAIN="$CHAIN $p:$comm:uid=$ru/$eu:loginuid=$lu${sudo_u:+:sudo=${sudo_u%,}}"
  p=$(awk '/^PPid:/ {print $2}' "$st"); n=$((n + 1))
done
SELF_LU=$(cat /proc/self/loginuid 2>/dev/null || echo ?)
if [ "$DESC" = 1 ]; then
  chk A2 FAIL "this root session descends from arm (an ancestor has arm's real/effective/saved uid, arm's loginuid or SUDO_USER=arm): every result below is NOT independent;$CHAIN"
else chk A2 PASS "no ancestor of this session has arm's uid, loginuid or SUDO_USER (loginuid $SELF_LU; 4294967295 = unset);$CHAIN"; fi
[ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER:-}" = arm ] && chk A3 FAIL "SUDO_USER=arm in this environment" || chk A3 PASS "SUDO_USER in this environment: ${SUDO_USER:-unset}"

# ------------------------------------------------------------------------------------------------ B: arm's sudo
if have /usr/bin/sudo; then
  o=$(sudo -n -l -U arm 2>&1 < /dev/null)
  if grep -q 'is not allowed to run sudo' <<< "$o"; then chk B1 PASS "sudo -l -U arm: arm is not allowed to run sudo"
  elif grep -q 'may run the following commands' <<< "$o"; then
    chk B1 FAIL "sudo -l -U arm: arm may run: $(sed -n '/may run the following commands/,$p' <<< "$o" | sed 1d | sed 's/^ *//' | tr '\n' ';')"
  else chk B1 UNKNOWN "sudo -l -U arm gave an unrecognised answer: $(head -3 <<< "$o" | tr '\n' ';')"; fi
  tt=$(sudo -V 2>/dev/null | grep -i 'timestamp record' | sed 's/.*: *//' | head -1)
  chk B4 PASS "report: sudo authentication timestamp type: ${tt:-not printed by sudo -V}; timeout: $(sudo -V 2>/dev/null | grep -i 'timestamp timeout' | sed 's/.*: *//' | head -1)"
else chk B1 PASS "sudo is not installed"; fi
ag=$(id -Gn arm 2>/dev/null)
bad=; for g in sudo admin wheel; do [[ " $ag " == *" $g "* ]] && bad="$bad $g"; done
[ -z "$bad" ] && chk B2 PASS "arm's groups ($ag) include none of sudo, admin, wheel" || chk B2 FAIL "arm is in:$bad (arm's groups: $ag)"
files=(); [ -e /etc/sudoers ] && files+=(/etc/sudoers); for f in /etc/sudoers.d/*; do [ -f "$f" ] && files+=("$f"); done
hit=; inc=
for f in "${files[@]}"; do
  grep -Ev '^[[:space:]]*#([^i]|$)|^[[:space:]]*$' "$f" 2>/dev/null | grep -qE '(^|[^A-Za-z0-9_.-])%?arm([^A-Za-z0-9_.-]|$)' && hit="$hit $f"
  inc="$inc$(grep -E '^[[:space:]]*[#@]include(dir)?[[:space:]]' "$f" 2>/dev/null | awk '{print $2}' | tr '\n' ' ')"
done
[ -z "$hit" ] && chk B3 PASS "no sudoers file names arm or %arm (${#files[@]} file(s) read); include directives: ${inc:-none}" || chk B3 FAIL "sudoers rules naming arm or %arm in:$hit"
for t in $inc; do
  trust_comp "$t" && [ "$TC_ABSENT" = 0 ] && continue
  [ "$TC_ABSENT" = 1 ] && continue
  chk B5 FAIL "sudoers include target $t: $TC_WHY"
done
for u in root arm ${ADMIN:+"$ADMIN"}; do
  s=$(passwd -S "$u" 2>/dev/null | awk '{print $2}')
  case $s in NP) chk B6 FAIL "$u has NO password (passwd -S: NP)";; L|P) chk B6 PASS "report: passwd -S $u: $s (L locked, P usable)";; *) chk B6 UNKNOWN "passwd -S $u: '${s:-none}'";; esac
done

# ------------------------------------------------------------------------------------------------ C: other arm -> root routes
bad=; info=
for g in docker lxd incus-admin incus libvirt disk shadow; do [[ " $ag " == *" $g "* ]] && bad="$bad $g"; done
for g in adm systemd-journal; do [[ " $ag " == *" $g "* ]] && info="$info $g"; done
[ -z "$bad" ] && chk C1 PASS "arm is in none of docker, lxd, incus-admin, incus, libvirt, disk, shadow; read-only log groups:${info:- none}" \
  || chk C1 FAIL "arm is in root-equivalent or secret-reading group(s):$bad (log groups:${info:- none})"
for s in /run/docker.sock /var/run/docker.sock /var/snap/lxd/common/lxd/unix.socket; do
  [ -S "$s" ] && chk C1s PASS "report: $s present: $(stat -c '%U:%G %a' -- "$s")"
done
KNOWN_RULE=3164e0d9d8f37603effcd5ef91ce2f5ba17fc340370f525251d21991b6c50b64   # deploy/afldb-settle-afltables-trigger.rules (start one unit)
pk=0
for d in /etc/polkit-1/rules.d /usr/share/polkit-1/rules.d; do
  for f in "$d"/*.rules; do
    [ -f "$f" ] || continue; pk=$((pk + 1))
    if grep -qE "[\"']arm[\"']|unix-(user|group):arm" "$f"; then
      [ "$(sha256sum < "$f" | cut -c1-64)" = "$KNOWN_RULE" ] && chk C2 PASS "polkit $f is the known settle-trigger rule (start afldb-settle-afltables.service only)" \
        || chk C2 FAIL "polkit $f grants something to arm and is not the known settle-trigger rule"
    fi
  done
done
pkla=$(grep -rlE '(unix-user|unix-group):arm' /etc/polkit-1/localauthority /var/lib/polkit-1/localauthority 2>/dev/null | tr '\n' ' ')
[ -z "$pkla" ] && chk C2b PASS "no polkit .pkla grants to arm; $pk .rules file(s) read" || chk C2b FAIL "polkit .pkla files name arm: $pkla"
# root-run units that execute, source or read an arm path
ufail=; uconsidered=0
for f in /etc/systemd/system/*.service /etc/systemd/system/*.service.d/*.conf /usr/lib/systemd/system/*.service /lib/systemd/system/*.service \
         /etc/systemd/system/*.socket /etc/systemd/system/*.timer; do
  [ -f "$f" ] && grep -q '/home/' "$f" || continue
  uconsidered=$((uconsidered + 1))
  case $f in *.service.d/*.conf) u=${f%/*}; u=${u##*/}; u=${u%.d};; *) u=${f##*/};; esac
  case $u in
    *@.service)   # a template: judge the text of the unit and its drop-ins
      txt=$(cat "/etc/systemd/system/$u" "/usr/lib/systemd/system/$u" /etc/systemd/system/"$u".d/*.conf 2>/dev/null)
      usr=$(grep -E '^[[:space:]]*User=' <<< "$txt" | tail -1 | sed 's/.*=//')
      if [ "$usr" != arm ]; then grep -qE '^[[:space:]]*(Exec[A-Za-z]*|EnvironmentFile)=.*/home/' <<< "$txt" && ufail="$ufail $u(User=${usr:-root})"
      else grep -qE '^[[:space:]]*Exec[A-Za-z]*=[-@:]*[+!].*/home/' <<< "$txt" && ufail="$ufail $u(privileged-exec)"; fi;;
    *.service)
      usr=$(systemctl show "$u" -p User --value 2>/dev/null)
      for prop in ExecConditionEx ExecStartPreEx ExecStartEx ExecStartPostEx ExecReloadEx ExecStopEx ExecStopPostEx; do
        v=$(systemctl show "$u" -p "$prop" --value 2>/dev/null)
        while IFS= read -r e; do
          [ -n "$e" ] || continue; [[ $e == *"/home/"* ]] || continue
          if [ -z "$usr" ] || [ "$usr" = root ] || [ "$usr" = 0 ] || [[ $e == *privileged* ]] || [[ $e == *no-setuid* ]]; then ufail="$ufail $u:$prop"; fi
        done <<< "$(sed 's/ } { /}\n{/g' <<< "$v")"
      done
      if [ -z "$usr" ] || [ "$usr" = root ]; then
        ef=$(systemctl show "$u" -p EnvironmentFiles --value 2>/dev/null); [[ $ef == *"/home/"* ]] && ufail="$ufail $u:EnvironmentFile"
      fi;;
  esac
done
[ -z "$ufail" ] && chk C3 PASS "no root-run unit command or EnvironmentFile under /home ($uconsidered unit file(s) mention /home; each runs as arm)" \
  || chk C3 FAIL "root runs arm paths in:$ufail"
cfail=
for f in /etc/crontab /etc/cron.d/* /etc/anacrontab; do
  [ -f "$f" ] || continue
  while read -r l; do
    case $l in ''|'#'*) continue;; esac
    [[ $l == *"/home/"* ]] || continue
    usr=$(awk '{ if ($1 ~ /^@/) print $2; else print $6 }' <<< "$l"); [ "$f" = /etc/anacrontab ] && usr=root
    [ "$usr" = arm ] || cfail="$cfail $f"
  done < "$f"
done
for f in /etc/cron.hourly/* /etc/cron.daily/* /etc/cron.weekly/* /etc/cron.monthly/* /var/spool/cron/crontabs/root; do
  [ -f "$f" ] && grep -v '^[[:space:]]*#' "$f" | grep -q '/home/' && cfail="$cfail $f"
done
[ -z "$cfail" ] && chk C4 PASS "no root cron entry runs a /home path" || chk C4 FAIL "root cron entries with /home paths:$cfail"
rfail=
trust_comp /root || rfail="$rfail $TC_WHY;"
for f in .bashrc .profile .bash_profile .bash_login .bash_logout .bash_aliases .inputrc .ssh .ssh/rc .ssh/environment .ssh/authorized_keys .ssh/authorized_keys2; do
  [ -e "/root/$f" ] || [ -L "/root/$f" ] || continue
  trust_comp "/root/$f" || { rfail="$rfail $TC_WHY;"; continue; }
  [ -f "/root/$f" ] && grep -v '^[[:space:]]*#' "/root/$f" 2>/dev/null | grep -q '/home/' && rfail="$rfail /root/$f mentions /home/;"
done
[ -z "$rfail" ] && chk C5 PASS "root's home and startup files are root-owned, not group/other-writable, carry no ACL and do not mention /home/" || chk C5 FAIL "root's startup files:$rfail"
rfp=; afp=
for f in /root/.ssh/authorized_keys /root/.ssh/authorized_keys2; do [ -f "$f" ] && rfp="$rfp$(fp_list "$f")"$'\n'; done
rfp=$(grep . <<< "$rfp" | sort -u)
# arm's keys are read AS ARM (arm's own rights), so arm cannot point root at a file arm may not read
afp=$(as_arm /usr/bin/bash --noprofile --norc -c 'for f in "$HOME/.ssh/authorized_keys" "$HOME/.ssh/authorized_keys2" "$HOME"/.ssh/*.pub; do [ -f "$f" ] && ssh-keygen -lf "$f" 2>/dev/null; done' 2>/dev/null \
  | awk '{print $2}' | grep -E '^SHA256:[A-Za-z0-9+/]{43}$' | sort -u)
both=$(comm -12 <(printf '%s\n' "$rfp") <(printf '%s\n' "$afp") | grep .)
[ -z "$both" ] && chk C6 PASS "root's authorized keys: $(grep -c . <<< "$rfp") ($(tr '\n' ' ' <<< "$rfp")); none is one of arm's $(grep -c . <<< "$afp") key fingerprint(s)" \
  || chk C6 FAIL "a key authorised for root is also arm's: $(tr '\n' ' ' <<< "$both")"
ps=$(cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null) && chk C7 PASS "report: kernel.yama.ptrace_scope=$ps (0: arm may ptrace any of its own processes; never run an owner command in an arm session)" \
  || chk C7 UNKNOWN "kernel.yama.ptrace_scope unreadable"
if have /usr/sbin/sshd; then
  T=$(sshd -T -C user=root,host=check.invalid,addr=127.0.0.1 2>/dev/null)
  first=$(grep -nEv '^[[:space:]]*(#|$)' /etc/ssh/sshd_config 2>/dev/null | head -1 | tr -s ' ' | cut -c1-80)
  chk C8 PASS "report: sshd for root: $(grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|permituserrc|permituserenvironment) ' <<< "$T" | tr '\n' ';'); sshd_config first directive: line ${first:-none}"
else chk C8 UNKNOWN "no /usr/sbin/sshd"; fi
[ -e /etc/ld.so.preload ] && chk C9 FAIL "/etc/ld.so.preload exists (review it; every root process loads it)" || chk C9 PASS "/etc/ld.so.preload absent"

# ------------------------------------------------------------------------------------------------ D: PostgreSQL (peer, as postgres)
pgq() { (cd / && runuser -u postgres -- env -i PATH=/usr/bin:/usr/sbin LC_ALL=C psql -X -q -At -F '|' -v ON_ERROR_STOP=1 -d "${2:-postgres}" -c "$1") < /dev/null 2>&1; }
if ! have /usr/bin/psql || ! id postgres > /dev/null 2>&1 || [ "$(pgq 'SELECT 1')" != 1 ]; then
  chk D0 UNKNOWN "PostgreSQL is not reachable as OS user postgres by peer: D1-D5 cannot be established"
  PGOK=0
else chk D0 PASS "PostgreSQL reachable as postgres by peer: $(pgq 'SHOW server_version')"; PGOK=1; fi
if [ "$PGOK" = 1 ]; then
  rows=$(pgq "SELECT rolname, rolsuper, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolcanlogin ORDER BY 1")
  sup=$(awk -F'|' '$2 == "t" && $1 != "postgres" {printf "%s ", $1}' <<< "$rows")
  flags=$(awk -F'|' '$2 == "t" || $3 == "t" || $4 == "t" || $5 == "t" {printf "%s(super=%s createrole=%s replication=%s bypassrls=%s) ", $1, $2, $3, $4, $5}' <<< "$rows")
  [ -z "$sup" ] && chk D1 PASS "login roles: $(cut -d'|' -f1 <<< "$rows" | tr '\n' ' '); with any of super/createrole/replication/bypassrls: ${flags:-none}" \
    || chk D1 FAIL "login role(s) other than postgres are SUPERUSER: $sup(all flagged: $flags)"
  mem=$(pgq "SELECT r.rolname || ':' || g.rolname FROM pg_roles r, pg_roles g WHERE r.rolcanlogin AND r.rolname <> 'postgres' AND NOT r.rolsuper
             AND g.rolname IN ('pg_execute_server_program','pg_write_server_files','pg_read_server_files') AND pg_has_role(r.oid, g.oid, 'MEMBER') ORDER BY 1")
  wm=$(grep -E ':(pg_execute_server_program|pg_write_server_files)$' <<< "$mem" | tr '\n' ' ')
  [ -z "$wm" ] && chk D2 PASS "no login role is a member of pg_execute_server_program or pg_write_server_files; pg_read_server_files members: $(grep ':pg_read_server_files$' <<< "$mem" | cut -d: -f1 | tr '\n' ' ')" \
    || chk D2 FAIL "login roles that can act as OS user postgres (server programs/files): $wm"
  own=$(pgq "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'afldb_prod'")
  [ -n "$own" ] && chk D3 PASS "report: owner of database afldb_prod: $own" || chk D3 UNKNOWN "database afldb_prod not found"
fi
# arm's DSN role names: the file is read AS ARM; values stay in this shell; only variable names and role names are printed
envtxt=$(as_arm /usr/bin/bash --noprofile --norc -c 'f=$1; [ -f "$f" ] && [ ! -L "$f" ] && head -c 262144 -- "$f"' _ "$ARM_ENV" 2>/dev/null)
if [ -z "$envtxt" ]; then chk D4 UNKNOWN "arm's environment file $ARM_ENV is absent, a link, or unreadable by arm: arm's DSN role is not established"
else
  roles=(); facts=
  while IFS= read -r l; do
    [[ $l =~ ^[[:space:]]*(export[[:space:]]+)?([A-Z0-9_]*(DATABASE_URL|_DSN)[A-Z0-9_]*)=(.*)$ ]] || continue
    var=${BASH_REMATCH[2]}; v=${BASH_REMATCH[4]}; v=${v#[\"\']}; v=${v%[\"\']}
    [[ $var == *TEST* ]] && continue
    r=
    if [[ $v =~ ^postgres(ql)?://([^@/?#]*)@ ]]; then r=${BASH_REMATCH[2]%%:*}
    elif [[ $v =~ [?\&]user=([^\&#]*) ]]; then r=${BASH_REMATCH[1]}
    elif [[ $v =~ ^postgres(ql)?:// ]]; then r=arm   # libpq default: the OS user
    fi
    if [[ $r =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then roles+=("$r"); facts="$facts $var=>$r"; else facts="$facts $var=>UNPARSED"; fi
  done <<< "$envtxt"
  unset envtxt
  if [ ${#roles[@]} = 0 ]; then chk D4 UNKNOWN "no parsable DSN role in arm's $ARM_ENV (variables:${facts:- none}): arm's role is not established"
  elif [ "$PGOK" != 1 ]; then chk D4 UNKNOWN "arm's DSN roles:$facts; PostgreSQL not reachable to judge them"
  else
    rb=
    for r in $(printf '%s\n' "${roles[@]}" | sort -u); do
      a=$(pgq "SELECT rolsuper::text || '|' || pg_has_role(oid, 'pg_execute_server_program', 'MEMBER')::text || '|' || pg_has_role(oid, 'pg_write_server_files', 'MEMBER')::text || '|' || rolcreaterole::text FROM pg_roles WHERE rolname = '$r'")
      case $a in
        '') facts="$facts [$r: no such role]";;
        'false|false|false|'*) facts="$facts [$r: not superuser, no server program/file role, createrole=${a##*|}]";;
        *) rb="$rb $r($a)";;
      esac
    done
    [ -z "$rb" ] && chk D4 PASS "arm's DSN roles (names only):$facts" || chk D4 FAIL "arm's DSN role can act as OS user postgres (super|execute|write|createrole):$rb; all:$facts"
  fi
fi
hfail=; hinc=; ifail=
for h in /etc/postgresql/*/main/pg_hba.conf; do
  [ -f "$h" ] || continue
  grep -Ev '^[[:space:]]*(#|$)' "$h" | awk '{ for (i = 1; i <= NF; i++) if ($i == "trust") { print; break } }' | grep -q . && hfail="$hfail $h(trust)"
  grep -Eq '^[[:space:]]*include(_if_exists|_dir)?[[:space:]]' "$h" && hinc="$hinc $h"
  g=${h%pg_hba.conf}pg_ident.conf
  [ -f "$g" ] && grep -Ev '^[[:space:]]*(#|$)' "$g" | awk '($2 == "arm" || $2 ~ /^\//) && ($3 == "postgres" || $3 == "all" || $3 ~ /afldb_backup|afldb_verify/) { print }' | grep -q . && ifail="$ifail $g"
done
[ -z "$hfail$ifail" ] && [ -z "$hinc" ] && chk D5 PASS "pg_hba has no trust line and pg_ident maps neither arm nor a regex to postgres, all, afldb_backup or afldb_verify" \
  || { [ -n "$hfail$ifail" ] && chk D5 FAIL "peer/trust routes:$hfail$ifail" || chk D5 UNKNOWN "pg_hba include directives not evaluated:$hinc"; }

# ------------------------------------------------------------------------------------------------ E: can arm modify protected components?
PROT=(/usr/local/lib/afldb-backup /usr/local/lib/afldb-backup/tools/maintenance /usr/local/lib/afldb-verify
      /var/lib/afldb-backup /var/lib/afldb-backup/staging /var/lib/afldb-backup/seals /var/lib/afldb-backup/published /var/lib/afldb-backup/state
      /etc/systemd/system /etc/systemd/system/afldb-backup.service.d /etc/systemd/system/afldb-backup.service /etc/systemd/system/afldb-backup.timer
      /etc/ssh /etc/ssh/sshd_config /etc/ssh/sshd_config.d /etc/ssh/afldb-verify /etc/ssh/afldb-verify/authorized_keys /etc/afldb-verify
      /etc/postgresql/16/main/pg_hba.conf /etc/postgresql/16/main/pg_ident.conf /etc/sudoers /etc/sudoers.d /etc/polkit-1/rules.d
      /etc/passwd /etc/group /etc/shadow /etc/pam.d /etc/profile /etc/profile.d /etc/bash.bashrc /etc/environment /etc/cron.d /etc/crontab
      /root /usr/bin/bash /usr/bin/sudo /usr/sbin/sshd)
if [ -n "$ADMIN" ] && AH=$(getent passwd "$ADMIN" | cut -d: -f6) && [ -n "$AH" ]; then PROT+=("$AH" "$AH/.ssh" "$AH/.ssh/authorized_keys" "$AH/.bashrc" "$AH/.profile"); fi
for d in /usr/local/lib/afldb-backup /usr/local/lib/afldb-verify /etc/systemd/system/afldb-backup.service.d /etc/ssh/afldb-verify; do
  [ -d "$d" ] && while IFS= read -r f; do PROT+=("$f"); done < <(find "$d" -mindepth 1 2>/dev/null)
done
if have /usr/bin/sudo; then
  as_arm /usr/bin/bash --noprofile --norc -c 'sudo -n true' > /dev/null 2>&1 && chk E0 FAIL "arm runs 'sudo -n true' successfully: arm can become root without a password right now" \
    || chk E0 PASS "arm cannot run 'sudo -n true' (no passwordless sudo, no cached ticket reachable from a fresh arm process)"
fi
w=$(as_arm /usr/bin/bash --noprofile --norc -c 'for p in "$@"; do c=; r=${p#/}; while :; do c=$c/${r%%/*}; [ -e "$c" ] && [ -w "$c" ] && echo "$c"; [[ $r == */* ]] || break; r=${r#*/}; done; done' _ "${PROT[@]}" 2>/dev/null | sort -u)
idarm=$(as_arm /usr/bin/id 2>/dev/null)
[ -z "$w" ] && chk E1 PASS "as arm ($idarm; no startup file, no PAM session) nothing in the protected set or its parents is writable (access(2), ACLs included; ${#PROT[@]} paths)" \
  || chk E1 FAIL "arm can write: $(tr '\n' ' ' <<< "$w")"
efail=; absent=0
for p in "${PROT[@]}"; do
  if trust_comp "$p"; then [ "$TC_ABSENT" = 1 ] && absent=$((absent + 1)); else efail="$efail $TC_WHY;"; fi
done
[ -z "$efail" ] && chk E2 PASS "every component of the ${#PROT[@]} protected paths: not arm-owned, not group/other-writable, no ACL, no link ($absent absent, e.g. not installed yet)" \
  || chk E2 FAIL "protected paths:$efail"
exprs=(-user arm); for g in $ARM_GIDS; do exprs+=(-o \( -group "$g" -perm -g=w \)); done
exprs+=(-o \( -type f -perm -o=w \) -o \( -type d -perm -o=w ! -perm -1000 \))
found=$(find / \( -path /proc -o -path /sys -o -path /dev -o -path /run/user -o -path /home -o -path /tmp -o -path /var/tmp -o -path /snap -o -path /var/lib/lxcfs \) -prune -o \
  \( "${exprs[@]}" \) -print 2>/dev/null | grep -v '^/$' | sort)
exp=; unacc=; acc=()
if [ -n "$ACCEPT" ]; then
  trust_comp "$ACCEPT" && [ "$TC_ABSENT" = 0 ] && [ -f "$ACCEPT" ] && mapfile -t acc < <(grep -E '^/' "$ACCEPT") || chk E3a FAIL "--accept $ACCEPT is not a trusted root-owned file: $TC_WHY"
fi
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case $f in /var/spool/cron/crontabs/arm|/var/mail/arm|/var/spool/mail/arm) exp="$exp $f"; continue;; esac
  for a in "${acc[@]}"; do [ "$f" = "$a" ] && { exp="$exp $f(accepted)"; continue 2; }; done
  unacc="$unacc$f"$'\n'
done <<< "$found"
if [ -z "$unacc" ]; then chk E3 PASS "outside /home,/tmp,/var/tmp,/proc,/sys,/dev,/run/user: no arm-owned, arm-group-writable or world-writable path except:${exp:- none}"
else chk E3 UNKNOWN "$(grep -c . <<< "$unacc") arm-owned/arm-group-writable/world-writable path(s) outside /home the owner has not accepted (first 25): $(head -25 <<< "$unacc" | tr '\n' ' ')"; fi

# ------------------------------------------------------------------------------------------------ F: the independent admin path
if [ -z "$ADMIN" ]; then chk F1 FAIL "no --admin account named: there is no independent admin path to check"
elif ! E=$(getent passwd "$ADMIN"); then chk F1 FAIL "admin account $ADMIN does not exist: no independent admin path"
else
  IFS=: read -r _ _ auid agid _ ahome ashell <<< "$E"
  if [ "$auid" = 0 ] || [ "$auid" = "$ARM_UID" ]; then chk F1 FAIL "$ADMIN has uid $auid (root or arm's)"
  else chk F1 PASS "admin account: $(id "$ADMIN" 2>&1); home $ahome; shell $ashell"; fi
  [[ " $ARM_GIDS " == *" $agid "* ]] && chk F2 FAIL "arm is in $ADMIN's primary group ($agid)" || chk F2 PASS "arm is not in $ADMIN's primary group"
  o=$(sudo -n -l -U "$ADMIN" 2>&1 < /dev/null)
  if grep -q 'NOPASSWD' <<< "$o"; then chk F3 FAIL "$ADMIN has NOPASSWD sudo rules (the procedure requires its own password)"
  elif grep -qE '^[[:space:]]*\(ALL( : ALL)?\) ALL$' <<< "$o"; then chk F3 PASS "$ADMIN may run (ALL) ALL with its own password"
  else chk F3 FAIL "$ADMIN has no full sudo rule: $(sed -n '/may run/,$p' <<< "$o" | tr '\n' ';' | cut -c1-200)"; fi
  s=$(passwd -S "$ADMIN" 2>/dev/null | awk '{print $2}'); [ "$s" = P ] && chk F4 PASS "$ADMIN has a usable password (for sudo; it is typed only in the admin session)" || chk F4 FAIL "$ADMIN password status '$s' (need P)"
  T=$(sshd -T -C "user=$ADMIN,host=check.invalid,addr=127.0.0.1" 2>/dev/null)
  akf=$(sed -n 's/^authorizedkeysfile //p' <<< "$T"); fc=$(sed -n 's/^forcecommand //p' <<< "$T")
  [ "$fc" = none ] && fc=    # sshd -T prints "forcecommand none" when no forced command applies
  [ -n "$akf" ] || akf=.ssh/authorized_keys
  ff=; fails=; for k in $akf; do k=${k//%h/$ahome}; k=${k//%u/$ADMIN}; k=${k//%%/%}; case $k in /*) ;; *) k=$ahome/$k;; esac
    [ -e "$k" ] || continue
    trust_comp "$k" || { fails="$fails $TC_WHY;"; continue; }
    o=$(stat -c %U -- "$k"); [ "$o" = "$ADMIN" ] || [ "$o" = root ] || fails="$fails $k owned by $o;"
    ff="$ff$(fp_list "$k")"$'\n'; done
  for f in .bashrc .profile .bash_profile .bash_login .bash_logout .ssh/rc .ssh/environment; do
    [ -e "$ahome/$f" ] || [ -L "$ahome/$f" ] || continue
    trust_comp "$ahome/$f" || fails="$fails $TC_WHY;"
  done
  trust_comp "$ahome" || fails="$fails $TC_WHY;"
  ff=$(grep . <<< "$ff" | sort -u)
  both=$(comm -12 <(printf '%s\n' "$ff") <(printf '%s\n' "$afp") | grep .)
  if [ -n "$fails" ]; then chk F5 FAIL "$ADMIN's home, startup or key files:$fails"
  elif [ -z "$ff" ]; then chk F5 FAIL "$ADMIN has no authorised key ($akf): no independent SSH admin path"
  elif [ -n "$both" ]; then chk F5 FAIL "a key authorised for $ADMIN is also one of arm's: $(tr '\n' ' ' <<< "$both")"
  elif [ -n "$ADMIN_FP" ] && [ "$ff" != "$ADMIN_FP" ]; then chk F5 FAIL "$ADMIN authorises $(tr '\n' ' ' <<< "$ff"), not exactly the workstation fingerprint $ADMIN_FP"
  else chk F5 PASS "$ADMIN authorises $(grep -c . <<< "$ff") key(s) ($(tr '\n' ' ' <<< "$ff")${ADMIN_FP:+= the workstation fingerprint}); none is arm's; home and startup files trusted"; fi
  [ -z "$fc" ] && grep -qx 'pubkeyauthentication yes' <<< "$T" && chk F6 PASS "sshd for $ADMIN: pubkey authentication, no forced command; $(grep -E '^(passwordauthentication|permituserrc|allowusers|allowgroups|denyusers|denygroups) ' <<< "$T" | tr '\n' ';')" \
    || chk F6 FAIL "sshd for $ADMIN: forcecommand '${fc:-none}', $(grep '^pubkeyauthentication' <<< "$T")"
fi

# ------------------------------------------------------------------------------------------------ result
if [ ${#FAILS[@]} = 0 ] && [ ${#UNKS[@]} = 0 ]; then echo "OWNER CHECKS RESULT PASS"; exit 0; fi
note=; [[ " ${FAILS[*]} " == *" A2 "* || " ${FAILS[*]} " == *" A1 "* ]] && note=" (session not independent: no result above counts)"
echo "OWNER CHECKS RESULT BLOCKED fail=$(IFS=,; echo "${FAILS[*]:-none}") unknown=$(IFS=,; echo "${UNKS[*]:-none}")$note"
exit 1
