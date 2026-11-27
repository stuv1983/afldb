#!/usr/bin/bash
# verify-attest-install.sh: R6 r6 (28 Nov 2026), READ-ONLY check of the backup-origin attestation install (DESIGN.md sections 3, 4, 6).
# Runs as root AND as arm (install-attest.sh runs it both ways; the owner may run it any time). It writes nothing, starts nothing and
# makes no write attempt: whether arm could replace a trusted file is decided by PERMISSION ANALYSIS of every path component (owner,
# group, mode), as the gates decide it. Command inventory: id hostname date systemctl(show) stat sha256sum sed tr cut head wc ls printf echo.
# Prints one PASS / FAIL / INFO line per item and "ATTEST INSTALL RESULT PASS" (exit 0) or "... FAIL (<n>)" (exit 1).
# Usage: bash verify-attest-install.sh [<user that must not be able to replace anything, default arm>]
cd / || exit 2
export LC_ALL=C PATH=/usr/sbin:/usr/bin
set -u -o pipefail
W=/usr/local/libexec/afldb/afldb-backup-attest
D=/etc/systemd/system/afldb-backup.service.d/60-afldb-backup-attest.conf
WS=35a0f3ac5de278784d39207cdf95173190627d5511343f2042a1a731f3d23c2d
DS=2a3a067ef408377ccf6deae7c97c38366854c581a16e3f33ce2265787abc440e
RD=/var/lib/afldb-backup-attest
X='/usr/bin/env -i PATH=/usr/sbin:/usr/bin /usr/bin/bash --noprofile --norc /usr/local/libexec/afldb/afldb-backup-attest'
XF='ignore-failure privileged'
HELPERS=(/usr/bin/env /usr/bin/bash /usr/bin/systemctl /usr/bin/busctl /usr/bin/sha256sum /usr/bin/timeout /usr/bin/mv)
U=${1:-arm}
F=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; F=$((F + 1)); }
info() { echo "INFO $*"; }
echo "== afldb-backup-attest install check $(date -u +%FT%TZ) host=$(hostname) as $(id -un) (uid $(id -u)); subject user $U"
UID_U=$(id -u "$U" 2>/dev/null) && GIDS_U=" $(id -G "$U" 2>/dev/null) " || { fail "user $U does not exist: no permission analysis possible"; UID_U=-1; GIDS_U=" "; }
[ "$UID_U" != 0 ] || fail "user $U is uid 0"
case $GIDS_U in *" 0 "*) fail "user $U is in group 0 (root)";; esac
info "user $U: uid $UID_U groups$GIDS_U(sudo/admin membership is root-equivalent and out of this check's scope: $(id -nG "$U" 2>/dev/null))"

# check_path <path> <dir|file>: every component from / to the leaf: no symlink, uid 0, not group/other-writable, directory except the
# leaf, which must be <dir|file>; and none that user $U can modify or replace (owner $U, a group of $U with write, or other-write).
check_path() {
  local p=$1 want=$2 r c= i=0 u g a n t out bad= why; local -a cs=(/)
  if ! [[ $p =~ ^(/[A-Za-z0-9_@.][A-Za-z0-9_@.-]{0,254}){1,32}$ && /$p/ != */./* && /$p/ != */../* ]]; then fail "path '$p' is not a plain absolute path"; return 1; fi
  r=${p#/}; while [ -n "$r" ]; do c=$c/${r%%/*}; cs+=("$c"); if [[ $r == */* ]]; then r=${r#*/}; else r=; fi; done
  if ! out=$(stat -c '%u %g %a %h %F' -- "${cs[@]}" 2>&1); then fail "$p: missing or unreadable ($(tr '\n' ' ' <<< "$out" | cut -c1-160))"; return 1; fi
  while read -r u g a n t; do
    c=${cs[i]}; i=$((i + 1)); why=
    [ "$t" != "symbolic link" ] || why="$why symlink;"
    [ "$u" = 0 ] || why="$why owner uid $u;"
    (( 8#$a & 8#022 )) && why="$why mode $a group/other-writable;"
    if [ "$i" -lt "${#cs[@]}" ] || [ "$want" = dir ]; then [ "$t" = directory ] || why="$why not a directory;"
    else [ "$t" = "regular file" ] || why="$why not a regular file;"; fi
    # what user U could do to this component (permission analysis only)
    if [ "$u" = "$UID_U" ]; then why="$why $U OWNS it (can chmod/replace);"
    elif [[ $GIDS_U == *" $g "* ]] && (( 8#$a & 8#020 )); then why="$why writable by $U's group $g;"
    elif (( 8#$a & 8#002 )); then why="$why writable by everyone;"; fi
    echo "     $c uid=$u gid=$g mode=$a links=$n type=$t${why:+ <-$why}"
    [ -z "$why" ] || bad=1
  done <<< "$out"
  [ "$i" = "${#cs[@]}" ] || { fail "$p: stat printed $i lines for ${#cs[@]} components"; return 1; }
  if [ -z "$bad" ]; then pass "trusted $want $p: root-owned, not group/other-writable, no symlink from /; $U cannot modify or replace any component"
  else fail "untrusted $want $p (see the component marked <-)"; return 1; fi
}

echo "-- 1. the unit as PID 1 has it loaded"
S=$(systemctl show afldb-backup.service -p LoadState -p FragmentPath -p DropInPaths -p EnvironmentFiles -p ExecStartPostEx 2>&1) || fail "systemctl show afldb-backup.service failed"
sed 's/^/     /' <<< "$S"
frag=; drop=; ef=0; ne=0; ex=; ls=
while IFS= read -r l; do case $l in
  LoadState=*) ls=${l#*=};; FragmentPath=*) frag=${l#*=};; DropInPaths=*) drop=${l#*=};; EnvironmentFiles=?*) ef=$((ef + 1));;
  ExecStartPostEx=?*) ne=$((ne + 1)); ex=${l#*=};; esac; done <<< "$S"
[ "$ls" = loaded ] && pass "afldb-backup.service LoadState=loaded" || fail "afldb-backup.service LoadState='$ls' (not loaded)"
[ "$ef" = 0 ] && pass "EnvironmentFiles is empty (the unit's environment is root-controlled)" || fail "EnvironmentFiles has $ef entries"
[[ " $drop " == *" $D "* ]] && pass "DropInPaths contains $D" || fail "DropInPaths lacks $D"
re='^\{ path=/usr/bin/env ; argv\[\]=(.*) ; flags=([a-z -]*) ; start_time='
if [ "$ne" = 1 ] && [[ $ex =~ $re ]] && [ "${BASH_REMATCH[1]}" = "$X" ] && [ "${BASH_REMATCH[2]}" = "$XF" ]; then
  pass "ExecStartPostEx has exactly one entry: the writer's command line, flags '$XF' (root, failure ignored)"
else fail "ExecStartPostEx: $ne entries; need exactly one with argv '$X' and flags '$XF'"; fi
T=$(systemctl show afldb-backup.timer -p LoadState -p FragmentPath -p DropInPaths 2>&1) || fail "systemctl show afldb-backup.timer failed"
sed 's/^/     /' <<< "$T"
tfrag=; tdrop=
while IFS= read -r l; do case $l in FragmentPath=*) tfrag=${l#*=};; DropInPaths=*) tdrop=${l#*=};; esac; done <<< "$T"
[ -n "$frag" ] && [ -n "$tfrag" ] && pass "both units have a FragmentPath" || fail "afldb-backup.service or .timer has no FragmentPath"
read -ra ps <<< "$drop"; read -ra tps <<< "$tdrop"

echo "-- 2. trusted paths (every component; $U's possible writes by permission analysis)"
for p in "${HELPERS[@]}" "$W" "$D" ${frag:+"$frag"} "${ps[@]}" ${tfrag:+"$tfrag"} "${tps[@]}"; do check_path "$p" file; done
check_path "$RD" dir

echo "-- 3. writer and drop-in identity (pinned: writer $WS, drop-in $DS)"
h=$(sha256sum < "$W" 2>/dev/null); [ "${h%% *}" = "$WS" ] && pass "writer sha256 $WS" || fail "writer sha256 '${h%% *}' != pinned $WS"
h=$(sha256sum < "$D" 2>/dev/null); [ "${h%% *}" = "$DS" ] && pass "drop-in sha256 $DS" || fail "drop-in sha256 '${h%% *}' != pinned $DS"

echo "-- 4. records in $RD (information; the gates judge the record of the run they attribute)"
shopt -s nullglob; recs=("$RD"/*.attest); tmps=("$RD"/.*.tmp); shopt -u nullglob
info "${#recs[@]} record(s); ${#tmps[@]} leftover temporary file(s) of a writer run that did not finish${tmps[*]:+: ${tmps[*]}}"
nb=0
for r in "${recs[@]}"; do
  st=$(stat -c '%u %a %h %F' -- "$r" 2>/dev/null)
  if [ "$st" != "0 644 1 regular file" ] || [ "$(head -n 1 -- "$r" 2>/dev/null)" != afldb-backup-attest/1 ] || [ "$(wc -l < "$r" 2>/dev/null)" != 20 ]; then
    nb=$((nb + 1)); echo "     not a well-formed root record: $r ($st)"; fi
done
[ "$nb" = 0 ] && pass "every record file is root:0644, one link, 20 lines, afldb-backup-attest/1" || fail "$nb record file(s) are not well-formed root records"
if [ "${#recs[@]}" -gt 0 ]; then
  last=$(ls -1t -- "${recs[@]}" 2>/dev/null | head -n 1)
  info "newest record $last:"; sed 's/^/     /' -- "$last"
fi

[ "$F" = 0 ] && { echo "ATTEST INSTALL RESULT PASS"; exit 0; } || { echo "ATTEST INSTALL RESULT FAIL ($F)"; exit 1; }
