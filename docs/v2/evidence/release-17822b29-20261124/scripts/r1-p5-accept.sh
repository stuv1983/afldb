#!/usr/bin/env bash
# Release 17822b29, block P5: acceptance after the owner's restart. PRODUCTION, as arm. READ-ONLY except the named writes:
# one `status-pass` line in events.log (status --expect), post-install-check.sh's own writes (its header: an events.log line and
# one POST to the retired email-intake route, which answers 410), and the season refresh (loopback POST fan-out that expires
# /seasons/2026 and /brownlow/2026 on every worker; no data write).
#   1. release.mjs status --expect NEW_ID --confirm-restart-invocation <owner's InvocationID>             (rollback trigger)
#   2. post-install-check.sh --confirm-restart-invocation <INV> NEW_ID XWruOm_9nLCSMY8nGPqYU              (rollback trigger)
#      (health, manifests, the previous BUILD_ID answers 404 at the origin, assets, journal as arm can see it)
#   3. identity: the primary runs `node deploy/server-cluster.mjs` in releases/NEW_ID and that file is the 17822b29 blob
#      (4e8ea9b5...); exactly two workers in that release with AFLDB_WORKER_ID 1 and 2, AFLDB_WORKER_COUNT 2; revalidation names
#      present and non-empty in all three (counts only)                                                    (rollback trigger)
#   4. revalidate-season.ts --season 2026: exit 0 and exactly one "REVALIDATED season 2026: 2/2 worker(s) reached (a,b)" line
#      naming ordinals 1 and 2. A FAIL here is recorded and taken to the owner; NOT a rollback trigger by itself and never
#      "fixed" by another restart (the site serves; Sunday rule).
# Then run r1-rawhead.sh check, S9, start r1-p6-observe.sh and the owner's browser check.
# Run: tr -d '\r' < r1-p5-accept.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <NEW_ID> <InvocationID>
# Test seam: R1_LIB_ONLY=1 when sourced; serving_identity (verbatim from r1-p1-precheck.sh) and revalidate_ordinals.

serving_identity() { # unit release-dir supervisor-sha256 [proc-root]
  local unit=$1 rel=$2 sup=$3 proc=${4:-/proc} main cwd argv h w c o k u s n=0 seen=' ' f=0
  main=$(${SC:-systemctl} show "$unit" -p MainPID --value)
  [[ $main =~ ^[1-9][0-9]*$ ]] || { echo "  identity FAIL: $unit has no MainPID"; return 1; }
  cwd=$(readlink "$proc/$main/cwd") || { echo "  identity FAIL: cannot read the primary's cwd"; return 1; }
  argv=$(tr '\0' ' ' < "$proc/$main/cmdline" 2>/dev/null) || argv=unreadable
  echo "  primary pid $main cwd $cwd"; echo "  primary argv $argv"
  [ "$cwd" = "$rel" ] || { echo "  identity FAIL: the primary runs in $cwd, not $rel"; f=1; }
  [[ $argv == *" deploy/server-cluster.mjs "* ]] || { echo "  identity FAIL: argv is not '<node> deploy/server-cluster.mjs'"; f=1; }
  h=$(sha256sum < "$cwd/deploy/server-cluster.mjs" 2>/dev/null | cut -c1-64) || h=missing
  echo "  supervisor in the primary's cwd: sha256 $h"
  [ "$h" = "$sup" ] || { echo "  identity FAIL: supervisor sha256 is not the pinned $sup"; f=1; }
  envc() { tr '\0' '\n' < "$proc/$1/environ" 2>/dev/null | grep -c "$2" || true; }
  envv() { tr '\0' '\n' < "$proc/$1/environ" 2>/dev/null | sed -n "s/^$2=//p" || true; }
  u=$(envc "$main" '^AFLDB_REVALIDATE_URL=[^[:space:]]'); s=$(envc "$main" '^AFLDB_REVALIDATE_SECRET=[^[:space:]]')
  echo "  primary revalidation names (non-empty, counts only): URL $u SECRET $s"; [ "$u/$s" = 1/1 ] || { echo "  identity FAIL: primary names $u/$s"; f=1; }
  for w in $(pgrep -P "$main" || true); do
    n=$((n+1)); c=$(readlink "$proc/$w/cwd" 2>/dev/null || echo '?')
    o=$(envv "$w" AFLDB_WORKER_ID); k=$(envv "$w" AFLDB_WORKER_COUNT)
    u=$(envc "$w" '^AFLDB_REVALIDATE_URL=[^[:space:]]'); s=$(envc "$w" '^AFLDB_REVALIDATE_SECRET=[^[:space:]]')
    echo "  worker pid $w ordinal ${o:-none} count ${k:-none} cwd $c names $u/$s"
    { [ "$c" = "$rel" ] || [ "$c" = "$rel/.next/standalone" ]; } || { echo "  identity FAIL: worker $w runs in $c"; f=1; }
    [[ $o =~ ^[12]$ && $seen != *" $o "* && $k = 2 && $u/$s = 1/1 ]] || { echo "  identity FAIL: worker $w ordinal/count/names"; f=1; }
    seen="$seen$o "
  done
  [[ $n = 2 && ( $seen = ' 1 2 ' || $seen = ' 2 1 ' ) ]] || { echo "  identity FAIL: workers $n, ordinals '$seen' (need exactly 1 and 2)"; f=1; }
  return $f
}

# Same acceptance rule as r6-20261125/r6-revalidate-accept.sh (Astra-reviewed): exit 0, no INCOMPLETE line, exactly one
# REVALIDATED line for the season, 2 of 2, ordinals exactly {1,2}.
revalidate_ordinals() { # cli-output exit-code season
  local out=$1 rc=$2 season=$3 reached total ords; local -a L O
  [ "$rc" = 0 ] || { echo "  revalidate FAIL: the CLI exited $rc"; return 1; }
  ! grep -q 'INCOMPLETE' <<< "$out" || { echo "  revalidate FAIL: an INCOMPLETE line was printed"; return 1; }
  mapfile -t L < <(sed -n "s/^.*REVALIDATED season $season: \([0-9]*\)\/\([0-9]*\) worker(s) reached (\([^)]*\)) in [0-9]* request(s)\.\$/\1 \2 \3/p" <<< "$out")
  [ "${#L[@]}" = 1 ] || { echo "  revalidate FAIL: ${#L[@]} REVALIDATED lines for season $season (need exactly 1)"; return 1; }
  read -r reached total ords <<< "${L[0]}"
  [ "$reached/$total" = 2/2 ] || { echo "  revalidate FAIL: reached $reached of $total"; return 1; }
  IFS=, read -r -a O <<< "$ords"
  [[ ${#O[@]} = 2 && ( $ords = 1,2 || $ords = 2,1 ) ]] || { echo "  revalidate FAIL: ordinals '$ords' are not workers 1 and 2"; return 1; }
  echo "  revalidate: 2/2, ordinals $ords"
}

main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH; SC=systemctl
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
CUR_OLD=7d92042fd110-XWruOm_9nLCSMY8nGPqYU; OLD_BUILD=XWruOm_9nLCSMY8nGPqYU
SUP_NEW=4e8ea9b5be9cda02a6d1e7251a68ab95887be9a2bf055e67ed03703d1ff81a17
NEW_ID=${1:?NEW_ID}; [[ $NEW_ID =~ ^17822b29e6de-[A-Za-z0-9_-]{1,64}$ ]]
INV=${2:?InvocationID}; [[ $INV =~ ^[0-9a-f]{32}$ ]]
{ [ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ]; } || { echo "STOP not afldb-prod as arm: refused"; exit 2; }
echo "== R1 P5 $(date -u +%FT%TZ)"
[ "$(readlink "$ROOT/current")" = "releases/$NEW_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$CUR_OLD" ]; echo "PASS links"
[ "$(systemctl show afldb -p InvocationID --value)" = "$INV" ]; echo "PASS running invocation = the owner's restart $INV"
F=0; T=0
"$N" deploy/release.mjs status --expect "$NEW_ID" --confirm-restart-invocation "$INV" && echo "PASS 1 status --expect" || { echo "FAIL 1 status --expect (rollback trigger)"; F=1; T=1; }
bash deploy/post-install-check.sh --confirm-restart-invocation "$INV" "$NEW_ID" "$OLD_BUILD" && echo "PASS 2 post-install-check" || { echo "FAIL 2 post-install-check (rollback trigger)"; F=1; T=1; }
if serving_identity afldb "$(realpath "$ROOT/releases/$NEW_ID")" "$SUP_NEW"; then echo "PASS 3 identity: 17822b29 supervisor in releases/$NEW_ID, workers 1 and 2, names 1/1"
else echo "FAIL 3 identity (rollback trigger)"; F=1; T=1; fi
OUT=$(npx --no-install tsx tools/maintenance/revalidate-season.ts --season 2026 2>&1) && RC=0 || RC=$?
printf '%s\n' "$OUT" | tail -n 5; echo "revalidate exit=$RC"
if revalidate_ordinals "$OUT" "$RC" 2026; then echo "PASS 4 functional revalidation 2/2, workers 1 and 2"
else echo "FAIL 4 functional revalidation (NOT a rollback trigger; record, owner; never restart again)"; F=1; fi
systemctl show afldb -p ActiveState -p NRestarts -p InvocationID -p ActiveEnterTimestamp
[ $F = 0 ] && echo "P5 RESULT ACCEPT PASS (1-4)" || { [ $T = 1 ] && echo "P5 RESULT FAIL: ROLLBACK TRIGGER (1, 2 or 3)" || echo "P5 RESULT FAIL: check 4 only (owner decides; not a rollback trigger)"; exit 1; }
}
if [ "${R1_LIB_ONLY:-0}" = 1 ]; then return 0 2>/dev/null || exit 0; fi
main "$@" < /dev/null
