#!/usr/bin/env bash
# ISSUE-334/335 application release: pinned phase script (production, as arm; this script never uses sudo).
# Contract: docs/v2/issue334-335-release-approval-2026-11-05.md sections 5 to 8, as approved by the owner on 2026-11-05.
# Package blocks are verbatim except: (a) D4 uses the owner's single-grep amendment; (b) the cutover phase adds
# read-only prechecks (owner's condition) before the verbatim D3a block. Usage: bash phase.sh <phase>
R=0f251c2daa8d7c6c38eacd559376dde41e010fd9
H=f32d44f07b3f81129aad4cce2feef1629a37fef1
PKGD=docs/v2/evidence/issue334-335-release-20261105
PKGG=docs/v2/evidence/gap006-release-package-20261101
OLD_ID=a0b1080f5b98-B8kdpO6PO1tUCHus0j1za
OLD_PREV=ea98a35f2061--vY0EFS0DdR-TiPkxTZz6
PROD_HEAD=d00e07e37566e92b35a34e62a1ff03e173715e87
ROOT=/home/arm/afldb-releases
CHK=/home/arm/projects/afldb
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
NEWFILE=/home/arm/i334-335-new-id.txt
LOGD=/home/arm/i334-335
SELF=$LOGD/phase.sh
TMUXS=i334d2
DEADLINE_UTC=2026-11-06T06:00:00Z            # 17:00 AEDT 6 Nov 2026: owner's cutover deadline
TIMER_BASE='Fri 2026-11-06 05:07:25 AEDT'    # P-A 12:08:59 AEDT 5 Nov: afldb-settle-afl-api.timer next elapse
TRIG_BASE='Thu 2026-11-05 05:03:41 AEDT'     # P-A: its LastTriggerUSec

phase=${1:-}
echo "== i334-335 $phase $(date -u +%FT%TZ) (AEDT $(TZ=Australia/Melbourne date '+%F %T'))"

timer_margin() {  # every afldb timer's next elapse is more than 100 minutes away (package P-A loop)
  local now limit t n
  now=$(date +%s); limit=$((now + 100 * 60))
  for t in $(systemctl list-timers --all --no-legend | awk '{for (i = 1; i <= NF; i++) if ($i ~ /^afldb.*\.timer$/) print $i}' | sort -u); do
    n=$(systemctl show -p NextElapseUSecRealtime --value "$t"); echo "timer $t next: ${n:-none}"
    [ -z "$n" ] || [ "$(date -d "$n" +%s)" -gt "$limit" ] || return 1
  done
}

case "$phase" in

d1)
( set -euo pipefail; [[ $H =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]
  git fetch origin
  [ "$(git rev-parse refs/remotes/origin/main)" = "$H" ]
  git cat-file -e "$R^{commit}"
  git show "$H:$PKGD/static-delta-check.sh" | bash -s -- "$H"                 # enforced on production
  git merge --ff-only "$H"
  [ "$(git rev-parse HEAD)" = "$H" ]; [ -z "$(git status --porcelain)" ]
  "$N" deploy/release.mjs status                                              # still STATUS PASS
  bash "$PKGG/state-probe.sh" "$OLD_ID" - --expect OLD_SERVING
  echo "D1 PASS"
)
rc=$?; [ $rc = 0 ] || echo "D1 FAILED rc=$rc"; exit $rc ;;

d2-launch)   # start D2 once, detached in tmux
( set -euo pipefail
  [ ! -e "$NEWFILE" ]; [ ! -e "$LOGD/d2.log" ]
  if tmux has-session -t "$TMUXS" 2>/dev/null; then echo "build session already exists"; exit 1; fi
  tmux new-session -d -s "$TMUXS" "bash $SELF d2 > $LOGD/d2.log 2>&1"
  echo "D2 launched in tmux session $TMUXS"
)
exit $? ;;

d2-wait)     # one SSH session: wait for the tmux build to end (25 min cap), then show its log
for i in $(seq 1 150); do tmux has-session -t "$TMUXS" 2>/dev/null || break; sleep 10; done
tmux has-session -t "$TMUXS" 2>/dev/null && echo "D2 STILL RUNNING after wait cap"
cat "$LOGD/d2.log"; exit 0 ;;

d2)
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ ! -e "$NEWFILE" ]
  [ "$(git rev-parse HEAD)" = "$H" ]; [ -z "$(git status --porcelain)" ]
  bash "$PKGG/state-probe.sh" "$OLD_ID" - --expect OLD_SERVING
  "$N" deploy/release.mjs build --checkout "$CHK" --revision "$R" \
    --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons \
    --typecheck-evidence "next typegen && tsc --noEmit exit 0 on Linux (streamanator, node v22.23.2) for a verified shallow clone of 0f251c2daa8d; 2026-11-05; docs/v2/issue334-335-release-approval-2026-11-05.md section 3" \
    2>&1 | tee /home/arm/i334-335-d2-build.log
  NEW_ID=$(sed -n 's/^release: RELEASE READY \([^ ]*\) .*$/\1/p' /home/arm/i334-335-d2-build.log | tail -n 1)
  [[ $NEW_ID =~ ^0f251c2daa8d-[A-Za-z0-9_-]+$ ]]
  "$N" deploy/release.mjs verify "$NEW_ID"
  [ "$(readlink "$ROOT/current")"  = "releases/$OLD_ID" ]                     # a build never moves a link
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  echo "$NEW_ID" > "$NEWFILE"; echo "D2 PASS NEW_ID=$NEW_ID"
)
rc=$?; [ $rc = 0 ] || echo "D2 FAILED rc=$rc (STOP: no retry; current/previous untouched)"; exit $rc ;;

v)           # post-build verification (read-only): the release, both links unchanged, OLD_SERVING
( set -euo pipefail; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^0f251c2daa8d-[A-Za-z0-9_-]+$ ]]; echo "NEW_ID $NEW_ID"
  [ "$(git rev-parse HEAD)" = "$H" ]; [ -z "$(git status --porcelain)" ]
  out=$("$N" deploy/release.mjs verify "$NEW_ID" 2>&1); echo "$out"
  grep -qF "revision $R," <<<"$out"
  [ "$(readlink "$ROOT/current")"  = "releases/$OLD_ID" ]
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
  "$N" deploy/release.mjs status
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  grep -rqF -- 'active manual coach assignment' "$ROOT/releases/$NEW_ID/.next/standalone/.next/server"
  echo "ISSUE-335 string present in NEW_ID bundle"
  if grep -rqF -- 'active manual coach assignment' "$ROOT/releases/$OLD_ID/.next/standalone/.next/server"; then echo "note: string also in OLD_ID"; else echo "string absent from OLD_ID (as expected)"; fi
  ls -1 "$ROOT/releases"
  echo "V PASS NEW_ID=$NEW_ID"
)
rc=$?; [ $rc = 0 ] || echo "V FAILED rc=$rc"; exit $rc ;;

cutover)     # owner-initiated: prechecks, then the packaged D3a promotion. The owner restarts only on a final 'D3a PASS'.
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ "$(date +%s)" -lt "$(date -d "$DEADLINE_UTC" +%s)" ] || { echo "PRECHECK FAIL: past the 17:00 AEDT 6 Nov deadline"; exit 1; }
  [ "$(git rev-parse HEAD)" = "$H" ]; [ -z "$(git status --porcelain)" ]; echo "checkout at H, clean"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^0f251c2daa8d-[A-Za-z0-9_-]+$ ]]; echo "NEW_ID $NEW_ID"
  out=$("$N" deploy/release.mjs verify "$NEW_ID" 2>&1); echo "$out"; grep -qF "revision $R," <<<"$out"
  "$N" deploy/release.mjs verify "$OLD_ID"
  [ "$(readlink "$ROOT/current")"  = "releases/$OLD_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]; echo "links current=OLD_ID previous=OLD_PREV"
  "$N" deploy/release.mjs status
  [ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ]
  [ -z "$(pgrep -f '[p]g_dump|[r]sync|[r]estore' || true)" ]
  [ -z "$(pgrep -f '[r]elease\.mjs' || true)" ]
  if tmux has-session -t "$TMUXS" 2>/dev/null; then echo "PRECHECK FAIL: build session still present"; exit 1; fi
  [ -z "$(crontab -l 2>/dev/null | grep -i afldb || true)" ]; echo "no conflicts: no locks, dump/rsync/restore, release.mjs, build session or afldb cron"
  timer_margin; echo "timer margin: no afldb timer within 100 minutes"
  [ "$(grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' .env)" = 1 ]
  [ "$(systemctl is-enabled afldb-settle-afl-api.timer)" = enabled ]
  [ "$(systemctl is-enabled afldb-settle-afl-api-brownlow.timer 2>&1 || true)" = disabled ]
  [ "$(systemctl is-enabled afldb-settle-afltables.timer 2>&1 || true)" = disabled ]
  mono=$(systemctl show -p ActiveEnterTimestampMonotonic --value afldb); up=$(cut -d. -f1 /proc/uptime)
  [ $((up - mono / 1000000)) -ge 30 ]; echo "afldb last start $((up - mono / 1000000)) s ago"
  echo "CUTOVER PRECHECK PASS"
  # ---- packaged D3a, verbatim ----
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  "$N" deploy/release.mjs promote "$NEW_ID"          # previous becomes OLD_ID; the running service is unchanged until it restarts
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SELECTED_OLD_RUNNING
  [ "$(readlink "$ROOT/previous")" = "releases/$OLD_ID" ]
  echo "D3a PASS"
)
rc=$?; [ $rc = 0 ] || echo "CUTOVER FAILED rc=$rc: DO NOT RESTART"; exit $rc ;;

probe)       # section 8 probe, read-only
( set -u; cd "$CHK"; NEW_ID=$(cat "$NEWFILE" 2>/dev/null || echo -); bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" )
exit $? ;;

d3c)
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^0f251c2daa8d-[A-Za-z0-9_-]+$ ]]
  bash deploy/post-install-check.sh "$NEW_ID"        # waits up to 60 s for health; prints POST-INSTALL CHECK PASS or FAIL
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SERVING
  journalctl -u afldb --since '10 minutes ago' --no-pager | grep -F 'serving build' | tail -n 1 | grep -q "release $NEW_ID revision 0f251c2daa8d"
  [ "$(grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' .env)" = 1 ]
  bash /home/arm/c5-observe-20261102-r3.sh timer "$H"   # read-only: match timer enabled+active with a future elapse, Brownlow and AFL Tables timers off, setting still true
  echo "D3c PASS"
)
rc=$?; [ $rc = 0 ] || echo "D3c FAILED rc=$rc"
echo "-- serving-build journal line"; journalctl -u afldb --since '15 minutes ago' --no-pager | grep -F 'serving build' | tail -n 1
echo "-- preservation vs P-A baseline (timer '$TIMER_BASE', last trigger '$TRIG_BASE')"
systemctl show -p NextElapseUSecRealtime -p LastTriggerUSec afldb-settle-afl-api.timer
nx=$(systemctl show -p NextElapseUSecRealtime --value afldb-settle-afl-api.timer); lt=$(systemctl show -p LastTriggerUSec --value afldb-settle-afl-api.timer)
if [ "$nx" = "$TIMER_BASE" ] || [ "$lt" != "$TRIG_BASE" ]; then echo "match timer schedule preserved (unchanged, or advanced only by a normal firing)"; else echo "PRESERVATION FAIL: match timer next elapse changed without a firing"; rc=1; fi
systemctl show -p MainPID -p ActiveEnterTimestamp -p NRestarts afldb
exit $rc ;;

d4)
# Owner amendment (2026-11-05): the unique-string check is a single grep invocation (no grep -rl | grep -q under pipefail).
( set -euo pipefail; cd "$CHK"; NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^0f251c2daa8d-[A-Za-z0-9_-]+$ ]]
  "$N" deploy/release.mjs verify "$NEW_ID"                                    # the serving bytes match the manifest built from R
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SERVING          # the running process is NEW_ID (D3c: journal names revision 0f251c2daa8d)
  grep -rqF -- 'active manual coach assignment' "$ROOT/releases/$NEW_ID/.next/standalone/.next/server"   # ISSUE-335 text: exists only from R on
  echo "D4 PASS (serving revision R, manifest-verified; refusals proven on Linux, not on production)"
)
rc=$?; [ $rc = 0 ] || echo "D4 FAILED rc=$rc"; exit $rc ;;

r2)          # recovery R2 (links only, no restart), verbatim
( set -euo pipefail; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^0f251c2daa8d-[A-Za-z0-9_-]+$ ]]
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect NEW_SELECTED_OLD_RUNNING
  "$N" deploy/release.mjs rollback --to "$OLD_ID"
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  bash deploy/post-install-check.sh "$OLD_ID"
  echo "R2 PASS"
)
exit $? ;;

r3-links)    # recovery R3 first half (links), verbatim; the owner's restart follows
( set -euo pipefail; cd "$CHK"
  NEW_ID=$(cat "$NEWFILE"); [[ $NEW_ID =~ ^0f251c2daa8d-[A-Za-z0-9_-]+$ ]]
  [ "$(readlink "$ROOT/current")" = "releases/$NEW_ID" ]    # roll back only when NEW_ID is the selected release
  "$N" deploy/release.mjs rollback --to "$OLD_ID"           # current -> OLD_ID, previous -> NEW_ID (retained)
  [ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$NEW_ID" ]
  echo "R3 links restored; the owner's restart is owed"
)
exit $? ;;

r3-verify)   # recovery R3 second half, verbatim, after the owner's restart
( set -euo pipefail; cd "$CHK"; NEW_ID=$(cat "$NEWFILE")
  bash deploy/post-install-check.sh "$OLD_ID"
  bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID" --expect OLD_SERVING
  bash /home/arm/c5-observe-20261102-r3.sh timer "$H"
  echo "R3 PASS: OLD_ID serving, timer and setting preserved"
)
exit $? ;;

*) echo "unknown phase '$phase'"; exit 2 ;;
esac
