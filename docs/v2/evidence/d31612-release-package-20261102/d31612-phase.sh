#!/bin/bash
# D-316-12 UI release (rev 3): PRODUCTION phases, run as `arm` on afldb-prod. No sudo anywhere in this file.
#   bash /home/arm/d31612/d31612-phase.sh <phase>
#     pa          preflight, strictly read-only (also proves the first scheduled run has fired and finished)
#     d1          capture the preserved-state baseline, then fast-forward the checkout to H  (first change)
#     d2          build revision R (inside tmux; once)                                        (adds a release dir)
#     d3a         promote the new release (links only; the running service is unchanged)
#     d3c         after the OWNER's restart: identity, health and preservation checks, read-only
#     probe       read-only state probe (what recovery starts with); exits with the probe's own status
#     r2          recovery: links back to OLD_ID, before any restart
#     r3-links    recovery: links back to OLD_ID, after a restart onto the new release
#     r3-verify   after the OWNER's recovery restart: OLD_ID serving; trigger, .env, timer state equal the d1 baseline
# Every value that matters is a literal below; nothing is taken from the caller. A failed assertion prints STOP and
# `D31612 <phase> FAIL` (exit 1) and the phase does nothing further; a phase never adjusts an expected value.
# Writes (all new, none overwrites anything): /home/arm/d31612/{baseline.txt,new-id.txt,d2-build.log}, the checkout
# fast-forward (d1), the release directory (d2), the two release links (d3a, r2, r3-links). Nothing else.
set -u -o pipefail
export LC_ALL=C
umask 077
PHASE=${1:-}
R=a0b1080f5b98aee7191894c138be27bb524c7b1b
H=d00e07e37566e92b35a34e62a1ff03e173715e87
PROD_HEAD=924ff273261834e4112e3f41b61ceeab55427534
OLD_ID=ea98a35f2061--vY0EFS0DdR-TiPkxTZz6
OLD_PREV=fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy
ROOT=/home/arm/afldb-releases
CHK=/home/arm/projects/afldb
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
D=/home/arm/d31612
NEWFILE=$D/new-id.txt; BUILDLOG=$D/d2-build.log; BASEFILE=$D/baseline.txt
OBS=$D/c5-observe-20261102-r3.sh;  OBS_SHA=f3362f881f0f1c8aae71c4f88ae33a0c65e9b7f4c0ef79dbf2fc152371b8d169
GUARD=$D/c5-proc-guard-20261102.sh; GUARD_SHA=be473b78e4a24d87aa6e8f0cb2400f3d34934ba296712c59e99fd526421b1046
PKGD=docs/v2/evidence/d31612-release-package-20261102
PKGG=docs/v2/evidence/gap006-release-package-20261101
MATCH_TIMER=afldb-settle-afl-api.timer; MATCH_SVC=afldb-settle-afl-api.service
die() { echo "STOP: $*"; echo "D31612 ${PHASE:-?} FAIL"; exit 1; }
ck() { local m=$1; shift; "$@" > /dev/null 2>&1 || die "$m"; }
probe() { bash "$CHK/$PKGG/state-probe.sh" "$@"; }
penv() { tr '\0' '\n' < "/proc/$1/environ" 2>/dev/null | grep -c "$2" || true; }    # count only: values are never printed
bv() { sed -n "s/^$1=//p" "$BASEFILE"; }
# Preserved state, compared with the d1 baseline after a restart (d3c: onto NEW_ID; r3-verify: back onto OLD_ID). Read-only; counts only.
#   $1 = the release id the restarted process must be serving
preserved() {
  local want=$1 pid
  ck "no baseline $BASEFILE (d1 did not write one): preservation cannot be proven" [ -s "$BASEFILE" ]
  pid=$(systemctl show -p MainPID --value afldb); { [ -n "$pid" ] && [ "$pid" != 0 ]; } || die "no MainPID"
  ck "the service did not restart (MainPID unchanged since the baseline)" [ "$pid" != "$(bv main_pid)" ]
  ck "serving process is not $want" [ "$(readlink "/proc/$pid/cwd")" = "$ROOT/releases/$want" ]
  ck "match timer next elapse changed" [ "$(systemctl show -p NextElapseUSecRealtime --value "$MATCH_TIMER")" = "$(bv match_timer_next)" ]
  ck "match timer last trigger changed" [ "$(systemctl show -p LastTriggerUSec --value "$MATCH_TIMER")" = "$(bv match_timer_last)" ]
  ck "timer enablement changed" [ "$(systemctl is-enabled "$MATCH_TIMER" 2>&1)/$(systemctl is-enabled afldb-settle-afl-api-brownlow.timer 2>&1)/$(systemctl is-enabled afldb-settle-afltables.timer 2>&1)" = "$(bv timers_enabled)" ]
  ck ".env trigger line count changed" [ "$(grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' .env)" = "$(bv dotenv_trigger_exact)" ]
  ck "the restarted process environment is not readable" [ -r "/proc/$pid/environ" ]
  ck "EFFECTIVE AFLDB_SETTLE_TRIGGER=systemd count in the restarted process is not exactly 1" [ "$(penv "$pid" '^AFLDB_SETTLE_TRIGGER=systemd$')" = 1 ]
  ck "any-mention count of the trigger in the restarted process differs from the baseline" [ "$(penv "$pid" '^AFLDB_SETTLE_TRIGGER')" = "$(bv process_trigger_any)" ]
}

[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || { echo "STOP: run on afldb-prod as arm"; exit 3; }
cd "$CHK" || die "no checkout $CHK"
echo "== d31612 $PHASE $(date -u +%FT%TZ)  (host local $(date '+%F %T %Z'); AEDT $(TZ=Australia/Sydney date '+%F %T'))"
echo "   R=$R"; echo "   H=$H"; echo "   OLD_ID=$OLD_ID"

case "$PHASE" in
pa)
  ck "checkout HEAD is not PROD_HEAD $PROD_HEAD" [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]
  ck "checkout is not clean" [ -z "$(git status --porcelain)" ]
  ck "a release lock exists" [ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ]
  ck "current is not OLD_ID" [ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]
  ck "previous is not OLD_PREV" [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
  for id in "$OLD_ID" "$OLD_PREV"; do ck "missing release dir $id" [ -d "$ROOT/releases/$id" ]; done
  "$N" deploy/release.mjs status || die "release.mjs status is not PASS"
  "$N" deploy/release.mjs verify "$OLD_ID" || die "OLD_ID no longer matches its manifest"
  avail=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo); echo "MemAvailable ${avail} MB"; ck "MemAvailable under 2100 MB" [ "$avail" -ge 2100 ]
  free_kb=$(df --output=avail -k /home/arm | tail -n 1 | tr -d ' '); echo "free ${free_kb} KB"; ck "free disk under 6 GB" [ "$free_kb" -ge 6291456 ]
  ck "pg_dump/rsync/restore is running" [ -z "$(pgrep -f '[p]g_dump|[r]sync|[r]estore' || true)" ]
  limit=$(( $(date +%s) + 100 * 60 ))                                  # no afldb timer inside the 90-minute window plus margin
  for t in $(systemctl list-timers --all --no-legend | awk '{for (i = 1; i <= NF; i++) if ($i ~ /^afldb.*\.timer$/) print $i}' | sort -u); do
    n=$(systemctl show -p NextElapseUSecRealtime --value "$t"); echo "timer $t next: ${n:-none}"
    [ -z "$n" ] || [ "$(date -d "$n" +%s)" -gt "$limit" ] || die "timer $t fires inside the window"
  done
  ck "an afldb cron entry exists (judge it)" [ -z "$(crontab -l 2>/dev/null | grep -i afldb || true)" ]
  # G1: the first scheduled run has fired AND finished (the record and its review are the workstation gate G0)
  LAST=$(systemctl show -p LastTriggerUSec --value "$MATCH_TIMER"); EXITTS=$(systemctl show -p ExecMainExitTimestamp --value "$MATCH_SVC")
  echo "match timer LastTriggerUSec=[${LAST}] service ExecMainExit=[${EXITTS}] ActiveState=[$(systemctl show -p ActiveState --value "$MATCH_SVC")]"
  [ -n "$LAST" ] && [ -n "$EXITTS" ] || die "G1: the first scheduled run has not fired and finished"
  ck "G1: the match service is not inactive" [ "$(systemctl show -p ActiveState --value "$MATCH_SVC")" = inactive ]
  # preserved inputs: the trigger in the file AND in the serving process (the effective value), counted, never printed
  PID=$(systemctl show -p MainPID --value afldb); { [ -n "$PID" ] && [ "$PID" != 0 ]; } || die "no MainPID"
  ck "serving process is not OLD_ID" [ "$(readlink "/proc/$PID/cwd")" = "$ROOT/releases/$OLD_ID" ]
  ck ".env AFLDB_SETTLE_TRIGGER=systemd line count is not 1" [ "$(grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' .env)" = 1 ]
  ck "the serving process environment is not readable" [ -r "/proc/$PID/environ" ]
  ck "effective AFLDB_SETTLE_TRIGGER=systemd count in the process is not 1" [ "$(penv "$PID" '^AFLDB_SETTLE_TRIGGER=systemd$')" = 1 ]
  ck "match timer is not enabled" [ "$(systemctl is-enabled "$MATCH_TIMER")" = enabled ]
  ck "Brownlow timer is not disabled" [ "$(systemctl is-enabled afldb-settle-afl-api-brownlow.timer 2>&1 || true)" = disabled ]
  ck "AFL Tables timer is not disabled" [ "$(systemctl is-enabled afldb-settle-afltables.timer 2>&1 || true)" = disabled ]
  # the packaged read-only helper, pinned by bytes, against the unchanged checkout (it asserts the setting is still true)
  ck "helper $OBS is missing or not the pinned bytes" [ "$(sha256sum < "$OBS" | cut -c1-64)" = "$OBS_SHA" ]
  ck "helper $GUARD is missing or not the pinned bytes" [ "$(sha256sum < "$GUARD" | cut -c1-64)" = "$GUARD_SHA" ]
  bash "$OBS" timer "$PROD_HEAD" || die "the read-only timer/setting helper did not PASS"
  probe "$OLD_ID" - --expect OLD_SERVING || die "state is not OLD_SERVING"
  echo "D31612 pa PASS" ;;

d1)
  ck "checkout HEAD is not PROD_HEAD" [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]
  ck "checkout is not clean" [ -z "$(git status --porcelain)" ]
  # a baseline from an earlier d1 that stopped before the fast-forward is kept under a new name, never overwritten
  [ ! -e "$BASEFILE" ] || mv -n "$BASEFILE" "$BASEFILE.$(date -u +%Y%m%dT%H%M%SZ)" || die "cannot set the old baseline aside"
  PID=$(systemctl show -p MainPID --value afldb)
  { echo "captured_utc=$(date -u +%FT%TZ)"; echo "main_pid=$PID"
    echo "current=$(readlink "$ROOT/current")"; echo "previous=$(readlink "$ROOT/previous")"
    echo "match_timer_next=$(systemctl show -p NextElapseUSecRealtime --value "$MATCH_TIMER")"
    echo "match_timer_last=$(systemctl show -p LastTriggerUSec --value "$MATCH_TIMER")"
    echo "timers_enabled=$(systemctl is-enabled "$MATCH_TIMER" 2>&1)/$(systemctl is-enabled afldb-settle-afl-api-brownlow.timer 2>&1)/$(systemctl is-enabled afldb-settle-afltables.timer 2>&1)"
    echo "dotenv_trigger_exact=$(grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' .env)"
    echo "process_trigger_exact=$(penv "$PID" '^AFLDB_SETTLE_TRIGGER=systemd$')"
    echo "process_trigger_any=$(penv "$PID" '^AFLDB_SETTLE_TRIGGER')"
  } > "$BASEFILE" || die "cannot write $BASEFILE"
  cat "$BASEFILE"
  ck "baseline: process trigger is not exactly 1" grep -qx 'process_trigger_exact=1' "$BASEFILE"
  git fetch origin || die "git fetch failed"
  ck "origin/main is not H" [ "$(git rev-parse refs/remotes/origin/main)" = "$H" ]
  ck "R is not in the checkout" git cat-file -e "$R^{commit}"
  git show "$H:$PKGD/static-delta-check.sh" | bash -s -- "$H" || die "static delta check failed on production"
  git merge --ff-only "$H" || die "fast-forward refused"
  ck "HEAD is not H after the merge" [ "$(git rev-parse HEAD)" = "$H" ]
  ck "checkout is not clean after the merge" [ -z "$(git status --porcelain)" ]
  "$N" deploy/release.mjs status || die "release.mjs status is not PASS after the fast-forward"
  probe "$OLD_ID" - --expect OLD_SERVING || die "state is not OLD_SERVING"
  echo "D31612 d1 PASS" ;;

d2)
  ck "NEWFILE exists (d2 runs once)" [ ! -e "$NEWFILE" ]
  ck "checkout HEAD is not H" [ "$(git rev-parse HEAD)" = "$H" ]
  ck "checkout is not clean" [ -z "$(git status --porcelain)" ]
  ck "no baseline (run d1 first)" [ -s "$BASEFILE" ]
  ck "not inside tmux" [ -n "${TMUX:-}" ]
  probe "$OLD_ID" - --expect OLD_SERVING || die "state is not OLD_SERVING"
  "$N" deploy/release.mjs build --checkout "$CHK" --revision "$R" \
    --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons \
    --typecheck-evidence "npm run typecheck exit 0 (next typegen && tsc --noEmit) on Linux (streamanator, node v22.23.2) for git archive of a0b1080f5b98 (4146/4146 blobs verified); 2026-11-02; docs/v2/d31612-linux-qualification-2026-11-02.md" \
    2>&1 | tee "$BUILDLOG"
  bst=("${PIPESTATUS[@]}")                                             # captured at once: both the build and the tee must have exited 0
  { [ "${bst[0]:-x}" = 0 ] && [ "${bst[1]:-x}" = 0 ]; } || die "the build pipeline failed (build exit ${bst[0]:-?}, tee exit ${bst[1]:-?}); nothing promoted, current/previous untouched, $NEWFILE not written"
  NEW_ID=$(sed -n 's/^release: RELEASE READY \([^ ]*\) .*$/\1/p' "$BUILDLOG" | tail -n 1)
  [[ $NEW_ID =~ ^a0b1080f5b98-[A-Za-z0-9_-]+$ ]] || die "no RELEASE READY a0b1080f5b98-<BUILD_ID> line in the build log (nothing promoted; current/previous untouched)"
  "$N" deploy/release.mjs verify "$NEW_ID" || die "new release failed its manifest check"
  ck "a build moved current" [ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]
  ck "a build moved previous" [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
  probe "$OLD_ID" "$NEW_ID" --expect OLD_SERVING || die "state is not OLD_SERVING"
  echo "$NEW_ID" > "$NEWFILE" || die "cannot write NEWFILE"
  echo "D31612 d2 PASS NEW_ID=$NEW_ID" ;;

d3a)
  NEW_ID=$(cat "$NEWFILE" 2>/dev/null || true); [[ $NEW_ID =~ ^a0b1080f5b98-[A-Za-z0-9_-]+$ ]] || die "NEWFILE does not hold a new release id"
  ck "checkout HEAD is not H" [ "$(git rev-parse HEAD)" = "$H" ]
  probe "$OLD_ID" "$NEW_ID" --expect OLD_SERVING || die "state is not OLD_SERVING"
  "$N" deploy/release.mjs promote "$NEW_ID" || die "promote refused (no link moved; run probe)"
  probe "$OLD_ID" "$NEW_ID" --expect NEW_SELECTED_OLD_RUNNING || die "state is not NEW_SELECTED_OLD_RUNNING (run probe)"
  ck "previous is not OLD_ID after the promotion" [ "$(readlink "$ROOT/previous")" = "releases/$OLD_ID" ]
  echo "D31612 d3a PASS  -> the OWNER now runs: sudo systemctl restart afldb" ;;

d3c)
  NEW_ID=$(cat "$NEWFILE" 2>/dev/null || true); [[ $NEW_ID =~ ^a0b1080f5b98-[A-Za-z0-9_-]+$ ]] || die "NEWFILE does not hold a new release id"
  bash deploy/post-install-check.sh "$NEW_ID" || die "post-install check did not PASS"
  probe "$OLD_ID" "$NEW_ID" --expect NEW_SERVING || die "state is not NEW_SERVING"
  jl=$(journalctl -u afldb --since '15 minutes ago' --no-pager 2>/dev/null | grep -F 'serving build' | tail -n 1 || true)
  if [ -z "$jl" ]; then echo "NOTE: no 'serving build' journal line visible to arm; the process cwd and the probe below carry the identity (the owner may read the journal)"
  elif [[ $jl == *"release $NEW_ID revision a0b1080f5b98"* ]]; then echo "journal: serving build names $NEW_ID"
  else die "the latest 'serving build' journal line does not name $NEW_ID: $jl"; fi
  # preservation against the d1 baseline
  ck "previous is not OLD_ID" [ "$(readlink "$ROOT/previous")" = "releases/$OLD_ID" ]
  preserved "$NEW_ID"
  bash "$OBS" timer "$H" || die "the read-only timer/setting helper did not PASS (setting, timers, no settle process)"
  echo "D31612 d3c PASS" ;;

probe)
  # Read-only. The probe's own diagnostics are printed as it makes them; its exit status is this phase's exit status.
  NEW_ID=$(cat "$NEWFILE" 2>/dev/null || echo -)
  probe "$OLD_ID" "$NEW_ID"; rc=$?
  [ "$rc" = 0 ] || { echo "D31612 probe FAIL (the state probe exited $rc; its output is above)"; exit "$rc"; }
  exit 0 ;;

r2)
  NEW_ID=$(cat "$NEWFILE" 2>/dev/null || true); [[ $NEW_ID =~ ^a0b1080f5b98-[A-Za-z0-9_-]+$ ]] || die "NEWFILE does not hold a new release id"
  probe "$OLD_ID" "$NEW_ID" --expect NEW_SELECTED_OLD_RUNNING || die "r2 applies only to NEW_SELECTED_OLD_RUNNING (run probe)"
  "$N" deploy/release.mjs rollback --to "$OLD_ID" || die "rollback --to OLD_ID refused (state R5: change nothing)"
  probe "$OLD_ID" "$NEW_ID" --expect OLD_SERVING || die "state is not OLD_SERVING after r2"
  bash deploy/post-install-check.sh "$OLD_ID" || die "post-install check on OLD_ID did not PASS"
  echo "D31612 r2 PASS" ;;

r3-links)
  NEW_ID=$(cat "$NEWFILE" 2>/dev/null || true); [[ $NEW_ID =~ ^a0b1080f5b98-[A-Za-z0-9_-]+$ ]] || die "NEWFILE does not hold a new release id"
  ck "roll back only when NEW_ID is the selected release" [ "$(readlink "$ROOT/current")" = "releases/$NEW_ID" ]
  "$N" deploy/release.mjs rollback --to "$OLD_ID" || die "rollback --to OLD_ID refused (state R5: change nothing)"
  ck "current is not OLD_ID" [ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]
  ck "previous is not NEW_ID" [ "$(readlink "$ROOT/previous")" = "releases/$NEW_ID" ]
  echo "D31612 r3-links PASS  -> the OWNER now runs: sudo systemctl restart afldb  (on start-limit-hit: sudo systemctl reset-failed afldb && sudo systemctl start afldb)" ;;

r3-verify)
  NEW_ID=$(cat "$NEWFILE" 2>/dev/null || true); [[ $NEW_ID =~ ^a0b1080f5b98-[A-Za-z0-9_-]+$ ]] || die "NEWFILE does not hold a new release id"
  bash deploy/post-install-check.sh "$OLD_ID" || die "post-install check on OLD_ID did not PASS"
  probe "$OLD_ID" "$NEW_ID" --expect OLD_SERVING || die "state is not OLD_SERVING"
  ck "previous is not NEW_ID after the recovery" [ "$(readlink "$ROOT/previous")" = "releases/$NEW_ID" ]
  preserved "$OLD_ID"          # restarted process = OLD_ID; exactly one effective trigger; .env, match-timer elapse/last-trigger and enablement equal the d1 baseline
  bash "$OBS" timer "$H" || die "the read-only timer/setting helper did not PASS"
  echo "D31612 r3-verify PASS: OLD_ID serving; timer, setting and trigger preserved" ;;

*) echo "usage: bash d31612-phase.sh pa|d1|d2|d3a|d3c|probe|r2|r3-links|r3-verify"; exit 2 ;;
esac
