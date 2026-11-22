#!/usr/bin/env bash
# ISSUE-352 regression harness. Disposable Linux fixtures only (run as arm on streamanator, or any Linux with GNU tools).
# Usage: bash t-352-scheduled-origin.sh <source root extracted from git>     No live ops, no cron install, no production contact.
# Every case runs the REAL entry points: the daily wrapper, scheduled-pull-evidence.sh via r6-offhost-verify.sh and
# a2-cron-observe.sh, a2-cron-install.sh and a2-helper-install.sh. The journal fixture is Monday's OBSERVED format: the CMD
# record holds the command only (no schedule fields) and its PID is the job shell, not the cron-named process above it.
set -uo pipefail
ROOT=${1:?source root}; B=$ROOT/docs/v2/evidence/backlog-20261121; K=$B/kits; A=$B/a1a2-20261124
W=$(mktemp -d "${TMPDIR:-/tmp}/afldb-fix352-XXXXXX"); trap 'rm -rf -- "$W"' EXIT
mkdir -p "$W/ops/state" "$W/dest" "$W/bin" "$W/stage"
CMD='AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh'
LINE="10 3 * * * $CMD"
MARK='# AFLDB-A2-r3: ISSUE-352 daily off-host pull (owner decision 3, 2026-11-22); installed by a2-cron-install.sh'
DAY=2026-11-18; D=afldb_prod-20261118-022125.dump
T0=$(date -d '2026-11-17T16:10:01Z' +%s)          # Wed 18 Nov 03:10:01 +11:00
DPID=3729645; CCHILD=3729635; CDAEMON=800
REAL_DATE=$(command -v date)
export REAL_DATE

# ---- shims (PATH-first): a controllable clock, a table-driven ps, an arm identity, a file-aware crontab ----
mkshims() {
cat > "$W/bin/date" <<'EOF'
#!/bin/sh
case " $* " in *" -d "*) exec "$REAL_DATE" "$@";; esac
exec "$REAL_DATE" -d "@${FAKE_NOW:?}" "$@"
EOF
cat > "$W/bin/ps" <<'EOF'
#!/bin/sh
fld=$2; pid=$4
row=$(awk -v p="$pid" '$1==p' "$PS_TAB")
if [ -z "$row" ]; then ppid=$PS_PARENT; comm=sh; start=$((FAKE_NOW - 1)); else set -- $row; ppid=$2; comm=$3; start=$4; fi
case $fld in comm=) echo "$comm";; ppid=) echo "$ppid";; etimes=) echo $((FAKE_NOW - start));; esac
EOF
cat > "$W/bin/id" <<'EOF'
#!/bin/sh
case "$*" in *-un*) echo arm;; *) exec /usr/bin/id "$@";; esac
EOF
cat > "$W/bin/crontab" <<'EOF'
#!/bin/sh
if [ "$1" = -l ]; then [ -f "$FIXT_CT" ] || exit 1; cat "$FIXT_CT"; else cp "$1" "$FIXT_CT"; fi
EOF
chmod +x "$W"/bin/*
}
mkshims
export FIXT_CT=$W/ct PS_TAB=$W/ps.tab
export AFLDB_OPS=$W/ops AFLDB_OFFHOST_DEST=$W/dest CRON_LOG_FILE=$W/cron CRONTAB_BIN=$W/bin/crontab
export AFLDB_CRON_EXPECT_HOST=$(hostname) AFLDB_CRON_MIN_LINES=0 HOME=$W
PATHY="$W/bin:$PATH"; export FAKE_NOW=$((T0+1200))

pass=0; fails=0
expect() { local want=$1 name=$2 rc=0; shift 2; "$@" > "$W/result" 2>&1 || rc=$?; cat "$W/result"; echo "$name actual_exit=$rc expected=$want"
  if [ "$rc" = "$want" ]; then pass=$((pass+1)); else fails=$((fails+1)); echo "***** FAIL $name"; fi; }
has() { if grep -qF -- "$1" "$W/result"; then pass=$((pass+1)); else fails=$((fails+1)); echo "***** FAIL missing output: $1"; fi; }
hasnt() { if grep -qF -- "$1" "$W/result"; then fails=$((fails+1)); echo "***** FAIL unexpected output: $1"; else pass=$((pass+1)); fi; }

printf '%s\n%s\n' "$MARK" "$LINE" > "$W/ct"
journal() {   # Monday's observed shape: command only; PAM lines carry the cron CHILD pid, the CMD line the job shell pid
  { printf '2026-11-18T03:10:01+11:00 streamanator CRON[%s]: pam_unix(cron:session): session opened for user arm(uid=1000) by arm(uid=0)\n' "$CCHILD"
    printf '2026-11-18T03:10:01+11:00 streamanator CRON[%s]: (arm) CMD (%s)\n' "${1:-$DPID}" "$CMD"
    printf '2026-11-18T03:10:03+11:00 streamanator CRON[%s]: pam_unix(cron:session): session closed for user arm\n' "$CCHILD"; } > "$W/cron"
}
tab_sched() { printf '%s %s sh %s\n%s %s cron %s\n%s 1 cron %s\n' "$DPID" "$CCHILD" "$T0" "$CCHILD" "$CDAEMON" "$((T0-1))" "$CDAEMON" "$((T0-900000))" > "$W/ps.tab"; PARENT_SCHED=$DPID; }
tab_manual() { printf '5001 4900 bash %s\n4900 1 sshd %s\n' "$((T0-3600))" "$((T0-90000))" > "$W/ps.tab"; PARENT_MANUAL=5001; }
core_ok() { printf '#!/bin/sh\nexit 0\n' > "$W/ops/offhost-pull.sh"; }
core_fail() { printf '#!/bin/sh\necho "core: pull failed"\nexit 1\n' > "$W/ops/offhost-pull.sh"; }
reset() {
  rm -rf "$W/dest" "$W/ops/state"; mkdir -p "$W/dest" "$W/ops/state"
  printf fixture > "$W/dest/$D"; S=$(sha256sum < "$W/dest/$D" | cut -d' ' -f1)
  printf '%s  %s\n' "$S" "$D" > "$W/dest/$D.sha256"; touch "$W/dest/.verified-$D"
  cp "$K/scheduled-pull-evidence.sh" "$W/ops/"; core_ok; journal; : > "$W/ps.tab"
  printf '#!/bin/sh\nexit 0\n' > "$W/ops/alarm-email.sh"
}
wrapper_at() {   # real wrapper; $1 = fake clock epoch, $2 = parent pid the ps table gives unknown (this) pid
  FAKE_NOW=$1 PS_PARENT=$2 PATH="$PATHY" sh "$K/afldb-offhost-pull-daily.sh"
}
NOWV=$((T0+1200))   # 03:30 Wed
verify()  { FAKE_NOW=$NOWV PATH="$PATHY" bash "$B/r6-20261125/r6-offhost-verify.sh" "$DAY" "$D" "$S"; }
observe() { FAKE_NOW=$NOWV PATH="$PATHY" bash "$A/a2-cron-observe.sh" r3 "$DAY" "$D" "$S"; }
direct()  { FAKE_NOW=$NOWV PATH="$PATHY" bash "$K/scheduled-pull-evidence.sh" "$DAY" "$D" "$S"; }
scheduled_run() { tab_sched; wrapper_at $((T0+2)) $DPID; }
manual_run()    { tab_manual; wrapper_at $((T0+30)) 5001; }

echo "== A. three outcomes through the real wrapper, the real journal shape and both observer entry points"
reset; expect 0 scheduled-run-wrapper scheduled_run
grep -q "BEGIN run=.* cron_pid=$CCHILD lineage=[0-9]*:sh:[0-9]*,$DPID:sh:$T0,$CCHILD:cron:" "$W/ops/state/offhost-pull.log" && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL BEGIN lacks the dispatch lineage'; }
expect 0 verified-scheduled-r6 verify; has 'RESULT SCHEDULED-COPY-VERIFIED'; has 'R6 OFFHOST RESULT PASS'; has "OFFHOST-COMPARE $D $S"
expect 0 verified-scheduled-observe observe; has "DISPATCH journal: pid=$DPID"; has 'OBSERVE DONE'
expect 0 verified-scheduled-direct direct

reset; journal 3729700; scheduled_run >/dev/null; expect 10 dispatch-pid-not-in-lineage direct; has 'RESULT COPY-VERIFIED-ORIGIN-UNPROVEN'; has 'no wrapper invocation links'
reset; manual_run >/dev/null; expect 10 manual-run-same-minute direct; has 'RESULT COPY-VERIFIED-ORIGIN-UNPROVEN'; has "COPY VERIFIED $D"
expect 10 unproven-propagates-r6 verify; has 'R6 OFFHOST RESULT COPY-VERIFIED-ORIGIN-UNPROVEN'; hasnt 'R6 OFFHOST RESULT PASS'
expect 10 unproven-propagates-observe observe; hasnt 'OBSERVE DONE'

echo "== B. Monday's finding: copy verified off-host, wrapper logged only the cron child, no lineage"
reset; cat > "$W/ops/state/offhost-pull.log" <<EOF
2026-11-17T16:10:01Z BEGIN run=2026-11-17T16:10:01Z-3729647 cron_pid=$CCHILD
2026-11-17T16:10:03Z VERIFIED run=2026-11-17T16:10:01Z-3729647 dump=$D sha256=$S
2026-11-17T16:10:04Z END run=2026-11-17T16:10:01Z-3729647 rc=0
EOF
expect 10 monday-legacy-log direct; has 'RESULT COPY-VERIFIED-ORIGIN-UNPROVEN'
echo 'Sunday style fixture: schedule-prefixed CMD and an invented matching cron_pid'
reset; printf '2026-11-18T03:10:01+11:00 streamanator CRON[777]: (arm) CMD (%s)\n' "$LINE" > "$W/cron"
cat > "$W/ops/state/offhost-pull.log" <<EOF
2026-11-17T16:10:01Z BEGIN run=scheduled cron_pid=777
2026-11-17T16:12:00Z VERIFIED run=scheduled dump=$D sha256=$S
2026-11-17T16:12:01Z END run=scheduled rc=0
EOF
expect 10 invented-schedule-prefix-fixture direct

echo "== C. failed scheduled run, then a successful manual retry"
reset; core_fail; tab_sched; PS_PARENT=$DPID; expect 3 scheduled-run-fails-wrapper wrapper_at $((T0+2)) $DPID; core_ok; manual_run >/dev/null
expect 1 failed-scheduled-then-manual-retry direct; has 'RESULT COPY-FAILED'; has 'scheduled invocation failed'
expect 1 failed-then-retry-r6 verify; has 'R6 OFFHOST RESULT FAIL'
reset; tab_sched; wrapper_at $((T0+2)) $DPID >/dev/null; sed -i '/ END /d' "$W/ops/state/offhost-pull.log"; expect 1 scheduled-begin-no-end direct; has 'no unique completion'
reset; scheduled_run >/dev/null; b=$(grep ' END ' "$W/ops/state/offhost-pull.log" | head -1 | cut -d' ' -f1); sed -i "s/^$b END/2026-11-17T17:20:00Z END/" "$W/ops/state/offhost-pull.log"; expect 1 late-completion direct; has 'stale, late or future'

echo "== D. recycled PID, stale evidence, manual run alongside the scheduled run"
reset; scheduled_run >/dev/null; manual_run >/dev/null
expect 0 scheduled-plus-manual-same-minute direct; has "dispatch_pid=$DPID"; hasnt "$((T0+30))"
reset; cat > "$W/ops/state/offhost-pull.log" <<EOF
2026-11-16T16:10:01Z BEGIN run=2026-11-16T16:10:01Z-$DPID cron_pid=$CCHILD lineage=$DPID:sh:$((T0-86400)),$CCHILD:cron:$((T0-86401)),$CDAEMON:cron:1
2026-11-16T16:10:04Z VERIFIED run=2026-11-16T16:10:01Z-$DPID dump=$D sha256=$S
2026-11-16T16:10:05Z END run=2026-11-16T16:10:01Z-$DPID rc=0
EOF
expect 10 recycled-pid-only-yesterday direct
reset; cat > "$W/ops/state/offhost-pull.log" <<EOF
2026-11-16T16:10:01Z BEGIN run=2026-11-16T16:10:01Z-$DPID cron_pid=$CCHILD lineage=$DPID:sh:$((T0-86400)),$CCHILD:cron:$((T0-86401)),$CDAEMON:cron:1
2026-11-16T16:10:05Z END run=2026-11-16T16:10:01Z-$DPID rc=0
EOF
scheduled_run >/dev/null; expect 0 recycled-pid-yesterday-plus-valid-today direct
reset; scheduled_run >/dev/null; sed -i "s/$DPID:sh:$T0/$DPID:sh:$((T0-3600))/" "$W/ops/state/offhost-pull.log"; expect 10 lineage-start-time-wrong direct
reset; tab_sched; printf '%s %s sh %s\n%s 1 bash %s\n' "$DPID" 4100 "$T0" 4100 "$((T0-1))" > "$W/ps.tab"; wrapper_at $((T0+2)) $DPID >/dev/null; expect 10 no-cron-process-above-dispatch direct
reset; scheduled_run >/dev/null; journal "$CCHILD"; expect 0 journal-logs-the-cron-child-pid direct

echo "== E. journal and crontab availability, ambiguity"
reset; scheduled_run >/dev/null; rm -f "$W/cron"; expect 10 journal-export-unreadable direct; has 'cron journal export unreadable'
reset; scheduled_run >/dev/null; : > "$W/cron"; expect 10 journal-empty direct; has 'no 03:10 cron dispatch'
reset; scheduled_run >/dev/null; cp "$W/cron" "$W/dup"; cat "$W/dup" >> "$W/cron"; expect 10 ambiguous-dispatch direct
reset; scheduled_run >/dev/null; sed -i 's/2026-11-18T03:10:01/2026-11-17T03:10:01/' "$W/cron"; expect 10 other-day-dispatch direct
reset; scheduled_run >/dev/null; : > "$W/ct"; expect 10 crontab-pair-missing direct; has 'marker+job pair'; printf '%s\n%s\n' "$MARK" "$LINE" > "$W/ct"
reset; scheduled_run >/dev/null; mv "$W/ct" "$W/ct.off"; expect 10 crontab-unreadable direct; mv "$W/ct.off" "$W/ct"
reset; scheduled_run >/dev/null; printf '# AFLDB-A2-r3\n15 3 * * * %s\n' "$CMD" > "$W/ct"; expect 10 wrong-installed-schedule direct; printf '%s\n%s\n' "$MARK" "$LINE" > "$W/ct"

echo "== F. bytes: wrong hash, changed dump, sidecar, marker, hold, wrong dump class"
reset; scheduled_run >/dev/null; expect 1 wrong-production-sha bash -c 'FAKE_NOW=$1 PATH="$2" bash "$3/kits/scheduled-pull-evidence.sh" "$4" "$5" "$6"' _ "$NOWV" "$PATHY" "$B" "$DAY" "$D" "$(printf '%064d' 0)"; has 'RESULT COPY-FAILED'
reset; scheduled_run >/dev/null; echo corrupt >> "$W/dest/$D"; expect 1 changed-dump-bytes direct
reset; scheduled_run >/dev/null; printf '%s  other.dump\n' "$S" > "$W/dest/$D.sha256"; expect 1 wrong-sidecar direct
reset; scheduled_run >/dev/null; rm "$W/dest/.verified-$D"; expect 1 missing-marker direct
reset; scheduled_run >/dev/null; touch "$W/dest/.retention-hold"; expect 1 active-hold direct; rm "$W/dest/.retention-hold"
reset; scheduled_run >/dev/null; : > "$W/dest/$D"; expect 1 empty-dump direct
reset; scheduled_run >/dev/null; expect 2 verification-service-dump-as-overnight bash -c 'FAKE_NOW=$1 PATH="$2" bash "$3/kits/scheduled-pull-evidence.sh" "$4" afldb_prod-20261118-033635.dump "$5"' _ "$NOWV" "$PATHY" "$B" "$DAY" "$S"
reset; printf other > "$W/dest/afldb_prod-20261118-033635.dump"; touch "$W/dest/.verified-afldb_prod-20261118-033635.dump"; V=$(sha256sum < "$W/dest/afldb_prod-20261118-033635.dump" | cut -d' ' -f1)
printf '%s  afldb_prod-20261118-033635.dump\n' "$V" > "$W/dest/afldb_prod-20261118-033635.dump.sha256"; scheduled_run >/dev/null
expect 0 overnight-selected-beside-verification-dump direct; has "COPY VERIFIED $D"
expect 2 bad-date bash -c 'bash "$1/kits/scheduled-pull-evidence.sh" 2026-13-40 "$2" "$3"' _ "$B" "$D" "$S"
reset; scheduled_run >/dev/null; sed -i "s/ VERIFIED run=\(.*\) dump=$D/ VERIFIED run=\1 dump=other.dump/" "$W/ops/state/offhost-pull.log"; expect 10 run-did-not-verify-named-dump direct
reset; scheduled_run >/dev/null; sed -i "s/sha256=$S/sha256=$(printf '%064d' 1)/" "$W/ops/state/offhost-pull.log"; expect 10 run-verified-other-checksum direct

echo "== G. the real wrapper under a real process tree (real ps, no shim): lineage is recorded and sane"
reset; core_ok; rm -f "$W/bin/ps" "$W/bin/date"
t_a=$(date +%s)
sh -c 'echo $$ > "$1"; /bin/sh "$2" ; echo rc=$? > "$3"' _ "$W/parentpid" "$K/afldb-offhost-pull-daily.sh" "$W/wrc"
t_b=$(date +%s); ppid_=$(cat "$W/parentpid")
expect 0 real-process-tree-wrapper-exit grep -q 'rc=0' "$W/wrc"
beg=$(grep ' BEGIN ' "$W/ops/state/offhost-pull.log" | tail -1); echo "$beg"
case $beg in *"lineage=unknown"*) fails=$((fails+1)); echo '***** FAIL real ps produced no lineage';; *) pass=$((pass+1));; esac
case $beg in *"$ppid_:sh:"*) pass=$((pass+1));; *) fails=$((fails+1)); echo "***** FAIL lineage lacks the real parent shell $ppid_";; esac
st=$(printf '%s' "$beg" | tr ',' '\n' | grep "^.*$ppid_:sh:" | sed "s/.*$ppid_:sh://; s/[^0-9].*//")
if [ -n "$st" ] && [ "$st" -ge $((t_a-3)) ] && [ "$st" -le $((t_b+3)) ]; then pass=$((pass+1)); else fails=$((fails+1)); echo "***** FAIL parent start epoch $st outside [$t_a,$t_b]"; fi
printf '#!/bin/sh\ncase "$*" in *etimes*) exit 1;; *) exec /bin/ps "$@";; esac\n' > "$W/bin/ps"; chmod +x "$W/bin/ps"
reset; core_ok; sh -c 'PATH="$1:$PATH" /bin/sh "$2"; echo rc=$? > "$3"' _ "$W/bin" "$K/afldb-offhost-pull-daily.sh" "$W/wrc"
expect 0 ps-without-etimes-still-pulls grep -q 'rc=0' "$W/wrc"; grep -q 'lineage=unknown' "$W/ops/state/offhost-pull.log" && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL expected lineage=unknown'; }
grep -q 'END .* rc=0' "$W/ops/state/offhost-pull.log" && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL pull did not finish'; }
rm -f "$W/bin/ps" "$W/bin/date"; mkshims

echo "== H. helper pair installer (a2-helper-install.sh) and installer check exit status"
PAIR=$W/stage; cp "$K/afldb-offhost-pull-daily.sh" "$K/scheduled-pull-evidence.sh" "$PAIR/"
hinst() { PATH="$PATHY" bash "$A/a2-helper-install.sh" "$@"; }
hreset() {
  rm -rf "$W/ops" "$W/dest"; mkdir -p "$W/ops/state" "$W/dest"
  cp "$ROOT/tools/maintenance/offhost-pull.sh" "$W/ops/offhost-pull.sh"
  printf '#!/bin/sh\n# previous working wrapper\nexit 0\n' > "$W/ops/afldb-offhost-pull-daily.sh"; chmod 700 "$W/ops/afldb-offhost-pull-daily.sh"
  printf '2026-11-17T16:10:01Z BEGIN run=old cron_pid=1\n' > "$W/ops/state/offhost-pull.log"; printf '%s\n%s\n' "$MARK" "$LINE" > "$W/ct"
  OLD=$(sha256sum < "$W/ops/afldb-offhost-pull-daily.sh" | cut -d' ' -f1); CT0=$(sha256sum < "$W/ct" | cut -d' ' -f1)
}
export AFLDB_HELPER_NOW=$(TZ=Australia/Melbourne date -d '2026-11-23 12:00' +%s)
hreset; expect 1 helper-check-before-install hinst check; has 'HELPER CHECK FAIL'
expect 0 helper-install-pair hinst install "$PAIR"; has 'HELPER INSTALL PASS'
[ "$(sha256sum < "$W/ct" | cut -d' ' -f1)" = "$CT0" ] && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL crontab changed'; }
grep -q 'previous working wrapper' "$W/ops/afldb-offhost-pull-daily.sh".pre-352-* && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL prior wrapper not kept'; }
[ "$(head -1 "$W/ops/state/offhost-pull.log")" = '2026-11-17T16:10:01Z BEGIN run=old cron_pid=1' ] && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL log altered'; }
expect 0 helper-check-after-install hinst check; has 'HELPER CHECK PASS'
expect 0 helper-install-idempotent hinst install "$PAIR"; has 'ALREADY CURRENT'
expect 0 cron-check-r3-after-pair bash -c 'printf "#!/usr/bin/env bash\nexit 0\n" > "$1/alarm-email.sh"; chmod +x "$1/alarm-email.sh"; echo x=1 > "$1/alarm-smtp.env"; chmod 600 "$1/alarm-smtp.env"; printf "fixture" > "$2/$3"; s=$(sha256sum < "$2/$3" | cut -d" " -f1); printf "%s  %s\n" "$s" "$3" > "$2/$3.sha256"; touch "$2/.verified-$3"; printf "DUMP %s\npg_restore exit=0, stderr lines 0\nFIRSTCOPY RESULT RESTORE PASS\n" "$2/$3" > "$1/state/a2-firstcopy-restore.log"; PATH="$4" bash "$5/a2-cron-install.sh" check r3 --require-installed' _ "$W/ops" "$W/dest" "$D" "$PATHY" "$A"
has 'PRECONDITIONS PASS'; has 'INSTALLED'
echo 'cron installer: failed precondition must not exit 0'
hreset; printf '# other cron\n* * * * * true\n' > "$W/ct"; CT0=$(sha256sum < "$W/ct" | cut -d' ' -f1); printf 'tampered\n' >> "$W/ops/afldb-offhost-pull-daily.sh"
expect 1 cron-check-failed-precondition bash -c 'PATH="$1" bash "$2/a2-cron-install.sh" check r3' _ "$PATHY" "$A"; has 'PRECONDITIONS FAIL'; has 'FAIL pinned file differs'; has 'FAIL pinned file missing'
expect 3 cron-install-refuses-failed-precondition bash -c 'PATH="$1" bash "$2/a2-cron-install.sh" install r3' _ "$PATHY" "$A"; has 'precondition failed: nothing installed'
[ "$(sha256sum < "$W/ct" | cut -d' ' -f1)" = "$CT0" ] && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL crontab changed by refused install'; }
echo 'installer refusals leave the previous wrapper in place'
hreset; rm -f "$W/stage/scheduled-pull-evidence.sh"
expect 3 helper-missing-staged-verifier hinst install "$PAIR"; has 'staged helper missing'; [ "$(sha256sum < "$W/ops/afldb-offhost-pull-daily.sh" | cut -d' ' -f1)" = "$OLD" ] && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL wrapper changed'; }
cp "$K/scheduled-pull-evidence.sh" "$PAIR/"
hreset; printf '# extra\n' >> "$PAIR/afldb-offhost-pull-daily.sh"
expect 3 helper-staged-wrapper-differs-from-pin hinst install "$PAIR"; has 'differs from its pin'; cp "$K/afldb-offhost-pull-daily.sh" "$PAIR/"
hreset; printf '# extra\n' >> "$W/ops/offhost-pull.sh"
expect 3 helper-core-differs hinst install "$PAIR"; has 'core'
hreset; AFLDB_HELPER_NOW=$(TZ=Australia/Melbourne date -d '2026-11-23 03:12' +%s) expect 3 helper-inside-pull-window hinst install "$PAIR"; has 'scheduled pull window'
hreset; ( exec 8>"$W/ops/state/offhost-pull.lock"; flock -n 8 && sleep 4 ) & sleep 1
expect 3 helper-pull-running hinst install "$PAIR"; has 'pull is running'; wait
hreset; expect 3 helper-bad-host env AFLDB_CRON_EXPECT_HOST=nowhere-host bash -c 'PATH="$1" bash "$2/a2-helper-install.sh" install "$3"' _ "$PATHY" "$A" "$PAIR"
[ "$(sha256sum < "$W/ops/afldb-offhost-pull-daily.sh" | cut -d' ' -f1)" = "$OLD" ] && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL wrapper changed on bad host'; }
echo 'interrupted installation (SIGKILL after the first rename), then a safe re-run'
hreset; cat > "$W/bin/mv" <<'EOF'
#!/bin/sh
/bin/mv "$@" || exit $?
n=$(cat "$MV_COUNT" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$MV_COUNT"
[ "$n" = "$MV_KILL_AFTER" ] && kill -9 "$PPID"
exit 0
EOF
chmod +x "$W/bin/mv"; export MV_COUNT=$W/mvcount; rm -f "$MV_COUNT"
expect 137 helper-install-killed-mid-pair env MV_KILL_AFTER=1 bash -c 'PATH="$1" bash "$2/a2-helper-install.sh" install "$3"' _ "$PATHY" "$A" "$PAIR"
[ "$(sha256sum < "$W/ops/afldb-offhost-pull-daily.sh" | cut -d' ' -f1)" = "$OLD" ] && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL wrapper replaced before the pair completed'; }
[ -f "$W/ops/scheduled-pull-evidence.sh" ] && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL verifier not installed first'; }
rm -f "$W/bin/mv"
expect 1 helper-check-detects-partial hinst check; has 'HELPER CHECK FAIL'
expect 1 cron-check-detects-partial bash -c 'PATH="$1" bash "$2/a2-cron-install.sh" check r3' _ "$PATHY" "$A"; has 'PRECONDITIONS FAIL'
expect 0 helper-rerun-completes hinst install "$PAIR"; has 'HELPER INSTALL PASS'
expect 0 helper-check-after-rerun hinst check
echo 'failed rename mid-pair rolls back; failed restore is reported as 5'
hreset; cat > "$W/bin/mv" <<'EOF'
#!/bin/sh
n=$(cat "$MV_COUNT" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$MV_COUNT"
case $n in "$MV_FAIL_ON") exit 1;; esac
exec /bin/mv "$@"
EOF
chmod +x "$W/bin/mv"; rm -f "$MV_COUNT"
expect 4 helper-second-rename-fails-restores env MV_FAIL_ON=2 bash -c 'PATH="$1" bash "$2/a2-helper-install.sh" install "$3"' _ "$PATHY" "$A" "$PAIR"; has 'RESTORED the previous helpers'
[ "$(sha256sum < "$W/ops/afldb-offhost-pull-daily.sh" | cut -d' ' -f1)" = "$OLD" ] && [ ! -e "$W/ops/scheduled-pull-evidence.sh" ] && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL previous state not restored'; }
hreset; rm -f "$MV_COUNT"
cat > "$W/bin/mv" <<'EOF'
#!/bin/sh
exit 1
EOF
expect 5 helper-restore-unverifiable env MV_FAIL_ON=0 bash -c 'PATH="$1" bash "$2/a2-helper-install.sh" install "$3"' _ "$PATHY" "$A" "$PAIR"; has 'RESTORE NOT VERIFIED'
[ "$(sha256sum < "$W/ops/afldb-offhost-pull-daily.sh" | cut -d' ' -f1)" = "$OLD" ] && pass=$((pass+1)) || { fails=$((fails+1)); echo '***** FAIL wrapper changed after refused renames'; }
rm -f "$W/bin/mv"

echo "== I. pins embedded in both installers equal the repository bytes"
wp=$(sha256sum < "$K/afldb-offhost-pull-daily.sh" | cut -d' ' -f1); vp=$(sha256sum < "$K/scheduled-pull-evidence.sh" | cut -d' ' -f1); cp_=$(sha256sum < "$ROOT/tools/maintenance/offhost-pull.sh" | cut -d' ' -f1)
for f in a2-helper-install.sh a2-cron-install.sh; do for p in $wp $vp $cp_; do grep -q "$p" "$A/$f" && pass=$((pass+1)) || { fails=$((fails+1)); echo "***** FAIL $f lacks pin ${p:0:8}"; }; done; done
for f in kits/afldb-offhost-pull-daily.sh kits/scheduled-pull-evidence.sh a1a2-20261124/a2-helper-install.sh a1a2-20261124/a2-cron-install.sh a1a2-20261124/a2-cron-observe.sh r6-20261125/r6-offhost-verify.sh; do bash -n "$B/$f" && pass=$((pass+1)) || { fails=$((fails+1)); echo "***** FAIL syntax $f"; }; done

echo "T352 RESULT $pass passed, $fails failed"
[ "$fails" = 0 ]
