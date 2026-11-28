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
# r8 review fixes: every arm-side probe (C6 key listing, D4 environment file, E0, E1) is fail-closed (arm_probe: completion sentinel
# and exit 0, else FAIL "probe did not complete"); C2 prints a PASS line; C3 judges every path a root-run service executes or reads;
# C6 uses sshd's AuthorizedKeysFile for root; D1/D2/D4 use membership closure (pg_has_role MEMBER of any superuser role and of the
# three server program/file roles); F5 requires exactly one bare key line; F6 also rejects an AuthorizedKeysCommand.
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
# arm_probe BODY [ARGS...]: run BODY (bash) as arm through as_arm, FAIL-CLOSED (r8 review R8-F-1/-2). The probe's LAST action prints a
# sentinel carrying a per-call random nonce; PROBE_OK=1 only when the probe exited 0 AND its last line is exactly that sentinel, and
# PROBE_OUT is then the output before it. A probe killed, stopped or cut short by another arm process (same uid) leaves PROBE_OK=0,
# and every caller turns that into FAIL "probe did not complete"; no caller ever reads PASS from absent output. Residual: a hostile
# concurrent arm process can also write into the probe's stdout (/proc/<pid>/fd/1, same uid) and so could forge a completed probe;
# each probe therefore has a root-side companion (E1: E2; C6/F5: the root-side key and trust checks; D4: D1/D2; E0: B1/B2).
# r8 review R8-F-15: the probe runs under a root-owned /usr/bin/timeout (outside setpriv, so arm cannot kill or stop the timer): a
# probe that arm stops (SIGSTOP) or that hangs is killed after 60 s (SIGKILL 5 s later), exits non-zero, leaves PROBE_OK=0, and the
# caller reports FAIL "probe did not complete". A missing timeout binary also leaves PROBE_OK=0 (fail-closed).
PROBE_OK=0; PROBE_OUT=
arm_probe() {
  local body=$1 nonce o rc last; shift
  nonce=$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n'); PROBE_OK=0; PROBE_OUT=
  o=$(/usr/bin/timeout --kill-after=5 60 setpriv --reuid=arm --regid=arm --init-groups --reset-env \
        /usr/bin/env "R8_PROBE_NONCE=$nonce" /usr/bin/bash --noprofile --norc -c "$body"'
printf "\nR8-PROBE-DONE %s\n" "$R8_PROBE_NONCE"' _ "$@" < /dev/null 2>/dev/null); rc=$?
  last=$(tail -n 1 <<< "$o")
  if [ "$rc" = 0 ] && [ "$last" = "R8-PROBE-DONE $nonce" ]; then PROBE_OK=1; PROBE_OUT=$(sed '$d' <<< "$o"); fi
  PROBE_RC=$rc
}
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
if [ -z "$ARM_UID" ]; then chk A0 UNKNOWN "no account arm on this host: the checks are written for production's arm"
else chk A0 PASS "account arm exists (uid $ARM_UID)"; fi
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
# names: arm itself, and %<g> for every group arm is in (B2 judges sudo/admin/wheel membership; B3 judges what the rules name)
nre=arm; for g in $ag; do [[ $g =~ ^[A-Za-z0-9_.-]+$ ]] && nre="$nre|%${g//./\\.}"; done
for f in "${files[@]}"; do
  grep -Ev '^[[:space:]]*#([^i]|$)|^[[:space:]]*$' "$f" 2>/dev/null | grep -qE "(^|[^A-Za-z0-9_.%-])($nre)([^A-Za-z0-9_.-]|\$)" && hit="$hit $f"
  inc="$inc$(grep -E '^[[:space:]]*[#@]include(dir)?[[:space:]]' "$f" 2>/dev/null | awk '{print $2}' | tr '\n' ' ')"
done
[ -z "$hit" ] && chk B3 PASS "no non-comment line of /etc/sudoers or /etc/sudoers.d/* names arm or a group of arm (%$(tr ' ' ',' <<< "$ag")); ${#files[@]} file(s) read; include directives: ${inc:-none}" \
  || chk B3 FAIL "sudoers lines naming arm or a group of arm (%$(tr ' ' ',' <<< "$ag")) in:$hit"
b5=
for t in $inc; do
  trust_comp "$t" && continue
  b5="$b5 $t: $TC_WHY;"
done
[ -z "$b5" ] && chk B5 PASS "sudoers include targets trusted (root-owned, not group/other-writable, no ACL, no link): ${inc:-none}" || chk B5 FAIL "sudoers include targets:$b5"
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
pk=0; pka=0
for d in /etc/polkit-1/rules.d /usr/share/polkit-1/rules.d; do
  for f in "$d"/*.rules; do
    [ -f "$f" ] || continue; pk=$((pk + 1))
    if grep -qE "[\"']arm[\"']|unix-(user|group):arm" "$f"; then pka=$((pka + 1))
      [ "$(sha256sum < "$f" | cut -c1-64)" = "$KNOWN_RULE" ] && chk C2 PASS "polkit $f is the known settle-trigger rule (start afldb-settle-afltables.service only)" \
        || chk C2 FAIL "polkit $f grants something to arm and is not the known settle-trigger rule"
    fi
  done
done
[ "$pka" = 0 ] && chk C2 PASS "no polkit .rules file mentions arm ($pk file(s) read in /etc/polkit-1/rules.d and /usr/share/polkit-1/rules.d)"
pkla=$(grep -rlE '(unix-user|unix-group):arm' /etc/polkit-1/localauthority /var/lib/polkit-1/localauthority 2>/dev/null | tr '\n' ' ')
[ -z "$pkla" ] && chk C2b PASS "no polkit .pkla grants to arm; $pk .rules file(s) read" || chk C2b FAIL "polkit .pkla files name arm: $pkla"
# root-run units (r8 review R8-F-9, R8-F-14): EVERY path a root-run service executes, every absolute-path argument that is a file,
# every EnvironmentFile and the Environment are judged, not only paths containing /home/. Root-run = User unset/root, or any command
# with the + / ! / !! prefix (privileged, no-setuid, ambient). C3 asks "can arm modify it?" (arm_mod): the path is walked from /,
# and every symbolic link on the way is followed and its target walked too (so the directories holding each link are judged); a
# bare command name is resolved through systemd's fixed search path, judging every candidate up to the first that exists. A
# component FAILs only when arm can write it: owned by arm; group-writable by a group arm is in; world-writable (a directory with the
# sticky bit excepted); an ACL entry granting write to arm or one of arm's groups (getfacl); a link owned by arm; or the component
# is absent below a directory arm can write. Other group-writable or ACL-bearing components, sticky world-writable directories and
# links owned by another non-root user are REPORTED as path(owner:group:mode), not failed. A component that cannot be evaluated is
# UNKNOWN, never PASS. User=arm units run as arm, so they are not a root route: they are reported. Timer, socket and path units
# activate a service, and that service is judged here.
am_one() { # COMPONENT (no link in its prefix): 0 ok, 1 arm can write (TC_WHY), 3 not evaluable; AM_PW=1 when arm can write in it
  local c=$1 s u g a t at acl e id perm
  AM_PW=0
  if [ ! -e "$c" ]; then
    [ "$AM_PARENT_W" = 1 ] && { TC_WHY="$c is absent below a directory arm can write"; return 1; }
    AM_ABSENT=1; return 0
  fi
  s=$(stat -c '%u %g %a %F %U:%G' -- "$c" 2>/dev/null) || { TC_WHY="cannot stat $c"; return 3; }
  read -r u g a t _ <<< "$s"
  [ -n "$u" ] && [ -n "$g" ] && [[ $a =~ ^[0-7]+$ ]] || { TC_WHY="cannot read owner/mode of $c"; return 3; }
  [ -n "$ARM_UID" ] && [ "$u" = "$ARM_UID" ] && { TC_WHY="$c is owned by arm (${s##* }:$a)"; return 1; }
  if (( 8#$a & 8#002 )); then
    if [ "$t" = directory ] && (( 8#$a & 8#1000 )); then TC_REP="$TC_REP $c(${s##* }:$a)"; AM_PW=1
    else TC_WHY="$c is world-writable (${s##* }:$a)"; return 1; fi
  fi
  if (( 8#$a & 8#020 )); then
    [[ $ARM_GIDS == *" $g "* ]] && { TC_WHY="$c is group-writable by a group arm is in (${s##* }:$a)"; return 1; }
    TC_REP="$TC_REP $c(${s##* }:$a)"
  fi
  if have /usr/bin/getfacl; then
    acl=$(getfacl -cpn -- "$c" 2>/dev/null) || { TC_WHY="getfacl failed on $c"; return 3; }
    while IFS= read -r e; do
      case $e in user::*|group::*|other::*|mask::*|'') continue;; esac
      IFS=: read -r at id perm <<< "${e%%#*}"
      perm=${perm//[[:space:]]/}
      if [[ $perm == *w* ]] && { { [ "$at" = user ] && [ -n "$ARM_UID" ] && [ "$id" = "$ARM_UID" ]; } || { [ "$at" = group ] && [[ $ARM_GIDS == *" $id "* ]]; }; }; then
        TC_WHY="$c carries an ACL entry granting write to arm or arm's group ($at:$id:$perm)"; return 1
      fi
      TC_REP="$TC_REP $c(${s##* }:$a:acl-$at:$id:$perm)"
    done <<< "$acl"
  fi
  return 0
}
am_walk() { # PATH DEPTH: walk PATH from /, following and walking every link
  local p=$1 d=$2 cur= rest comp tg u r
  [ "$d" -gt 40 ] && { TC_WHY="too many symbolic links resolving $p"; return 3; }
  [[ $p == /* ]] || { TC_WHY="relative path $p"; return 3; }
  AM_PARENT_W=0; am_one / || return; AM_PARENT_W=$AM_PW
  rest=${p#/}
  while [ -n "$rest" ]; do comp=${rest%%/*}; [[ $rest == */* ]] && rest=${rest#*/} || rest=
    case $comp in ''|.) continue;; esac
    cur=$cur/$comp
    if [ -L "$cur" ]; then
      u=$(stat -c %u -- "$cur" 2>/dev/null) || { TC_WHY="cannot stat link $cur"; return 3; }
      [ -n "$ARM_UID" ] && [ "$u" = "$ARM_UID" ] && { TC_WHY="$cur is a symbolic link owned by arm"; return 1; }
      [ "$u" = 0 ] || TC_REP="$TC_REP $cur(link:uid$u)"
      tg=$(readlink -- "$cur" 2>/dev/null) || { TC_WHY="cannot read link $cur"; return 3; }
      [[ $tg == /* ]] || tg=${cur%/*}/$tg
      am_walk "$tg" $((d + 1)); r=$?; [ "$r" = 0 ] || return $r
      cur=$(realpath -m -- "$cur" 2>/dev/null) || { TC_WHY="cannot resolve $cur"; return 3; }
      [ "$cur" = / ] && cur=
      [ "$AM_ABSENT" = 1 ] && return 0
      continue
    fi
    am_one "$cur" || return; AM_PARENT_W=$AM_PW
    [ "$AM_ABSENT" = 1 ] && return 0
  done
  return 0
}
arm_mod() { # PATH: 0 = arm cannot modify it; 1 = arm can (TC_WHY); 3 = cannot evaluate (TC_WHY); TC_REP collects reported facts
  TC_WHY=; TC_REP=; AM_ABSENT=0; AM_PARENT_W=0
  am_walk "$1" 0
}
ufail=; uunk=; urep=; uarm=; nroot=0; npath=0
judge_path() { # unit what path
  local rc d
  npath=$((npath + 1))
  if [[ $3 != /* ]] && [[ $3 != */* ]] && [ -n "$3" ]; then
    # a bare command name: systemd resolves it through its fixed search path, so every candidate up to and including the first
    # that exists is judged (an absent slot in a directory arm can write would let arm plant an earlier match)
    for d in /usr/local/sbin /usr/local/bin /usr/sbin /usr/bin /sbin /bin; do
      arm_mod "$d/$3"; rc=$?
      case $rc in 0) urep="$urep $TC_REP";; 1) ufail="$ufail $1:$2:$TC_WHY;"; return;; *) uunk="$uunk $1:$2:$TC_WHY;"; return;; esac
      [ -e "$d/$3" ] && return
    done
    urep="$urep $3(not-found-in-search-path)"; return # every slot judged absent and not plantable by arm
  fi
  arm_mod "$3"; rc=$?
  case $rc in 0) urep="$urep $TC_REP";; 1) ufail="$ufail $1:$2:$TC_WHY;";; *) uunk="$uunk $1:$2:$TC_WHY;";; esac
}
units=$({ systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null | awk '{print $1}'
          systemctl list-units --type=service --all --no-legend --no-pager --plain 2>/dev/null | awk '{print $1}'; } | grep -E '^[A-Za-z0-9@_.:-]+\.service$' | sort -u)
for u in $units; do
  case $u in
    *@.service)   # a template: judge its text and drop-ins (instances that are loaded are judged below through systemctl show)
      txt=$(cat "/etc/systemd/system/$u" "/usr/lib/systemd/system/$u" "/lib/systemd/system/$u" /etc/systemd/system/"$u".d/*.conf /usr/lib/systemd/system/"$u".d/*.conf 2>/dev/null)
      usr=$(grep -E '^[[:space:]]*User=' <<< "$txt" | tail -1 | sed 's/.*=//')
      while IFS= read -r l; do
        cmd=${l#*=}; pre=$(sed -E 's/^([-@:+!]*).*/\1/' <<< "$cmd"); cmd=${cmd#"$pre"}; p=${cmd%% *}
        if [ -z "$usr" ] || [ "$usr" = root ] || [[ $pre == *[+!]* ]]; then
          [ "$usr" = arm ] && [[ $pre == *[+!]* ]] && ufail="$ufail $u(privileged-exec as arm);"
          case $p in /*) judge_path "$u" exec "$p";; esac
        fi
      done < <(grep -E '^[[:space:]]*Exec[A-Za-z]*=' <<< "$txt")
      [ "$usr" = arm ] && uarm="$uarm $u";;
    *)
      info=$(systemctl show "$u" -p LoadState -p User -p ExecConditionEx -p ExecStartPreEx -p ExecStartEx -p ExecStartPostEx -p ExecReloadEx \
               -p ExecStopEx -p ExecStopPostEx -p EnvironmentFiles -p Environment 2>/dev/null)
      [ "$(sed -n 's/^LoadState=//p' <<< "$info")" = loaded ] || continue
      usr=$(sed -n 's/^User=//p' <<< "$info"); rootunit=0
      { [ -z "$usr" ] || [ "$usr" = root ] || [ "$usr" = 0 ]; } && rootunit=1
      [ "$usr" = arm ] && uarm="$uarm $u"
      while IFS= read -r e; do
        [ -n "$e" ] || continue
        priv=0; [[ $e == *flags=*privileged* || $e == *flags=*no-setuid* || $e == *flags=*ambient* ]] && priv=1
        [ "$rootunit" = 1 ] || [ "$priv" = 1 ] || continue
        [ "$usr" = arm ] && [ "$priv" = 1 ] && ufail="$ufail $u(privileged-exec as arm);"
        p=$(grep -o 'path=[^ ;]*' <<< "$e" | head -1); p=${p#path=}
        [ -n "$p" ] && judge_path "$u" exec "$p"
        av=$(sed -n 's/.*argv\[\]=\([^;]*\).*/\1/p' <<< "$e")
        set -f; for a in $av; do case $a in /*) [ -f "$a" ] && [ "$a" != "$p" ] && judge_path "$u" arg "$a"; [[ $a == /home/* ]] && [ ! -e "$a" ] && ufail="$ufail $u:arg:$a;";; esac; done; set +f
      done < <(sed -n 's/^Exec[A-Za-z]*Ex=//p' <<< "$info" | sed 's/ } { /}\n{/g')
      if [ "$rootunit" = 1 ]; then
        nroot=$((nroot + 1))
        set -f; for ef in $(sed -n 's/^EnvironmentFiles=//p' <<< "$info" | grep -o '^[^ ]*\|  */[^ ]*' | tr -d ' '); do
          case $ef in /*) judge_path "$u" EnvironmentFile "$ef";; esac
        done; set +f
        sed -n 's/^Environment=//p' <<< "$info" | grep -q '/home/' && ufail="$ufail $u:Environment mentions /home/;"
      fi;;
  esac
done
urep=$(tr ' ' '\n' <<< "$urep" | sed '/^$/d' | sort -u | tr '\n' ' '); urep=${urep% }
have /usr/bin/getfacl && c3acl="ACLs read with getfacl" || c3acl="getfacl absent, so ACLs not read (mode bits judged only)"
if [ -n "$ufail" ]; then chk C3 FAIL "root-run units execute, source or read a path arm can modify:$ufail${uunk:+ also not evaluable:$uunk}"
elif [ -n "$uunk" ]; then chk C3 UNKNOWN "root-run unit path(s) that could not be evaluated:$uunk"
else chk C3 PASS "$nroot root-run service unit(s), $npath executed/argument/EnvironmentFile path(s): no component arm can modify ($c3acl); reported, not arm-writable:${urep:- none}; User=arm units (run as arm, reported):${uarm:- none}"
fi
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
# akf_paths USER HOME: the AuthorizedKeysFile paths sshd uses for USER (sshd -T; default .ssh/authorized_keys .ssh/authorized_keys2)
akf_paths() {
  local a k; a=$(sshd -T -C "user=$1,host=check.invalid,addr=127.0.0.1" 2>/dev/null | sed -n 's/^authorizedkeysfile //p')
  [ -n "$a" ] || a=".ssh/authorized_keys .ssh/authorized_keys2"
  set -f; for k in $a; do k=${k//%h/$2}; k=${k//%u/$1}; k=${k//%%/%}; case $k in /*) ;; *) k=$2/$k;; esac; printf '%s\n' "$k"; done; set +f
}
akc_of() { sshd -T -C "user=$1,host=check.invalid,addr=127.0.0.1" 2>/dev/null | sed -n 's/^authorizedkeyscommand //p'; }
rfp=; afp=
RAKF=$(akf_paths root /root)
while IFS= read -r f; do [ -f "$f" ] && rfp="$rfp$(fp_list "$f")"$'\n'; done <<< "$RAKF"
rfp=$(grep . <<< "$rfp" | sort -u)
# arm's keys are read AS ARM (arm's own rights), so arm cannot point root at a file arm may not read; fail-closed probe (R8-F-2)
AAKF=$(akf_paths arm "$(getent passwd arm | cut -d: -f6)")
arm_probe 'for f in "$@" "$HOME"/.ssh/*.pub; do [ -f "$f" ] && ssh-keygen -lf "$f" 2>/dev/null; done; true' $AAKF
AFP_OK=$PROBE_OK
afp=$(awk '{print $2}' <<< "$PROBE_OUT" | grep -E '^SHA256:[A-Za-z0-9+/]{43}$' | sort -u)
both=$(comm -12 <(printf '%s\n' "$rfp") <(printf '%s\n' "$afp") | grep .)
rakc=$(akc_of root)
if [ "$AFP_OK" != 1 ]; then chk C6 FAIL "probe did not complete: arm's key listing (read as arm) exited $PROBE_RC without its sentinel, so the overlap with root's keys is not established"
elif [ -n "$both" ]; then chk C6 FAIL "a key authorised for root is also arm's: $(tr '\n' ' ' <<< "$both")"
elif [ -n "$rakc" ] && [ "$rakc" != none ]; then chk C6 UNKNOWN "sshd takes root's keys from an AuthorizedKeysCommand ($rakc): not judged"
else chk C6 PASS "root's authorized keys (sshd AuthorizedKeysFile for root: $(tr '\n' ' ' <<< "$RAKF")): $(grep -c . <<< "$rfp") ($(tr '\n' ' ' <<< "$rfp")); none is one of arm's $(grep -c . <<< "$afp") key fingerprint(s)"; fi
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
  # D1 (r8 review R8-F-6): membership closure. A login role that is a MEMBER (direct or inherited, whatever the INHERIT/SET options:
  # pg_has_role 'MEMBER') of ANY superuser role, login or not, can become superuser and run programs as OS user postgres.
  rows=$(pgq "SELECT rolname, rolsuper, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolcanlogin ORDER BY 1")
  supall=$(pgq "SELECT string_agg(rolname || CASE WHEN rolcanlogin THEN '(login)' ELSE '(nologin)' END, ' ' ORDER BY rolname) FROM pg_roles WHERE rolsuper")
  sup=$(pgq "SELECT r.rolname || '=>' || s.rolname FROM pg_roles r, pg_roles s WHERE r.rolcanlogin AND r.rolname <> 'postgres' AND s.rolsuper
             AND (r.oid = s.oid OR pg_has_role(r.oid, s.oid, 'MEMBER')) ORDER BY 1" | tr '\n' ' ')
  flags=$(awk -F'|' '$2 == "t" || $3 == "t" || $4 == "t" || $5 == "t" {printf "%s(super=%s createrole=%s replication=%s bypassrls=%s) ", $1, $2, $3, $4, $5}' <<< "$rows")
  if [ "$(pgq 'SELECT 1')" != 1 ]; then chk D1 UNKNOWN "PostgreSQL stopped answering"
  elif [ -z "$sup" ]; then chk D1 PASS "no login role other than postgres is, or is a member (direct or inherited) of, a superuser role; superuser roles: ${supall:-none}; login roles: $(cut -d'|' -f1 <<< "$rows" | tr '\n' ' '); with any of super/createrole/replication/bypassrls: ${flags:-none}"
  else chk D1 FAIL "login role(s) other than postgres can become SUPERUSER (role=>superuser role): $sup(superuser roles: $supall)"; fi
  # D2: direct or inherited membership of the three server program/file roles, for every non-superuser login role other than postgres
  mem=$(pgq "SELECT r.rolname || ':' || g.rolname FROM pg_roles r, pg_roles g WHERE r.rolcanlogin AND r.rolname <> 'postgres' AND NOT r.rolsuper
             AND g.rolname IN ('pg_execute_server_program','pg_write_server_files','pg_read_server_files') AND pg_has_role(r.oid, g.oid, 'MEMBER') ORDER BY 1")
  wm=$(grep . <<< "$mem" | tr '\n' ' ')
  [ -z "$wm" ] && chk D2 PASS "no login role other than postgres is a member (direct or inherited) of pg_execute_server_program, pg_write_server_files or pg_read_server_files" \
    || chk D2 FAIL "login roles with server program/file access (role:server role): $wm"
  own=$(pgq "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'afldb_prod'")
  [ -n "$own" ] && chk D3 PASS "report: owner of database afldb_prod: $own" || chk D3 UNKNOWN "database afldb_prod not found"
fi
# arm's DSN role names: the file is read AS ARM (fail-closed probe); values stay in this shell; only variable and role names print
arm_probe 'f=$1; if [ -f "$f" ] && [ ! -L "$f" ]; then head -c 262144 -- "$f"; fi; true' "$ARM_ENV"
envtxt=$PROBE_OUT
if [ "$PROBE_OK" != 1 ]; then unset envtxt; chk D4 FAIL "probe did not complete: reading arm's environment file as arm exited $PROBE_RC without its sentinel, so arm's DSN roles are not established"
elif [ -z "$envtxt" ]; then chk D4 UNKNOWN "arm's environment file $ARM_ENV is absent, a link, or unreadable by arm: arm's DSN role is not established"
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
      # membership closure (R8-F-6): superuser itself or a MEMBER of any superuser role; MEMBER of any of the three server roles
      a=$(pgq "SELECT (r.rolsuper OR EXISTS (SELECT 1 FROM pg_roles s WHERE s.rolsuper AND pg_has_role(r.oid, s.oid, 'MEMBER')))::text
                || '|' || pg_has_role(r.oid, 'pg_execute_server_program', 'MEMBER')::text || '|' || pg_has_role(r.oid, 'pg_write_server_files', 'MEMBER')::text
                || '|' || pg_has_role(r.oid, 'pg_read_server_files', 'MEMBER')::text || '|' || r.rolcreaterole::text
                || '|' || coalesce((SELECT string_agg(s.rolname, ',' ORDER BY s.rolname) FROM pg_roles s WHERE s.rolsuper AND s.oid <> r.oid AND pg_has_role(r.oid, s.oid, 'MEMBER')), '')
                FROM pg_roles r WHERE r.rolname = '$r'")
      case $a in
        '') facts="$facts [$r: no such role]";;
        'false|false|false|false|'*) a=${a%|*}; facts="$facts [$r: not superuser or a member of one, no server program/file role, createrole=${a##*|}]";;
        *) rb="$rb $r(super|execute|write|read|createrole|via superuser roles: $a)";;
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
  arm_probe 'if sudo -n true > /dev/null 2>&1; then echo SUDO-N-OK; else echo SUDO-N-REFUSED; fi'
  if [ "$PROBE_OK" != 1 ]; then chk E0 FAIL "probe did not complete: the arm-side 'sudo -n true' probe exited $PROBE_RC without its sentinel"
  elif [ "$(grep . <<< "$PROBE_OUT")" = SUDO-N-REFUSED ]; then chk E0 PASS "arm cannot run 'sudo -n true' (no passwordless sudo, no cached ticket reachable from a fresh arm process)"
  else chk E0 FAIL "arm runs 'sudo -n true' successfully: arm can become root without a password right now"; fi
fi
# E1, fail-closed (R8-F-1): the probe lists writable components and then its sentinel; a killed or cut-short probe is FAIL, never PASS
arm_probe 'echo "ID $(id)"; for p in "$@"; do c=; r=${p#/}; while :; do c=$c/${r%%/*}; [ -e "$c" ] && [ -w "$c" ] && echo "W $c"; [[ $r == */* ]] || break; r=${r#*/}; done; done; true' "${PROT[@]}"
w=$(sed -n 's/^W //p' <<< "$PROBE_OUT" | sort -u); idarm=$(sed -n 's/^ID //p' <<< "$PROBE_OUT" | head -1)
if [ "$PROBE_OK" != 1 ]; then chk E1 FAIL "probe did not complete: the arm-side write probe exited $PROBE_RC without its sentinel (E2 is the root-side companion)"
elif [ -z "$w" ]; then chk E1 PASS "as arm ($idarm; no startup file, no PAM session) nothing in the protected set or its parents is writable (access(2), ACLs included; ${#PROT[@]} paths; probe completed)"
else chk E1 FAIL "arm can write: $(tr '\n' ' ' <<< "$w")"; fi
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
  fc=$(sed -n 's/^forcecommand //p' <<< "$T"); [ "$fc" = none ] && fc=    # sshd -T prints "forcecommand none" when none applies
  akc=$(akc_of "$ADMIN"); [ "$akc" = none ] && akc=
  AKF=$(akf_paths "$ADMIN" "$ahome")
  # F5 (r8 review R8-F-8): exactly ONE authorised key line in all of sshd's AuthorizedKeysFile paths for the admin, and it is a bare
  # key line (type, base64, optional comment): the procedure writes no options prefix, so any options prefix, any second key line or
  # any line that is not a key line is FAIL; with --admin-fp its fingerprint must equal the workstation's.
  ff=; fails=; nkeys=0; shape=
  KRE='^(ssh-ed25519|sk-ssh-ed25519@openssh\.com|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,3}( [ -~]*)?$'
  while IFS= read -r k; do
    [ -n "$k" ] && { [ -e "$k" ] || [ -L "$k" ]; } || continue
    trust_comp "$k" || { fails="$fails $TC_WHY;"; continue; }
    o=$(stat -c %U -- "$k"); [ "$o" = "$ADMIN" ] || [ "$o" = root ] || fails="$fails $k owned by $o;"
    n=0
    while IFS= read -r l || [ -n "$l" ]; do
      n=$((n + 1)); l=${l%$'\r'}
      [[ $l =~ ^[[:space:]]*(#|$) ]] && continue
      nkeys=$((nkeys + 1))
      LC_ALL=C grep -Eq "$KRE" <<< "$l" || shape="$shape $k:$n is not a bare key line (an options prefix or other text);"
    done < "$k"
    ff="$ff$(fp_list "$k")"$'\n'
  done <<< "$AKF"
  for f in .bashrc .profile .bash_profile .bash_login .bash_logout .ssh/rc .ssh/environment; do
    [ -e "$ahome/$f" ] || [ -L "$ahome/$f" ] || continue
    trust_comp "$ahome/$f" || fails="$fails $TC_WHY;"
  done
  trust_comp "$ahome" || fails="$fails $TC_WHY;"
  ff=$(grep . <<< "$ff" | sort -u)
  both=$(comm -12 <(printf '%s\n' "$ff") <(printf '%s\n' "$afp") | grep .)
  if [ -n "$fails" ]; then chk F5 FAIL "$ADMIN's home, startup or key files:$fails"
  elif [ "$nkeys" = 0 ]; then chk F5 FAIL "$ADMIN has no authorised key ($(tr '\n' ' ' <<< "$AKF")): no independent SSH admin path"
  elif [ -n "$shape" ]; then chk F5 FAIL "$ADMIN's authorised keys:$shape"
  elif [ "$nkeys" != 1 ]; then chk F5 FAIL "$ADMIN has $nkeys authorised key lines; the procedure installs exactly one"
  elif [ "$AFP_OK" != 1 ]; then chk F5 FAIL "probe did not complete: arm's key listing (C6) is not established, so the overlap with the admin key is not judged"
  elif [ -n "$both" ]; then chk F5 FAIL "a key authorised for $ADMIN is also one of arm's: $(tr '\n' ' ' <<< "$both")"
  elif [ -n "$ADMIN_FP" ] && [ "$ff" != "$ADMIN_FP" ]; then chk F5 FAIL "$ADMIN authorises $(tr '\n' ' ' <<< "$ff"), not exactly the workstation fingerprint $ADMIN_FP"
  else chk F5 PASS "$ADMIN authorises exactly one bare key line ($ff${ADMIN_FP:+ = the workstation fingerprint}); not arm's; home and startup files trusted"; fi
  if [ -z "$fc" ] && [ -z "$akc" ] && grep -qx 'pubkeyauthentication yes' <<< "$T"; then
    chk F6 PASS "sshd for $ADMIN: pubkey authentication, no forced command, no AuthorizedKeysCommand; $(grep -E '^(passwordauthentication|permituserrc|allowusers|allowgroups|denyusers|denygroups) ' <<< "$T" | tr '\n' ';')"
  else chk F6 FAIL "sshd for $ADMIN: forcecommand '${fc:-none}', authorizedkeyscommand '${akc:-none}', $(grep '^pubkeyauthentication' <<< "$T")"; fi
fi
# ------------------------------------------------------------------------------------------------ result
if [ ${#FAILS[@]} = 0 ] && [ ${#UNKS[@]} = 0 ]; then echo "OWNER CHECKS RESULT PASS"; exit 0; fi
note=; [[ " ${FAILS[*]} " == *" A2 "* || " ${FAILS[*]} " == *" A1 "* ]] && note=" (session not independent: no result above counts)"
echo "OWNER CHECKS RESULT BLOCKED fail=$(IFS=,; echo "${FAILS[*]:-none}") unknown=$(IFS=,; echo "${UNKS[*]:-none}")$note"
exit 1
