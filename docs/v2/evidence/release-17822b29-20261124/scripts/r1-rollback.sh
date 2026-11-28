#!/usr/bin/env bash
# Release 17822b29, application rollback to Sunday's accepted release (never touches data, the checkout or .env). PRODUCTION, as arm.
# Two modes, the owner's restart between them:
#   links   release.mjs rollback --attended --to 7d92042fd110-XWruOm_9nLCSMY8nGPqYU --ledger-head 118_fixtures_unconfirmed_participants.sql
#           (renames current back to the retained 7d92042f release, previous becomes the 17822b29 release; rebuilds nothing). Then
#           OWNER: the RESTART block of the runbook (systemd then starts `node deploy/server-cluster.mjs` inside the 7d92042f release
#           directory, i.e. the 7d92042f supervisor bytes d82f24c4..., whatever the checkout holds).
#   verify  1. status --expect 7d92042fd110-XWruOm_9nLCSMY8nGPqYU --confirm-restart-invocation <INV>
#           2. post-install-check.sh against the 17822b29 BUILD_ID (the rolled-back-from build must answer 404 at the origin)
#           3. identity: primary in releases/7d92042fd110-XWruOm_9nLCSMY8nGPqYU, supervisor d82f24c4..., workers 1 and 2, names 1/1
#           4. season refresh 2/2 with ordinals 1 and 2 (the 17822b29 CLI sends the unchanged season-only body the 7d92042f route
#              accepts); record only.
#           Then r1-rawhead.sh check none (the 2026 pages, the genuine 404 controls and the sitemap codes must PASS; the ISSUE-367
#           live controls are left out, because the 7d92042f build serves unaccepted years exactly as it did before) and S9 with
#           XWruOm_9nLCSMY8nGPqYU.
# The checkout stays at 17822b29 (harmless: the service runs the release tree; the 17822b29 tools are compatible with the 7d92042f
# release: no migration, dependency or unit change; P2). Wednesday R6 then runs with outcome `accepted`, CURRENT_ID 7d92042fd110-XWruOm_9nLCSMY8nGPqYU.
# Run: tr -d '\r' < r1-rollback.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- links
#      tr -d '\r' < r1-rollback.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- verify <InvocationID> <17822b29 BUILD_ID>
# Test seam: R1_LIB_ONLY=1 when sourced (serving_identity and revalidate_ordinals, verbatim from r1-p5-accept.sh).

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
OLD=7d92042fd110-XWruOm_9nLCSMY8nGPqYU; LEDGER=118_fixtures_unconfirmed_participants.sql
SUP_OLD=d82f24c48e2bc310857826e8fecc2e5ad90381ec3267c0d1ddba5ae19a822865
{ [ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ]; } || { echo "STOP not afldb-prod as arm: refused"; exit 2; }
MODE=${1:?mode}
case $MODE in
  links)
    echo "== R1 rollback links $(date -u +%FT%TZ)"
    FROM=$(readlink "$ROOT/current"); echo "current before: $FROM"
    [[ $FROM =~ ^releases/17822b29e6de-[A-Za-z0-9_-]{1,64}$ ]] || { echo "STOP current is not a 17822b29 release: nothing to roll back (record the state; owner)"; exit 1; }
    [ -d "$ROOT/releases/$OLD" ]; "$N" deploy/release.mjs verify "$OLD"
    "$N" deploy/release.mjs rollback --attended --to "$OLD" --ledger-head "$LEDGER"
    [ "$(readlink "$ROOT/current")" = "releases/$OLD" ]; [ "$(readlink "$ROOT/previous")" = "$FROM" ]; echo "PASS current -> $OLD, previous -> ${FROM#releases/}"
    tail -n 1 "$ROOT/events.log"
    echo "ROLLBACK RESULT LINKS SWITCHED $(date -u +%FT%TZ): OWNER NOW: RESTART block (runbook section 4.2)";;
  verify)
    INV=${2:?InvocationID}; [[ $INV =~ ^[0-9a-f]{32}$ ]]; NEWB=${3:?17822b29 BUILD_ID}; [[ $NEWB =~ ^[A-Za-z0-9_-]{1,64}$ ]]
    echo "== R1 rollback verify $(date -u +%FT%TZ)"
    [ "$(systemctl show afldb -p InvocationID --value)" = "$INV" ]; echo "PASS running invocation = the owner's rollback restart $INV"
    F=0
    "$N" deploy/release.mjs status --expect "$OLD" --confirm-restart-invocation "$INV" && echo "PASS 1 status --expect $OLD" || { echo "FAIL 1"; F=1; }
    bash deploy/post-install-check.sh --confirm-restart-invocation "$INV" "$OLD" "$NEWB" && echo "PASS 2 post-install-check (17822b29 build answers 404)" || { echo "FAIL 2"; F=1; }
    serving_identity afldb "$(realpath "$ROOT/releases/$OLD")" "$SUP_OLD" && echo "PASS 3 identity: 7d92042f supervisor in releases/$OLD, workers 1 and 2" || { echo "FAIL 3"; F=1; }
    OUT=$(npx --no-install tsx tools/maintenance/revalidate-season.ts --season 2026 2>&1) && RC=0 || RC=$?
    printf '%s\n' "$OUT" | tail -n 3
    revalidate_ordinals "$OUT" "$RC" 2026 && echo "PASS 4 season refresh 2/2 on the rolled-back release" || echo "RECORD 4 season refresh did not pass (record; owner; never restart again)"
    [ $F = 0 ] && echo "ROLLBACK RESULT VERIFIED (1-3): now r1-rawhead.sh check and S9 with $(cut -d- -f2- <<< "$OLD")" || { echo "ROLLBACK RESULT VERIFY FAIL: owner; site state as printed"; exit 1; };;
  *) echo "usage: links | verify <InvocationID> <17822b29 BUILD_ID>"; exit 2;;
esac
}
if [ "${R1_LIB_ONLY:-0}" = 1 ]; then return 0 2>/dev/null || exit 0; fi
main "$@" < /dev/null
