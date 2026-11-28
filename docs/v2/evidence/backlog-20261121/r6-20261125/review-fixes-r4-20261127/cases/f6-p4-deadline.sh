#!/usr/bin/env bash
# R6 r4 fixture suite f6: the promotion deadline (review finding 6). CONTAINER ONLY, as root (it creates the user arm and
# PATH shims), no network: docker run --rm --network none --hostname afldb-prod of the pinned Ubuntu 24.04 image with Node
# mounted read-only at /home/arm/.nvm/versions/node/v22.23.2. It refuses to run anywhere else.
# Executes the REAL bytes of <FIX>/deploy/release.mjs and <FIX>/docs/v2/evidence/release-17822b29-20261124/scripts/
# r1-p4-gate-promote.sh. P4 has fixed paths, so the fixture lives at /home/arm/projects/afldb (checkout: release.mjs and its
# one import) and /home/arm/afldb-releases (three releases built as the release rehearsal builds them: the real supervisor
# blob over rehearsal/stub-server.cjs, MANIFEST and release.json by rehearsal/make-release.mjs) inside the disposable
# container; shims and state are under /fx and /usr/local/bin; scratch files under the suite's own mktemp directory.
# The fixture "service" is one process owned by arm whose cwd is the current release (P4 and promote read only
# systemctl MainPID and /proc/<pid>/cwd); it is not the supervisor.
# Shims (never the scripts under test):
#   hostname  prints afldb-prod.
#   systemctl is-active (inactive), list-timers (apt-daily-upgrade.timer due 20 h ahead on the case's clock), show (fixture table).
#             /fx/slow-on = N makes the Nth list-timers call sleep /fx/slow-secs first: validation that takes real time.
#             P4 calls it twice: 1 = its host-gate step, 2 = the host gate inside promote. A bare promote calls it once.
#   date      for calls without -d: /fx/clock line "date frozen <ms>" or "date offset <ms>" (real clock + offset).
#   node clock  lib-f67-fake-clock.cjs through NODE_OPTIONS=--require, set by this fixture's environment only, same file,
#             lines "node frozen <ms>" / "node offset <ms>". Cases named cli-* use the REAL clock for both.
# Every refusal case checks the exit code, the specific reason text, and that current, previous and events.log are
# byte-identical to the state before the run.
# Contrast (the defect): the ORIGINAL release.mjs and P4 (aa33f0fc) with validation that outlasts the deadline switch
# the link. Originals = $F6_ORIG_RELEASE / $F6_ORIG_P4 if set, else <FIX>/docs/v2/evidence/backlog-20261121/r6-20261125/
# review-fixes-r4-20261127/orig-aa33f0fc/{release.mjs,r1-p4-gate-promote.sh}. The same original release.mjs is the
# "old tool in the checkout" for the fail-closed case.
# Usage: bash cases/f6-p4-deadline.sh <FIX> [<STAGE>]     (<STAGE> is accepted and unused: f6 tests release-packet files)
# Output: one "CASE-RESULT f6-<case> OK|UNEXPECTED (<expected> ; got <actual>)" line per case; last line
# "SUITE f6 RESULT PASS (<n> cases)" exit 0, or "SUITE f6 RESULT FAIL (<k> unexpected)" exit 1.
main() {
set -uo pipefail; export LC_ALL=C
local FIX=${1:-}
[ -n "$FIX" ] && [ -d "$FIX" ] || { echo "usage: f6-p4-deadline.sh <FIX> [<STAGE>]"; exit 2; }
[ -f /.dockerenv ] && [ "$(id -u)" = 0 ] || { echo "REFUSED: f6 runs only as root inside its disposable container"; exit 2; }
local H=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r4-20261127 REL=docs/v2/evidence/release-17822b29-20261124
local P4=$FIX/$REL/scripts/r1-p4-gate-promote.sh TOOL=$FIX/deploy/release.mjs RH=$FIX/$REL/rehearsal
local OP4=${F6_ORIG_P4:-$FIX/$H/orig-aa33f0fc/r1-p4-gate-promote.sh} OTOOL=${F6_ORIG_RELEASE:-$FIX/$H/orig-aa33f0fc/release.mjs}
local NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node CHK=/home/arm/projects/afldb ROOT=/home/arm/afldb-releases
local CUR=7d92042fd110-XWruOm_9nLCSMY8nGPqYU PREV=c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC NEW=17822b29e6de-F6fixtureBuild000000a
for f in "$P4" "$TOOL" "$FIX/tools/build/env-in-standalone.mjs" "$FIX/deploy/server-cluster.mjs" "$RH/make-release.mjs" "$RH/stub-server.cjs" \
  "$FIX/$H/cases/lib-f67-fake-clock.cjs"; do [ -f "$f" ] || { echo "STOP missing $f"; exit 2; }; done
[ -x "$NODE" ] || { echo "STOP no node at $NODE (mount it read-only)"; exit 2; }
RD=$(mktemp -d /tmp/f6-p4-deadline.XXXXXX) || exit 2
SVC=
trap '[ -n "$SVC" ] && kill "$SVC" 2>/dev/null; rm -rf -- "$RD"' EXIT
N=0; BADN=0
res() { # case ok(0|1) expected got
  N=$((N+1)); if [ "$2" = 0 ]; then echo "CASE-RESULT f6-$1 OK ($3 ; got $4)"; else echo "CASE-RESULT f6-$1 UNEXPECTED ($3 ; got $4)"; BADN=$((BADN+1)); fi; }
CUTOFF=$(TZ=Australia/Melbourne /usr/bin/date -d '2026-11-24 11:30' +%s)
echo "== f6 $(/usr/bin/date -u +%FT%TZ) hostname=$(/usr/bin/hostname 2>/dev/null || cat /etc/hostname) cutoff=$CUTOFF node=$("$NODE" --version)"
echo "   under test: $(sha256sum < "$TOOL" | cut -c1-64) deploy/release.mjs; $(sha256sum < "$P4" | cut -c1-64) r1-p4-gate-promote.sh"
[ -f "$OTOOL" ] && [ -f "$OP4" ] && echo "   contrast:   $(sha256sum < "$OTOOL" | cut -c1-64) release.mjs; $(sha256sum < "$OP4" | cut -c1-64) r1-p4-gate-promote.sh (aa33f0fc)"

# ---------------------------------------------------------------- user, shims, clock
userdel -r ubuntu >/dev/null 2>&1; useradd -M -u 1000 -s /bin/bash arm || { echo "STOP useradd"; exit 2; }
mkdir -p /home/arm /fx && chown arm:arm /home/arm && chmod 755 /home/arm && chmod 777 /fx
cp "$FIX/$H/cases/lib-f67-fake-clock.cjs" /fx/fake-clock.cjs
cat > /usr/local/bin/hostname <<'SH'
#!/bin/bash
echo afldb-prod
SH
cat > /usr/local/bin/date <<'SH'
#!/bin/bash
for a in "$@"; do case $a in -d|--date|-d*|--date=*|-r|--reference=*|-f|--file=*) exec /usr/bin/date "$@";; esac; done
m=$(awk '$1 == "date" { print $2, $3 }' /fx/clock 2>/dev/null)
case $m in "frozen "*) ms=${m#frozen };; "offset "*) ms=$(( $(/usr/bin/date +%s%3N) + ${m#offset } ));; *) exec /usr/bin/date "$@";; esac
exec /usr/bin/date -d "@${ms:0:${#ms}-3}.${ms: -3}" "$@"
SH
cat > /usr/local/bin/systemctl <<'SH'
#!/bin/bash
cmd=; unit=; props=(); value=0
while [ $# -gt 0 ]; do case $1 in show|is-active|list-timers) cmd=$1; shift; break;; *) shift;; esac; done
case $cmd in
  is-active) echo inactive; exit 3;;
  list-timers)
    n=$(( $(cat /fx/lt-count 2>/dev/null || echo 0) + 1 )); echo "$n" > /fx/lt-count
    [ "$n" = "$(cat /fx/slow-on 2>/dev/null)" ] && sleep "$(cat /fx/slow-secs)"
    printf '[{"next":%s000000,"left":0,"last":0,"passed":0,"unit":"apt-daily-upgrade.timer","activates":"apt-daily-upgrade.service"}]\n' "$(cat /fx/apt-next)";;
  show)
    while [ $# -gt 0 ]; do case $1 in -p) props+=("$2"); shift 2;; --value) value=1; shift;; -*) shift;; *) unit=$1; shift;; esac; done
    for p in "${props[@]}"; do
      case "$unit/$p" in
        afldb/MainPID) v=$(cat /fx/mainpid);; afldb/InvocationID) v=0123456789abcdef0123456789abcdef;;
        afldb/ActiveEnterTimestamp) v='Mon 2026-11-23 15:21:40 UTC';; */ActiveState) v=active;; */NRestarts) v=0;;
        */MainPID) v=4242;; */InvocationID) v=fedcba9876543210fedcba9876543210;; */ActiveEnterTimestamp) v='Sun 2026-11-22 01:00:00 UTC';; *) v=;;
      esac
      if [ "$value" = 1 ]; then printf '%s\n' "$v"; else printf '%s=%s\n' "$p" "$v"; fi
    done;;
  *) exit 1;;
esac
SH
chmod 755 /usr/local/bin/hostname /usr/local/bin/date /usr/local/bin/systemctl
as_arm() { setpriv --reuid=arm --regid=arm --init-groups env -i HOME=/home/arm USER=arm LOGNAME=arm PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 "$@"; }
# P4 / the tool as arm with the fixture clock for node; "real" = no NODE_OPTIONS.
p4run()   { as_arm env NODE_OPTIONS="--require /fx/fake-clock.cjs" bash "$1" "$NEW" < /dev/null > "$RD/out" 2>&1; echo $? > "$RD/rc"; }
toolrun() { as_arm bash -c 'cd /home/arm/projects/afldb && exec "$@"' _ "$NODE" deploy/release.mjs "$@" < /dev/null > "$RD/out" 2>&1; echo $? > "$RD/rc"; }

# ---------------------------------------------------------------- checkout and release root
mkdir -p "$CHK/deploy" "$CHK/tools/build" "$ROOT/releases"
cp "$TOOL" "$CHK/deploy/release.mjs"; cp "$FIX/tools/build/env-in-standalone.mjs" "$CHK/tools/build/env-in-standalone.mjs"
mk() { local id=$1 rev=$2 bid=${1#*-} d=$ROOT/releases/$1
  mkdir -p "$d/deploy" "$d/.next/standalone/.next" && cp "$FIX/deploy/server-cluster.mjs" "$d/deploy/server-cluster.mjs" \
  && cp "$RH/stub-server.cjs" "$d/.next/standalone/server.js" && printf '%s' "$bid" > "$d/.next/standalone/.next/BUILD_ID" \
  && "$NODE" "$RH/make-release.mjs" "$CHK" "$d" "$id" "$rev" "$bid" > /dev/null; }
mk "$PREV" c8d4202a4cb3000000000000000000000000c8d4 && mk "$CUR" 7d92042fd11010eaa20966e2f49ae7a93e286568 \
  && mk "$NEW" 17822b29e6de2b6248cd7ada4221800fd81e0003 || { echo "STOP fixture releases"; exit 2; }
printf '%s\n' '{"ts":"2026-11-22T01:10:00.000Z","op":"status-pass","id":"'"$CUR"'"}' > /fx/events.base
chown -R arm:arm /home/arm/projects /home/arm/afldb-releases
setpriv --reuid=arm --regid=arm --init-groups bash -c "cd '$ROOT/releases/$CUR' && exec sleep 86400" & SVC=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ "$(readlink "/proc/$SVC/cwd" 2>/dev/null)" = "$ROOT/releases/$CUR" ] && break; sleep 0.2; done
echo "$SVC" > /fx/mainpid
[ "$(as_arm readlink "/proc/$SVC/cwd")" = "$ROOT/releases/$CUR" ] || { echo "STOP fixture service"; exit 2; }

reset() { # tool(new|old) date-clock node-clock [slow-on slow-secs]; clocks: "real" | "frozen <ms>" | "offset <ms>"
  rm -f "$ROOT/links.lock" /fx/clock /fx/slow-on /fx/slow-secs; echo 0 > /fx/lt-count; chmod 666 /fx/lt-count
  case $1 in new) cp "$TOOL" "$CHK/deploy/release.mjs";; old) cp "$OTOOL" "$CHK/deploy/release.mjs";; esac
  ln -sfn "releases/$CUR" "$ROOT/current"; ln -sfn "releases/$PREV" "$ROOT/previous"; cp /fx/events.base "$ROOT/events.log"
  chown -h arm:arm "$ROOT/current" "$ROOT/previous"; chown arm:arm "$ROOT/events.log" "$CHK/deploy/release.mjs"
  { [ "$2" = real ] || echo "date $2"; [ "$3" = real ] || echo "node $3"; } > /fx/clock
  if [ "$3" = real ]; then echo $(( $(/usr/bin/date +%s) + 72000 )); else echo $((CUTOFF + 72000)); fi > /fx/apt-next     # 20 h ahead on the clock the tool sees
  [ -z "${4:-}" ] || { echo "$4" > /fx/slow-on; echo "$5" > /fx/slow-secs; }
  BEFORE=$(snap); }
snap() { echo "$(readlink "$ROOT/current")|$(readlink "$ROOT/previous")|$(sha256sum < "$ROOT/events.log" | cut -c1-64)|lock=$([ -e "$ROOT/links.lock" ] && echo present || echo none)"; }
rc() { cat "$RD/rc"; }
has() { grep -qF -- "$1" "$RD/out"; }
last() { tail -n 1 "$RD/out" | cut -c1-150; }
lastfull() { tail -n 1 "$RD/out"; }
offset_for() { echo $(( $1 - $(/usr/bin/date +%s%3N) )); }       # ms offset that makes "now" equal the given epoch ms
unchanged() { [ "$(snap)" = "$BEFORE" ] && [ "$BEFORE" = "releases/$CUR|releases/$PREV|$(sha256sum < /fx/events.base | cut -c1-64)|lock=none" ]; }
promoted() { [ "$(readlink "$ROOT/current")|$(readlink "$ROOT/previous")" = "releases/$NEW|releases/$CUR" ] && [ "$(wc -l < "$ROOT/events.log")" = 2 ] \
  && tail -n 1 "$ROOT/events.log" | grep -q '"op":"promote"'; }
ENF="release: PROMOTION DEADLINE ENFORCED not-after=$CUTOFF not-reached"
AFTERV='REFUSED: promotion deadline passed (after validation, immediately before the link switch)'
NOCHG='No link was switched and events.log was not written. Nothing was changed.'

# ================================================================ A. the tool through its CLI, REAL clock
echo "-- A. release.mjs promote/host-gate --not-after, real clock"
reset new real real; D=$(( $(/usr/bin/date +%s) + 300 )); toolrun promote "$NEW" --attended --not-after "$D"
{ [ "$(rc)" = 0 ] && has "release: PROMOTED $NEW" && promoted && tail -n 1 "$ROOT/events.log" | grep -q "\"notAfter\":$D"; }
res cli-deadline-ahead $? "exit 0, PROMOTED, links $NEW/$CUR, event records notAfter" "exit $(rc), $(readlink "$ROOT/current") / $(readlink "$ROOT/previous"), $(grep -o '"notAfter":[0-9]*' "$ROOT/events.log" | tail -1)"

reset new real real; D=$(( $(/usr/bin/date +%s) - 1 )); toolrun promote "$NEW" --attended --not-after "$D"
{ [ "$(rc)" = 1 ] && has 'REFUSED: promotion deadline passed (before validation)' && has "$NOCHG" && unchanged; }
res cli-deadline-past $? "exit 1, 'promotion deadline passed (before validation)', links and events.log byte-identical" "exit $(rc), $(last), state $([ "$(snap)" = "$BEFORE" ] && echo identical || echo CHANGED)"

reset new real real 1 5; D=$(( $(/usr/bin/date +%s) + 2 )); T0=$(/usr/bin/date +%s%3N); toolrun promote "$NEW" --attended --not-after "$D"; T1=$(/usr/bin/date +%s%3N)
{ [ "$(rc)" = 1 ] && has "$AFTERV" && has "$NOCHG" && has 'release:   next apt-daily-upgrade in' && unchanged && [ $((T1 - T0)) -ge 5000 ]; }
res cli-expires-during-validation $? "deadline 2 s ahead, host gate takes 5 s: exit 1, '$AFTERV', current still $CUR, previous and events.log byte-identical" \
  "exit $(rc) after $((T1 - T0)) ms, $(last | cut -c1-110), current=$(readlink "$ROOT/current") state $([ "$(snap)" = "$BEFORE" ] && echo identical || echo CHANGED)"

for bad in 11:30 "${CUTOFF}0" "$CUTOFF.5" 12345; do
  reset new real real; toolrun promote "$NEW" --attended --not-after "$bad"
  { [ "$(rc)" = 1 ] && has 'REFUSED: --not-after must be an epoch time in whole seconds' && has 'Nothing was changed.' && unchanged; }
  res "cli-malformed-$bad" $? "exit 1, '--not-after must be an epoch time in whole seconds', nothing changed" "exit $(rc), $(last | cut -c1-90), state $([ "$(snap)" = "$BEFORE" ] && echo identical || echo CHANGED)"
done

reset new real real; toolrun promote "$NEW" --attended
{ [ "$(rc)" = 0 ] && promoted && ! grep -q notAfter "$ROOT/events.log" && ! has DEADLINE; }
res cli-no-option-unchanged $? "no --not-after: exit 0, promoted, no deadline text, event has no notAfter" "exit $(rc), $(readlink "$ROOT/current"), notAfter in event: $(grep -c notAfter "$ROOT/events.log")"

# rollback from the promoted state just made, with a deadline long past: never subject to it
toolrun rollback --attended --to "$CUR" --not-after $(( $(/usr/bin/date +%s) - 86400 ))
{ [ "$(rc)" = 0 ] && has "ROLLED BACK to $CUR" && has '--not-after ignored: a rollback has no deadline' && [ "$(readlink "$ROOT/current")|$(readlink "$ROOT/previous")" = "releases/$CUR|releases/$NEW" ]; }
res cli-rollback-has-no-deadline $? "rollback --not-after <yesterday>: exit 0, ROLLED BACK, links $CUR/$NEW" "exit $(rc), $(readlink "$ROOT/current") / $(readlink "$ROOT/previous")"

reset new real real; D=$(( $(/usr/bin/date +%s) + 300 )); toolrun host-gate --not-after "$D"
{ [ "$(rc)" = 0 ] && [ "$(grep -Fxc -- "release: PROMOTION DEADLINE ENFORCED not-after=$D not-reached" "$RD/out")" = 1 ] && has 'HOST GATE PASS' && unchanged; }
res cli-hostgate-proof-line $? "host-gate --not-after <ahead>: exit 0, exactly one ENFORCED line, read-only" "exit $(rc), $(grep -c 'DEADLINE ENFORCED' "$RD/out") line(s), state $([ "$(snap)" = "$BEFORE" ] && echo identical || echo CHANGED)"
reset new real real; toolrun host-gate --not-after $(( $(/usr/bin/date +%s) - 1 ))
{ [ "$(rc)" = 1 ] && has 'release: REFUSE promotion deadline passed' && has 'HOST GATE REFUSED' && ! has 'DEADLINE ENFORCED' && unchanged; }
res cli-hostgate-past $? "host-gate --not-after <past>: exit 1, REFUSE promotion deadline passed, no ENFORCED line" "exit $(rc), $(last)"

# ================================================================ B. the real P4 through shims; date and node clocks controlled
echo "-- B. r1-p4-gate-promote.sh (cutoff $CUTOFF = Tue 24 Nov 2026 11:30:00 Australia/Melbourne)"
p4case() { # name tool date-clock node-clock slow-on slow-secs
  reset "$2" "$3" "$4" "${5:-}" "${6:-}"; p4run "${7:-$P4}"; }
A1100=$(( (CUTOFF - 1800) * 1000 ))
p4case before-cutoff new "frozen $A1100" "frozen $A1100"
{ [ "$(rc)" = 0 ] && [[ $(last) == "P4 RESULT PROMOTED 2026-11-24T00:00:00Z: OWNER NOW: RESTART block"* ]] && [ "$(grep -Fxc -- "$ENF" "$RD/out")" = 1 ] && promoted \
  && has "PASS links current=$NEW previous=$CUR" && tail -n 1 "$ROOT/events.log" | grep -q "\"notAfter\":$CUTOFF"; }
res p4-before-cutoff $? "11:00:00: exit 0, P4 RESULT PROMOTED, the ENFORCED line once, links $NEW/$CUR, event notAfter=$CUTOFF" "exit $(rc), $(last | cut -c1-60), $(readlink "$ROOT/current")"

p4case at-cutoff new "frozen ${CUTOFF}000" "frozen ${CUTOFF}000"
{ [ "$(rc)" = 0 ] && [[ $(last) == "P4 RESULT PROMOTED 2026-11-24T00:30:00Z:"* ]] && promoted; }
res p4-exactly-at-cutoff $? "11:30:00.000 on both clocks: permitted, P4 RESULT PROMOTED" "exit $(rc), $(last | cut -c1-60), $(readlink "$ROOT/current")"

p4case one-ms-bash new "frozen ${CUTOFF}001" "frozen ${CUTOFF}001"
{ [ "$(rc)" = 1 ] && [ "$(last)" = 'STOP past the promotion cutoff (Tue 24 Nov 11:30 AEDT): do not promote; production unchanged; reschedule' ] && ! has '== R1 P4 host-gate' && unchanged; }
res p4-1ms-after-cutoff $? "11:30:00.001: exit 1, 'STOP past the promotion cutoff', release.mjs never run, nothing changed" "exit $(rc), $(last | cut -c1-70), state $([ "$(snap)" = "$BEFORE" ] && echo identical || echo CHANGED)"

p4case one-second new "frozen $((CUTOFF + 1))000" "frozen $((CUTOFF + 1))000"
{ [ "$(rc)" = 1 ] && [ "$(last)" = 'STOP past the promotion cutoff (Tue 24 Nov 11:30 AEDT): do not promote; production unchanged; reschedule' ] && ! has '== R1 P4 host-gate' && unchanged; }
res p4-1s-after-cutoff $? "11:30:01: exit 1, 'STOP past the promotion cutoff', nothing changed" "exit $(rc), $(last | cut -c1-70), state $([ "$(snap)" = "$BEFORE" ] && echo identical || echo CHANGED)"

# bash sees 11:30:00.000 (permitted); node's clock is 1 ms later: the tool's own boundary, at the host-gate step
p4case node-1ms new "frozen ${CUTOFF}000" "frozen ${CUTOFF}001"
{ [ "$(rc)" = 1 ] && has "release: REFUSE promotion deadline passed: --not-after $CUTOFF (2026-11-24T00:30:00.000Z), now 2026-11-24T00:30:00.001Z" \
  && [[ $(last) == 'STOP host gate refused (host state, or the promotion cutoff has passed): do not promote; production unchanged' ]] && ! has '== R1 P4 promote' && unchanged; }
res p4-node-clock-1ms-after $? "bash 11:30:00.000, node 11:30:00.001: exit 1, host-gate 'REFUSE promotion deadline passed', promote never run, nothing changed" \
  "exit $(rc), $(last | cut -c1-60), state $([ "$(snap)" = "$BEFORE" ] && echo identical || echo CHANGED)"

# bash passes at 11:29:59 and stays there; node's clock is already past 11:30 (independent clocks, both frozen)
p4case bash-ok-node-late new "frozen $((CUTOFF - 1))000" "frozen $((CUTOFF + 5))000"
{ [ "$(rc)" = 1 ] && has 'release: REFUSE promotion deadline passed' && [[ $(last) == 'STOP host gate refused'* ]] && ! has '== R1 P4 promote' && unchanged; }
res p4-bash-1129-59-node-past $? "bash 11:29:59, node 11:30:05: exit 1, STOP at the host-gate step, nothing changed" "exit $(rc), $(last | cut -c1-60), state $([ "$(snap)" = "$BEFORE" ] && echo identical || echo CHANGED)"

# time passes: both clocks start at 11:29:57 (real clock + one offset); P4's own check and its host-gate step pass; the
# host gate inside promote then takes 6 s, so the clock is past 11:30 when promote reaches the switch
O=$(offset_for $(( (CUTOFF - 3) * 1000 ))); p4case expires new "offset $O" "offset $O" 2 6
{ [ "$(rc)" = 1 ] && [ "$(grep -Fxc -- "$ENF" "$RD/out")" = 1 ] && has '== R1 P4 promote' && has "$AFTERV" && has "$NOCHG" \
  && [ "$(lastfull)" = "STOP promote refused (exit 1): links unchanged (current=$CUR previous=$PREV); production unchanged; do not restart" ] && ! has 'P4 RESULT PROMOTED' && unchanged; }
res p4-expires-during-validation $? "P4 starts 11:29:57, its check and host-gate pass, promote's validation outlasts 11:30: exit 1, '$AFTERV', STOP links unchanged, current still $CUR, events.log byte-identical" \
  "exit $(rc), $(grep -o 'now 2026-11-24T00:30:0[0-9.]*Z' "$RD/out" | tail -1), $(last | cut -c1-70), state $([ "$(snap)" = "$BEFORE" ] && echo identical || echo CHANGED)"

if [ -f "$OTOOL" ] && [ -f "$OP4" ]; then
  # fail closed: the NEW P4 with the OLD release.mjs in the checkout, well before the cutoff
  p4case old-tool old "frozen $A1100" "frozen $A1100"
  { [ "$(rc)" = 1 ] && has 'release: HOST GATE PASS' && [ "$(grep -c '^release: PROMOTION DEADLINE' "$RD/out")" = 0 ] && ! has '== R1 P4 promote' && unchanged \
    && [[ $(lastfull) == "STOP this release.mjs does not enforce the promotion deadline (host-gate did not print '$ENF'): do not promote; production unchanged" ]]; }
  res p4-old-release-mjs-fail-closed $? "aa33f0fc release.mjs in the checkout at 11:00: host-gate passes without the ENFORCED line, P4 exit 1 'does not enforce the promotion deadline', promote never run, nothing changed" \
    "exit $(rc), $(last | cut -c1-75), state $([ "$(snap)" = "$BEFORE" ] && echo identical || echo CHANGED)"

  echo "-- C. contrast: the originals (aa33f0fc) switch the link after the deadline"
  # the old tool silently stores --not-after and ignores it: why P4 must not rely on passing the option alone
  reset old real real 1 5; D=$(( $(/usr/bin/date +%s) + 2 )); toolrun promote "$NEW" --attended --not-after "$D"; NOWS=$(/usr/bin/date +%s)
  { [ "$(rc)" = 0 ] && promoted && [ "$NOWS" -gt "$D" ]; }
  res contrast-orig-tool-ignores-not-after $? "DEFECT shown: original release.mjs, deadline 2 s ahead, validation 5 s: exit 0 and the link is switched after the deadline" \
    "exit $(rc), current=$(readlink "$ROOT/current"), finished $((NOWS - D)) s after the deadline"
  O=$(offset_for $(( (CUTOFF - 3) * 1000 ))); p4case orig-expires old "offset $O" "offset $O" 2 6 "$OP4"
  TS=$(tail -n 1 "$ROOT/events.log" | sed -n 's/^{"ts":"\([^"]*\)","op":"promote".*/\1/p')
  { [ "$(rc)" = 0 ] && [[ $(last) == 'P4 RESULT PROMOTED 2026-11-24T00:30:0'* ]] && promoted && [[ $TS > 2026-11-24T00:30:00.000Z ]]; }
  res contrast-orig-p4-expires-during-validation $? "DEFECT shown: original P4 + original release.mjs, started 11:29:57, validation outlasts 11:30: exit 0, P4 RESULT PROMOTED, link switched, promote event stamped after 00:30:00Z" \
    "exit $(rc), current=$(readlink "$ROOT/current"), promote event ts $TS"
else
  echo "NOTE originals not found ($OTOOL, $OP4): the old-tool case and the contrast were skipped"
  res originals-present 1 "the aa33f0fc originals for the old-tool and contrast cases" "missing"
fi

if [ "$BADN" = 0 ]; then echo "SUITE f6 RESULT PASS ($N cases)"; exit 0; else echo "SUITE f6 RESULT FAIL ($BADN unexpected)"; exit 1; fi
}
main "$@"
