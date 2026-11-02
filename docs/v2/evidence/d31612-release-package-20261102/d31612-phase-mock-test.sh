#!/bin/bash
# D-316-12 UI release: wrapper tests for d31612-phase.sh against a MOCKED host. Workstation only; production is never contacted.
#   bash d31612-phase-mock-test.sh <new work dir>      (the directory must not exist; it receives the whole mock world)
# What is mocked: hostname, id, systemctl, node (release.mjs), readlink, curl, df, pgrep, crontab, journalctl, sudo, /proc, the release
# links, a throwaway Git checkout with a bare origin, the pinned helpers. The REAL d31612-phase.sh and the REAL state-probe.sh run, with
# only their literal constants and /proc rewritten by sed. This proves the wrapper's logic, not the host or the real release.mjs.
# Every mutation a phase may make goes through a logged stub; a mutator that no phase may call (systemctl restart/start/stop/
# reset-failed/enable/disable, sudo, an unqualified rollback) is logged DISALLOWED and refused. The final check fails the run if any
# such call, or any unexpected stub call, was ever made.
set -u
export LC_ALL=C
W=${1:?usage: bash d31612-phase-mock-test.sh <new work dir (must not exist)>}
[ ! -e "$W" ] || { echo "work dir exists: $W"; exit 2; }
mkdir -p "$W" || exit 2
W=$(realpath "$W")                                  # the same spelling realpath gives, so the probe's realpath comparison and the phase's literal agree
PKG=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SRC=$PKG/d31612-phase.sh
PROBE_SRC=$PKG/../gap006-release-package-20261101/state-probe.sh
[ -f "$SRC" ] && [ -f "$PROBE_SRC" ] || { echo "missing d31612-phase.sh or state-probe.sh"; exit 2; }
cv() { sed -n "s/^$1=//p" "$SRC" | head -n 1; }
OLD_ID=$(cv OLD_ID); OLD_PREV=$(cv OLD_PREV); PKGD=$(cv PKGD); PKGG=$(cv PKGG)
NEWID=a0b1080f5b98-TESTBUILD
ST=$W/st; LOG=$W/calls.log; OUT=$W/out.txt
G() { git -c commit.gpgsign=false -c user.name=mock -c user.email=mock@example.invalid -C "$W/chk" "$@"; }

# ---------------------------------------------------------------- stubs
mkdir -p "$W/bin" "$ST"
stub() { cat > "$W/bin/$1"; chmod +x "$W/bin/$1"; }
stub hostname <<'EOF'
#!/bin/bash
echo afldb-prod
EOF
stub id <<'EOF'
#!/bin/bash
[ "$1" = "-un" ] && echo arm || exec /usr/bin/id "$@"
EOF
stub df <<'EOF'
#!/bin/bash
echo Avail; cat "$MOCK_ST/df_kb"
EOF
stub pgrep <<'EOF'
#!/bin/bash
exit 1
EOF
stub crontab <<'EOF'
#!/bin/bash
exit 1
EOF
stub journalctl <<'EOF'
#!/bin/bash
cat "$MOCK_ST/journal" 2>/dev/null; exit 0
EOF
stub curl <<'EOF'
#!/bin/bash
cat "$MOCK_ST/health"
EOF
stub sudo <<'EOF'
#!/bin/bash
echo "DISALLOWED sudo $*" >> "$MOCK_LOG"; exit 1
EOF
stub readlink <<'EOF'
#!/bin/bash
case "$1" in
  "$MOCK_W/root/current") cat "$MOCK_ST/current";;
  "$MOCK_W/root/previous") cat "$MOCK_ST/previous";;
  "$MOCK_W/proc/"*/cwd) [ -f "$1" ] && cat "$1" || exit 1;;
  *) exec /usr/bin/readlink "$@";;
esac
EOF
stub systemctl <<'EOF'
#!/bin/bash
ST=$MOCK_ST
case "$1" in
  show) # systemctl show -p PROP --value UNIT
    case "$5:$3" in
      afldb-settle-afl-api.timer:NextElapseUSecRealtime) cat "$ST/timer_next";;
      afldb-settle-afl-api.timer:LastTriggerUSec) cat "$ST/timer_last";;
      afldb-settle-afl-api.service:ExecMainExitTimestamp) cat "$ST/svc_exit";;
      afldb-settle-afl-api.service:ActiveState) cat "$ST/svc_active";;
      afldb:ActiveState) cat "$ST/active";;
      afldb:Result) echo success;;
      afldb:MainPID) cat "$ST/pid";;
      *) echo "";;
    esac;;
  is-enabled) f="$ST/enabled_$2"; if [ -f "$f" ]; then cat "$f"; else echo disabled; fi;;
  list-timers) echo "Tue 2099-11-04 05:01:47 AEDT 1 day left x afldb-settle-afl-api.timer afldb-settle-afl-api.service";;
  *) echo "DISALLOWED systemctl $*" >> "$MOCK_LOG"; exit 1;;
esac
EOF
stub node <<'EOF'
#!/bin/bash
# stands in for `node deploy/release.mjs <sub> ...`; every call is logged; links move only as the real route would
ST=$MOCK_ST; sub=${2:-}
echo "NODE $*" >> "$MOCK_LOG"
ready() { echo "release: RELEASE READY a0b1080f5b98-TESTBUILD /x 123 files"; }
mklinks() { cp "$ST/current" "$ST/previous"; echo "releases/$1" > "$ST/current"; }
case "$sub" in
  status) echo "release: STATUS PASS"; exit "$(cat "$ST/n_status" 2>/dev/null || echo 0)";;
  verify) if grep -qx -- "$3" "$ST/verify_fail" 2>/dev/null; then echo "release: VERIFY FAIL $3"; exit 1; fi; echo "release: VERIFY PASS $3"; exit 0;;
  build)
    case "$(cat "$ST/build_mode")" in
      ok) mkdir -p "$MOCK_W/root/releases/a0b1080f5b98-TESTBUILD"; echo "release: building"; ready; exit 0;;
      ok_moves_current) mkdir -p "$MOCK_W/root/releases/a0b1080f5b98-TESTBUILD"; ready; echo "releases/a0b1080f5b98-TESTBUILD" > "$ST/current"; exit 0;;
      ready_then_fail) echo "release: building"; ready; echo "release: boot smoke FAILED"; exit 3;;
      fail_no_ready) echo "release: REFUSED MemAvailable below the floor"; exit 4;;
      exit0_no_ready) echo "release: done, nothing to report"; exit 0;;
      bad_ready) echo "release: RELEASE READY ea98a35f2061-WRONGREV /x 1 files"; exit 0;;
    esac; exit 9;;
  promote) case "$(cat "$ST/promote_mode" 2>/dev/null || echo ok)" in
      refuse) echo "release: REFUSED promote $3"; exit 1;;
      noop) echo "release: promote reported success"; exit 0;;
      *) mklinks "$3"; echo "release: PROMOTED $3"; exit 0;;
    esac;;
  rollback) if [ "${3:-}" != "--to" ]; then echo "release: UNQUALIFIED rollback"; echo "DISALLOWED unqualified rollback" >> "$MOCK_LOG"; exit 1; fi
    case "$(cat "$ST/rollback_mode" 2>/dev/null || echo ok)" in
      refuse) echo "release: REFUSED rollback to $4 (manifest check)"; exit 1;;
      noop) echo "release: rollback reported success"; exit 0;;
      *) mklinks "$4"; echo "release: ROLLED BACK to $4"; exit 0;;
    esac;;
  *) echo "UNKNOWN node subcommand: $*" >> "$MOCK_LOG"; exit 9;;
esac
EOF

# ---------------------------------------------------------------- pinned-helper stubs, mock Git world
mkdir -p "$W/d0"
cat > "$W/d0/c5-observe-20261102-r3.sh" <<'EOF'
#!/bin/bash
echo "HELPER obs $*" >> "$MOCK_LOG"
if [ "$(cat "$MOCK_ST/obs_exit" 2>/dev/null || echo 0)" != 0 ]; then echo "OBS: FAIL"; exit 1; fi
echo "OBS: PASS"
EOF
cat > "$W/d0/c5-proc-guard-20261102.sh" <<'EOF'
#!/bin/bash
echo "mock guard"
EOF
OBS_SHA=$(sha256sum < "$W/d0/c5-observe-20261102-r3.sh" | cut -c1-64); GUARD_SHA=$(sha256sum < "$W/d0/c5-proc-guard-20261102.sh" | cut -c1-64)

git init -q "$W/chk" && G config core.autocrlf false && G config core.safecrlf false || exit 2
[ "$(G rev-parse --git-dir)" = ".git" ] || { echo "mock repo is not isolated"; exit 2; }
mkdir -p "$W/chk/deploy" "$W/chk/$PKGG" "$W/chk/$PKGD"
printf '.env\n' > "$W/chk/.gitignore"
cat > "$W/chk/deploy/post-install-check.sh" <<'EOF'
#!/bin/bash
echo "POSTCHK $1" >> "$MOCK_LOG"
if grep -qx -- "$1" "$MOCK_ST/postchk_fail" 2>/dev/null; then echo "POST-INSTALL CHECK FAIL $1"; exit 1; fi
echo "POST-INSTALL CHECK PASS $1"
EOF
sed "s|/proc/|$W/proc/|g" "$PROBE_SRC" > "$W/chk/$PKGG/state-probe.sh"
G add -A && G commit -q -m c0 && C_0=$(G rev-parse HEAD)
echo r > "$W/chk/docs-r.txt"; G add -A && G commit -q -m cR && C_R=$(G rev-parse HEAD)
printf '#!/bin/bash\necho "STATIC DELTA CHECK PASS (mock)"\n' > "$W/chk/$PKGD/static-delta-check.sh"
G add -A && G commit -q -m cH && C_H=$(G rev-parse HEAD)
G branch -M main
git init -q --bare "$W/origin.git" && G remote add origin "$W/origin.git" && G push -q origin main || exit 2
[ "$(G rev-parse refs/remotes/origin/main)" = "$C_H" ] || exit 2

# ---------------------------------------------------------------- the phase script under test (constants and /proc rewritten)
mk_phase() { # $1 = out file; $2 = optional sed program that MUTATES the source first (mutation controls only)
  local out=$1 pre=$1.pre
  if [ $# -gt 1 ]; then sed "$2" "$SRC" > "$pre"; else cp "$SRC" "$pre"; fi
  sed -E -e "s/^R=[0-9a-f]{40}/R=$C_R/" -e "s/^H=[0-9a-f]{40}/H=$C_H/" -e "s/^PROD_HEAD=[0-9a-f]{40}/PROD_HEAD=$C_0/" \
    -e "s|^ROOT=.*|ROOT=$W/root|" -e "s|^CHK=.*|CHK=$W/chk|" -e "s|^N=.*|N=$W/bin/node|" -e "s|^D=.*|D=$W/d|" \
    -e "s/OBS_SHA=[0-9a-f]{64}/OBS_SHA=$OBS_SHA/" -e "s/GUARD_SHA=[0-9a-f]{64}/GUARD_SHA=$GUARD_SHA/" \
    -e "s|/proc/|$W/proc/|g" "$pre" > "$out"
  rm -f "$pre"
}
mk_phase "$W/phase.sh"
mk_phase "$W/phase-m1.sh" '/bst=/d;/bst\[0\]/d'                # MUTATION 1: d2 without the build-status check
mk_phase "$W/phase-m2.sh" '/^  preserved "\$OLD_ID"/d'         # MUTATION 2: r3-verify without the preservation comparison
mk_phase "$W/phase-m3.sh" '/D31612 probe FAIL/d'               # MUTATION 3: probe phase that exits 0 whatever the probe did
for m in 1 2 3; do cmp -s "$W/phase.sh" "$W/phase-m$m.sh" && { echo "mutation $m changed nothing"; exit 2; }; done

# ---------------------------------------------------------------- world model
set_links() { printf 'releases/%s\n' "$1" > "$ST/current"; printf 'releases/%s\n' "$2" > "$ST/previous"; }
set_proc() { # pid release-id number-of-trigger-lines
  local pid=$1 id=$2 n=$3 i
  mkdir -p "$W/proc/$pid"; printf '%s\n' "$RELS/$id" > "$W/proc/$pid/cwd"
  { printf 'PATH=/usr/bin\0'; for ((i = 0; i < n; i++)); do printf 'AFLDB_SETTLE_TRIGGER=systemd\0'; done; printf 'LANG=C\0'; } > "$W/proc/$pid/environ"
  printf '%s\n' "$pid" > "$ST/pid"
}
newrel() { mkdir -p "$W/root/releases/$NEWID"; }
newfile() { printf '%s\n' "${1:-$NEWID}" > "$W/d/new-id.txt"; }
write_baseline() { cat > "$W/d/baseline.txt" <<EOF
captured_utc=2026-11-03T00:00:00Z
main_pid=4242
current=releases/$OLD_ID
previous=releases/$OLD_PREV
match_timer_next=Tue 2099-11-04 05:01:47
match_timer_last=Tue 2026-11-03 05:03:12
timers_enabled=enabled/disabled/disabled
dotenv_trigger_exact=1
process_trigger_exact=1
process_trigger_any=1
EOF
}
world() { # $1 = c0 | H (checkout position). OLD serving and healthy; no new release; no baseline; no new-id.txt; empty log
  rm -rf "$ST" "$W/proc" "$W/d" "$W/root"
  mkdir -p "$ST" "$W/proc" "$W/d" "$W/root/releases/$OLD_ID" "$W/root/releases/$OLD_PREV"
  RELS=$(realpath "$W/root/releases")
  cp "$W/d0/"* "$W/d/"
  printf 'MemAvailable:     3000000 kB\n' > "$W/proc/meminfo"
  printf '52000000\n' > "$ST/df_kb"
  printf 'active\n' > "$ST/active"; printf '{"status":"ok","database":"ok"}' > "$ST/health"
  printf 'Tue 2099-11-04 05:01:47\n' > "$ST/timer_next"; printf 'Tue 2026-11-03 05:03:12\n' > "$ST/timer_last"
  printf 'Tue 2026-11-03 05:04:55\n' > "$ST/svc_exit"; printf 'inactive\n' > "$ST/svc_active"
  printf 'enabled\n' > "$ST/enabled_afldb-settle-afl-api.timer"
  printf 'disabled\n' > "$ST/enabled_afldb-settle-afl-api-brownlow.timer"; printf 'disabled\n' > "$ST/enabled_afldb-settle-afltables.timer"
  printf 'ok\n' > "$ST/promote_mode"; printf 'ok\n' > "$ST/rollback_mode"; printf 'ok\n' > "$ST/build_mode"
  : > "$ST/verify_fail"; : > "$ST/postchk_fail"; printf '0\n' > "$ST/obs_exit"; : > "$ST/journal"
  set_links "$OLD_ID" "$OLD_PREV"; set_proc 4242 "$OLD_ID" 1
  printf 'FOO=1\nAFLDB_SETTLE_TRIGGER=systemd\n' > "$W/chk/.env"
  case "$1" in c0) G reset -q --hard "$C_0";; H) G reset -q --hard "$C_H";; *) echo "bad world arg"; exit 2;; esac; G clean -fdq
  [ -f "$LOG" ] && cat "$LOG" >> "$W/all-calls.log"; : > "$LOG"; TMUXV=""
}
snap() { SNAP="$(cat "$ST/current" "$ST/previous")|$(G rev-parse HEAD)"; }
run() { # run <phase> [phase file]
  local pf=${2:-$W/phase.sh}
  ( export PATH="$W/bin:$PATH" ROOT="$W/root" MOCK_ST="$ST" MOCK_LOG="$LOG" MOCK_W="$W"
    if [ -n "$TMUXV" ]; then export TMUX=$TMUXV; else unset TMUX; fi
    cd / && bash "$pf" "$1" ) > "$OUT" 2>&1
  RC=$?
}

# ---------------------------------------------------------------- assertions
PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "    ok    $1"; }
bad() { FAIL=$((FAIL + 1)); echo "    FAIL  $1"; echo "          ---- last output lines ----"; tail -n 8 "$OUT" | sed 's/^/          | /'; }
expect() { local d=$1; shift; if "$@"; then ok "$d"; else bad "$d"; fi; }
has() { grep -qF -- "$1" "$OUT"; }
lacks() { ! grep -qF -- "$1" "$OUT"; }
rcis() { [ "$RC" = "$1" ]; }
mutators() { grep -E '^NODE deploy/release.mjs (build|promote|rollback)' "$LOG" | sed -E 's|^NODE deploy/release.mjs ||; s|^(build) .*|\1|'; }
muts_are() { [ "$(mutators)" = "$1" ]; }
calls_node() { grep -qE "^NODE deploy/release.mjs $1" "$LOG"; }
no_node() { ! calls_node "$1"; }
no_bad_calls() { ! grep -qE 'DISALLOWED|UNKNOWN' "$LOG"; }
links_are() { [ "$(cat "$ST/current")|$(cat "$ST/previous")" = "releases/$1|releases/$2" ]; }
unchanged() { [ "$SNAP" = "$(cat "$ST/current" "$ST/previous")|$(G rev-parse HEAD)" ]; }
isfile() { [ -f "$W/d/$1" ]; }
nofile() { [ ! -e "$W/d/$1" ]; }
head_is() { [ "$(G rev-parse HEAD)" = "$1" ]; }
pass_phase() { expect "$1 exits 0 and prints 'D31612 $1 PASS'" bash -c "[ $RC = 0 ] && grep -qF 'D31612 $1 PASS' '$OUT'"; }
fail_phase() { # phase, message fragment
  expect "$1 exits 1 with 'D31612 $1 FAIL'" bash -c "[ $RC = 1 ] && grep -qF 'D31612 $1 FAIL' '$OUT'"
  [ -z "${2:-}" ] || expect "...STOP names: $2" has "$2"
}
case_() { echo; echo "[$1]"; }

echo "mock world $W"
echo "phase script  $(sha256sum < "$SRC" | cut -c1-64)  $SRC"
echo "state-probe   $(sha256sum < "$PROBE_SRC" | cut -c1-64)"
echo "mock R=$C_R H=$C_H PROD_HEAD=$C_0   OLD_ID=$OLD_ID   NEW_ID=$NEWID"

# ================================================================ detector self-test (the "disallowed mutation" trap must itself work)
case_ "harness self-test: the stubs log and refuse every mutator no phase may call"
world c0
for cmd in "systemctl restart afldb" "systemctl start afldb" "systemctl stop afldb" "systemctl reset-failed afldb" "systemctl enable x.timer" "systemctl disable x.timer" "sudo true" "node deploy/release.mjs rollback"; do
  : > "$LOG"
  ( export PATH="$W/bin:$PATH" MOCK_ST="$ST" MOCK_LOG="$LOG" MOCK_W="$W"; $cmd ) > /dev/null 2>&1; rc=$?
  expect "'$cmd' is refused (nonzero) and logged DISALLOWED" bash -c "[ $rc != 0 ] && grep -q DISALLOWED '$LOG'"
done
: > "$LOG"        # the deliberate DISALLOWED lines above must not reach the run-wide invariant
world c0

# ================================================================ pa
case_ "pa: preflight PASS, read-only"
world c0; snap; run pa
pass_phase pa; expect "state OLD_SERVING proved" has "STATE OLD_SERVING"; expect "no mutator" muts_are ""; expect "nothing moved" unchanged
case_ "pa: STOP when the serving process lacks the effective trigger"
world c0; set_proc 4242 "$OLD_ID" 0; run pa; fail_phase pa "effective AFLDB_SETTLE_TRIGGER=systemd count in the process is not 1"
case_ "pa: STOP when the first scheduled run has not fired"
world c0; : > "$ST/svc_exit"; run pa; fail_phase pa "G1: the first scheduled run has not fired and finished"
case_ "pa: STOP when a pinned helper's bytes differ"
world c0; echo '# tampered' >> "$W/d/c5-observe-20261102-r3.sh"; run pa; fail_phase pa "is missing or not the pinned bytes"
case_ "pa: STOP when OLD_ID fails its manifest check (failed old-release verification)"
world c0; echo "$OLD_ID" > "$ST/verify_fail"; run pa; fail_phase pa "OLD_ID no longer matches its manifest"; expect "no mutator" muts_are ""
case_ "pa: STOP when the checkout is not at the production head"
world H; run pa; fail_phase pa "checkout HEAD is not PROD_HEAD"

# ================================================================ d1
case_ "d1: baseline, fast-forward, OLD_SERVING"
world c0; run d1
pass_phase d1; expect "HEAD is H" head_is "$C_H"; expect "baseline written" isfile baseline.txt
expect "baseline records the exact effective trigger count 1" grep -qx 'process_trigger_exact=1' "$W/d/baseline.txt"
expect "no mutator" muts_are ""
case_ "d1: a second run STOPs (HEAD is no longer PROD_HEAD) and leaves the baseline alone"
before=$(sha256sum < "$W/d/baseline.txt"); run d1; fail_phase d1 "checkout HEAD is not PROD_HEAD"
expect "baseline unchanged" bash -c "[ \"\$(sha256sum < '$W/d/baseline.txt')\" = '$before' ]"

# ================================================================ d2 (build)
d2_world() { world H; TMUXV=1; write_baseline; snap; }
case_ "d2: PASS inside tmux; new-id.txt written; links unmoved"
d2_world; run d2
pass_phase d2; expect "new-id.txt holds the release id" bash -c "[ \"\$(cat '$W/d/new-id.txt')\" = '$NEWID' ]"
expect "only the build mutated" muts_are "build"; expect "verify NEW_ID ran" calls_node "verify $NEWID"; expect "links unmoved" unchanged
case_ "d2: STOP outside tmux"
d2_world; TMUXV=""; run d2; fail_phase d2 "not inside tmux"; expect "no build" muts_are ""; expect "no new-id.txt" nofile new-id.txt
case_ "d2: STOP when new-id.txt already exists (once only)"
d2_world; newfile; run d2; fail_phase d2 "NEWFILE exists"; expect "no build" muts_are ""
case_ "d2: STOP without a baseline"
d2_world; rm -f "$W/d/baseline.txt"; run d2; fail_phase d2 "no baseline"; expect "no build" muts_are ""
case_ "d2 NEGATIVE CONTROL A: the build prints a valid RELEASE READY line, THEN exits nonzero"
d2_world; printf 'ready_then_fail\n' > "$ST/build_mode"; run d2
fail_phase d2 "the build pipeline failed (build exit 3"
expect "the ready line really was in the log" grep -qF 'RELEASE READY a0b1080f5b98-TESTBUILD' "$W/d/d2-build.log"
expect "new-id.txt NOT written" nofile new-id.txt
expect "no verify, no promote, no rollback (promotion never reached)" bash -c "! grep -qE '^NODE deploy/release.mjs (verify|promote|rollback)' '$LOG'"
expect "only the build was invoked" muts_are "build"; expect "links unmoved" unchanged
case_ "d2 NEGATIVE CONTROL B: the build fails and prints no ready line"
d2_world; printf 'fail_no_ready\n' > "$ST/build_mode"; run d2
fail_phase d2 "the build pipeline failed (build exit 4"; expect "new-id.txt NOT written" nofile new-id.txt
expect "no verify, no promote, no rollback" bash -c "! grep -qE '^NODE deploy/release.mjs (verify|promote|rollback)' '$LOG'"; expect "links unmoved" unchanged
case_ "d2: the build exits 0 but prints no ready line"
d2_world; printf 'exit0_no_ready\n' > "$ST/build_mode"; run d2; fail_phase d2 "no RELEASE READY a0b1080f5b98-<BUILD_ID> line"; expect "new-id.txt NOT written" nofile new-id.txt; expect "no verify" no_node verify
case_ "d2: the ready line names a different revision"
d2_world; printf 'bad_ready\n' > "$ST/build_mode"; run d2; fail_phase d2 "no RELEASE READY"; expect "new-id.txt NOT written" nofile new-id.txt
case_ "d2: the new release fails its manifest check"
d2_world; echo "$NEWID" > "$ST/verify_fail"; run d2; fail_phase d2 "new release failed its manifest check"; expect "new-id.txt NOT written" nofile new-id.txt
case_ "d2: a build that moved current is a STOP"
d2_world; printf 'ok_moves_current\n' > "$ST/build_mode"; run d2; fail_phase d2 "a build moved current"; expect "new-id.txt NOT written" nofile new-id.txt
case_ "d2 MUTATION CONTROL 1: without the status check the same ready-then-fail build is wrongly accepted (the test can detect the defect)"
d2_world; printf 'ready_then_fail\n' > "$ST/build_mode"; run d2 "$W/phase-m1.sh"
expect "unfixed variant exits 0 and WRITES new-id.txt" bash -c "[ $RC = 0 ] && [ -f '$W/d/new-id.txt' ]"

# ================================================================ d3a (promote)
d3a_world() { world H; newrel; write_baseline; newfile; snap; }
case_ "d3a: successful promotion"
d3a_world; run d3a
pass_phase d3a; expect "only promote NEW_ID mutated" muts_are "promote $NEWID"; expect "state NEW_SELECTED_OLD_RUNNING proved" has "STATE NEW_SELECTED_OLD_RUNNING"
expect "current=NEW previous=OLD" links_are "$NEWID" "$OLD_ID"; expect "tells the OWNER to restart (printed, not run)" has "OWNER now runs: sudo systemctl restart afldb"; expect "no restart executed" no_bad_calls
case_ "d3a: promotion REFUSED by release.mjs"
d3a_world; printf 'refuse\n' > "$ST/promote_mode"; run d3a
fail_phase d3a "promote refused (no link moved; run probe)"; expect "links unmoved" unchanged; expect "only the refused promote was attempted; no rollback" muts_are "promote $NEWID"
expect "no restart instruction" lacks "OWNER now runs"
case_ "d3a: promote reports success but the state is not NEW_SELECTED_OLD_RUNNING"
d3a_world; printf 'noop\n' > "$ST/promote_mode"; run d3a; fail_phase d3a "state is not NEW_SELECTED_OLD_RUNNING"; expect "no rollback" no_node rollback
case_ "d3a: state is not OLD_SERVING before the promotion (links already odd)"
d3a_world; set_proc 4242 deadbeef0000-OTHER 1; run d3a; fail_phase d3a "state is not OLD_SERVING"; expect "no promote" no_node promote
case_ "d3a: missing new-id.txt"
d3a_world; rm -f "$W/d/new-id.txt"; run d3a; fail_phase d3a "NEWFILE does not hold a new release id"; expect "no promote" no_node promote
case_ "d3a: invalid new-id.txt"
d3a_world; newfile 'ea98a35f2061-NOTMINE'; run d3a; fail_phase d3a "NEWFILE does not hold a new release id"; expect "no promote" no_node promote
d3a_world; newfile 'a0b1080f5b98-bad id;rm'; run d3a; fail_phase d3a "NEWFILE does not hold a new release id"; expect "no promote (injected text)" no_node promote

# ================================================================ d3c (after the owner's restart)
restarted_new() { set_proc 4343 "$NEWID" 1; }
d3c_world() { world H; newrel; write_baseline; newfile; set_links "$NEWID" "$OLD_ID"; restarted_new; snap; }
case_ "d3c: PASS with the baseline preserved (journal names NEW_ID)"
d3c_world; echo "serving build x release $NEWID revision a0b1080f5b98" > "$ST/journal"; run d3c
pass_phase d3c; expect "state NEW_SERVING proved" has "STATE NEW_SERVING"; expect "journal checked" has "journal: serving build names $NEWID"; expect "no mutator" muts_are ""; expect "nothing moved" unchanged
case_ "d3c: journal line names another release"
d3c_world; echo "serving build x release $OLD_ID revision ea98a35f2061" > "$ST/journal"; run d3c; fail_phase d3c "does not name $NEWID"
case_ "d3c: STOP when the new process lacks the trigger"
d3c_world; set_proc 4343 "$NEWID" 0; run d3c; fail_phase d3c "EFFECTIVE AFLDB_SETTLE_TRIGGER=systemd count in the restarted process is not exactly 1"
case_ "d3c: STOP when the new process has the trigger twice"
d3c_world; set_proc 4343 "$NEWID" 2; run d3c; fail_phase d3c "not exactly 1"
case_ "d3c: STOP when the match timer's next elapse changed"
d3c_world; echo "Tue 2099-11-05 05:01:47" > "$ST/timer_next"; run d3c; fail_phase d3c "match timer next elapse changed"
case_ "d3c: STOP when the service did not restart"
d3c_world; set_proc 4242 "$NEWID" 1; run d3c; fail_phase d3c "MainPID unchanged since the baseline"
case_ "d3c: STOP when the .env trigger count changed"
d3c_world; printf 'AFLDB_SETTLE_TRIGGER=systemd\nAFLDB_SETTLE_TRIGGER=systemd\n' > "$W/chk/.env"; run d3c; fail_phase d3c ".env trigger line count changed"
case_ "d3c: STOP when a timer's enablement changed"
d3c_world; echo enabled > "$ST/enabled_afldb-settle-afltables.timer"; run d3c; fail_phase d3c "timer enablement changed"
case_ "d3c: STOP when the post-install check fails"
d3c_world; echo "$NEWID" > "$ST/postchk_fail"; run d3c; fail_phase d3c "post-install check did not PASS"
case_ "d3c: missing new-id.txt"
d3c_world; rm -f "$W/d/new-id.txt"; run d3c; fail_phase d3c "NEWFILE does not hold a new release id"

# ================================================================ probe
case_ "probe: OLD_SERVING, read-only, exit 0"
world H; newrel; write_baseline; snap; run probe
expect "exits 0" rcis 0; expect "prints the state" has "STATE OLD_SERVING"; expect "no mutator" muts_are ""; expect "nothing moved" unchanged
case_ "probe: new-id.txt missing -> '-' (informational), exit 0"
world H; run probe; expect "exits 0" rcis 0; expect "NEW_ID not set" has "NEW_ID   (not set)"
case_ "probe: UNCERTAIN is informational (exit 0), state printed"
world H; newfile; set_proc 4242 deadbeef0000-OTHER 1; run probe; expect "exits 0" rcis 0; expect "prints UNCERTAIN" has "STATE UNCERTAIN"
case_ "probe: FAILED underlying probe (exit 2, invalid NEW_ID text) is propagated and its diagnostic kept"
world H; newfile 'not a release id'; run probe
expect "phase exit status is the probe's 2" rcis 2; expect "the probe's diagnostic is preserved" has "NEW_ID is not a release id"; expect "phase says FAIL with the status" has "D31612 probe FAIL (the state probe exited 2"
case_ "probe: FAILED underlying probe (exit 7 from the probe script) is propagated and its diagnostic kept"
world H; printf '#!/bin/bash\necho "probe diagnostic: could not read the unit"\nexit 7\n' > "$W/chk/$PKGG/state-probe.sh"; run probe
expect "phase exit status is 7" rcis 7; expect "diagnostic preserved" has "probe diagnostic: could not read the unit"; expect "no mutator" muts_are ""
G checkout -q -- "$PKGG/state-probe.sh"
case_ "probe: the probe script is missing (shell exit 127) is propagated"
world H; rm -f "$W/chk/$PKGG/state-probe.sh"; run probe; expect "phase exit status is 127" rcis 127; expect "says FAIL" has "D31612 probe FAIL"
G checkout -q -- "$PKGG/state-probe.sh"
case_ "probe MUTATION CONTROL 3: the unfixed variant exits 0 on a failed probe"
world H; newfile 'not a release id'; run probe "$W/phase-m3.sh"; expect "unfixed variant exits 0 (defect reproduced)" rcis 0

# ================================================================ r2 (links-only recovery before any restart)
r2_world() { world H; newrel; write_baseline; newfile; set_links "$NEWID" "$OLD_ID"; snap; }
case_ "r2: NEW_SELECTED_OLD_RUNNING -> link-only recovery PASS"
r2_world; run r2
pass_phase r2; expect "only rollback --to OLD_ID mutated" muts_are "rollback --to $OLD_ID"; expect "links current=OLD" links_are "$OLD_ID" "$NEWID"
expect "post-install check ran on OLD_ID" grep -q "^POSTCHK $OLD_ID" "$LOG"; expect "state OLD_SERVING" has "STATE OLD_SERVING"; expect "no restart/sudo/systemctl mutation" no_bad_calls; expect "no restart instruction" lacks "systemctl restart"
case_ "r2: OLD_SERVING -> no rollback, no restart instruction"
world H; newrel; write_baseline; newfile; snap; run r2
fail_phase r2 "r2 applies only to NEW_SELECTED_OLD_RUNNING"; expect "no rollback" no_node rollback; expect "no mutator" muts_are ""; expect "no restart instruction" lacks "restart"; expect "nothing moved" unchanged
case_ "r2: NEW_SERVING (already restarted) -> no rollback; r3 is the path"
r2_world; restarted_new; snap; run r2; fail_phase r2 "r2 applies only to NEW_SELECTED_OLD_RUNNING"; expect "no rollback" no_node rollback; expect "nothing moved" unchanged
case_ "r2: UNCERTAIN -> act on nothing"
r2_world; set_proc 4242 deadbeef0000-OTHER 1; snap; run r2; fail_phase r2 "r2 applies only"; expect "no rollback" no_node rollback; expect "nothing moved" unchanged
case_ "r2: rollback --to OLD_ID refused (OLD_ID fails its manifest check)"
r2_world; printf 'refuse\n' > "$ST/rollback_mode"; run r2; fail_phase r2 "rollback --to OLD_ID refused (state R5: change nothing)"
expect "only the refused rollback attempted" muts_are "rollback --to $OLD_ID"; expect "links unmoved" unchanged; expect "no post-install check, no restart" bash -c "! grep -q '^POSTCHK' '$LOG'"
case_ "r2: post-install check on OLD_ID fails after the links moved (failed old-release verification)"
r2_world; echo "$OLD_ID" > "$ST/postchk_fail"; run r2; fail_phase r2 "post-install check on OLD_ID did not PASS"; expect "no restart executed" no_bad_calls
case_ "r2: missing new-id.txt"
r2_world; rm -f "$W/d/new-id.txt"; snap; run r2; fail_phase r2 "NEWFILE does not hold a new release id"; expect "no rollback" no_node rollback; expect "nothing moved" unchanged
case_ "r2: invalid new-id.txt"
r2_world; newfile 'garbage'; snap; run r2; fail_phase r2 "NEWFILE does not hold a new release id"; expect "no rollback" no_node rollback

# ================================================================ r3-links (recovery after the new release started)
r3l_world() { world H; newrel; write_baseline; newfile; set_links "$NEWID" "$OLD_ID"; restarted_new; snap; }
case_ "r3-links: after the new release started -> links back to OLD_ID"
r3l_world; run r3-links
pass_phase r3-links; expect "only rollback --to OLD_ID mutated" muts_are "rollback --to $OLD_ID"; expect "current=OLD previous=NEW" links_are "$OLD_ID" "$NEWID"
expect "owner restart instruction printed" has "OWNER now runs: sudo systemctl restart afldb"; expect "start-limit-hit recovery text printed" has "sudo systemctl reset-failed afldb && sudo systemctl start afldb"
expect "none of it executed" no_bad_calls
case_ "r3-links: OLD_SERVING (current already OLD_ID) -> no rollback, no restart instruction"
world H; newrel; write_baseline; newfile; snap; run r3-links
fail_phase r3-links "roll back only when NEW_ID is the selected release"; expect "no rollback" no_node rollback; expect "no restart instruction" lacks "OWNER now runs"; expect "nothing moved" unchanged
case_ "r3-links: rollback --to OLD_ID refused"
r3l_world; printf 'refuse\n' > "$ST/rollback_mode"; run r3-links; fail_phase r3-links "rollback --to OLD_ID refused (state R5: change nothing)"; expect "links unmoved" unchanged; expect "no restart instruction" lacks "OWNER now runs"
case_ "r3-links: rollback reports success but current did not move"
r3l_world; printf 'noop\n' > "$ST/rollback_mode"; run r3-links; fail_phase r3-links "current is not OLD_ID"; expect "no restart instruction" lacks "OWNER now runs"
case_ "r3-links: missing new-id.txt"
r3l_world; rm -f "$W/d/new-id.txt"; run r3-links; fail_phase r3-links "NEWFILE does not hold a new release id"; expect "no rollback" no_node rollback
case_ "r3-links: invalid new-id.txt"
r3l_world; newfile 'a0b1080f5b98-'; run r3-links; fail_phase r3-links "NEWFILE does not hold a new release id"; expect "no rollback" no_node rollback

# ================================================================ r3-verify (after the owner's recovery restart)
r3v_world() { world H; newrel; write_baseline; newfile; set_links "$OLD_ID" "$NEWID"; set_proc 4444 "$OLD_ID" 1; snap; }
case_ "r3-verify: OLD_ID serving, trigger/.env/timer state preserved -> PASS"
r3v_world; run r3-verify
pass_phase r3-verify; expect "state OLD_SERVING proved" has "STATE OLD_SERVING"; expect "post-install check ran on OLD_ID" grep -q "^POSTCHK $OLD_ID" "$LOG"; expect "helper ran" grep -q '^HELPER obs timer' "$LOG"
expect "read-only: no mutator" muts_are ""; expect "nothing moved" unchanged; expect "no secrets: no env VALUES printed" lacks "LANG="
case_ "r3-verify: the restored process has NO effective AFLDB_SETTLE_TRIGGER"
r3v_world; set_proc 4444 "$OLD_ID" 0; run r3-verify; fail_phase r3-verify "EFFECTIVE AFLDB_SETTLE_TRIGGER=systemd count in the restarted process is not exactly 1"; expect "no mutator" muts_are ""
case_ "r3-verify: the restored process has the trigger TWICE"
r3v_world; set_proc 4444 "$OLD_ID" 2; run r3-verify; fail_phase r3-verify "not exactly 1"
case_ "r3-verify: the restored process environment is unreadable"
r3v_world; rm -f "$W/proc/4444/environ"; run r3-verify; fail_phase r3-verify "environment is not readable"
case_ "r3-verify: .env trigger count differs from the baseline (0)"
r3v_world; printf 'FOO=1\n' > "$W/chk/.env"; run r3-verify; fail_phase r3-verify ".env trigger line count changed"
case_ "r3-verify: .env trigger count differs from the baseline (2)"
r3v_world; printf 'AFLDB_SETTLE_TRIGGER=systemd\nAFLDB_SETTLE_TRIGGER=systemd\n' > "$W/chk/.env"; run r3-verify; fail_phase r3-verify ".env trigger line count changed"
case_ "r3-verify: match timer next elapse changed"
r3v_world; echo "Tue 2099-11-05 05:01:47" > "$ST/timer_next"; run r3-verify; fail_phase r3-verify "match timer next elapse changed"
case_ "r3-verify: match timer last trigger changed"
r3v_world; echo "Tue 2026-11-04 05:00:00" > "$ST/timer_last"; run r3-verify; fail_phase r3-verify "match timer last trigger changed"
case_ "r3-verify: timer enablement changed"
r3v_world; echo enabled > "$ST/enabled_afldb-settle-afl-api-brownlow.timer"; run r3-verify; fail_phase r3-verify "timer enablement changed"
case_ "r3-verify: no baseline -> preservation cannot be proven"
r3v_world; rm -f "$W/d/baseline.txt"; run r3-verify; fail_phase r3-verify "no baseline"
case_ "r3-verify: the owner has not restarted yet (OLD_SELECTED_NEW_RUNNING)"
r3v_world; set_proc 4343 "$NEWID" 1; run r3-verify; fail_phase r3-verify "state is not OLD_SERVING"
case_ "r3-verify: the service was never restarted (MainPID unchanged since the baseline)"
r3v_world; set_proc 4242 "$OLD_ID" 1; run r3-verify; fail_phase r3-verify "MainPID unchanged since the baseline"
case_ "r3-verify: uncertain state"
r3v_world; set_proc 4444 deadbeef0000-OTHER 1; run r3-verify; fail_phase r3-verify "state is not OLD_SERVING"
case_ "r3-verify: post-install check on OLD_ID fails (failed old-release verification)"
r3v_world; echo "$OLD_ID" > "$ST/postchk_fail"; run r3-verify; fail_phase r3-verify "post-install check on OLD_ID did not PASS"; expect "stopped before the probe" bash -c "! grep -qF 'STATE' '$OUT'"
case_ "r3-verify: the read-only timer/setting helper fails"
r3v_world; printf '1\n' > "$ST/obs_exit"; run r3-verify; fail_phase r3-verify "timer/setting helper did not PASS"
case_ "r3-verify: previous is not NEW_ID"
r3v_world; set_links "$OLD_ID" "$OLD_PREV"; run r3-verify; fail_phase r3-verify "previous is not NEW_ID after the recovery"
case_ "r3-verify: missing new-id.txt"
r3v_world; rm -f "$W/d/new-id.txt"; run r3-verify; fail_phase r3-verify "NEWFILE does not hold a new release id"
case_ "r3-verify MUTATION CONTROL 2: without the preservation comparison a missing effective trigger is wrongly accepted"
r3v_world; set_proc 4444 "$OLD_ID" 0; run r3-verify "$W/phase-m2.sh"
expect "unfixed variant PASSES with no trigger in the process (defect reproduced)" bash -c "[ $RC = 0 ] && grep -qF 'D31612 r3-verify PASS' '$OUT'"

# ================================================================ end-to-end chains with a REAL d1 baseline
case_ "chain A: pa -> d1 -> d2 -> d3a -> owner restart -> d3c (acceptance path)"
world c0
run pa; pass_phase pa
run d1; pass_phase d1
TMUXV=1; run d2; pass_phase d2; TMUXV=""
run d3a; pass_phase d3a
set_proc 4343 "$NEWID" 1                                   # the OWNER's `sudo systemctl restart afldb`, simulated by the harness only
run d3c; pass_phase d3c
expect "only build + promote mutated, in order" muts_are "$(printf 'build\npromote %s' "$NEWID")"
case_ "chain A cont.: r3-links -> owner recovery restart -> r3-verify (recovery after the new release started, real baseline)"
run r3-links; pass_phase r3-links
set_proc 4444 "$OLD_ID" 1                                  # the OWNER's recovery restart, simulated
run r3-verify; pass_phase r3-verify
expect "mutators over the whole chain: build, promote, rollback --to OLD_ID only" muts_are "$(printf 'build\npromote %s\nrollback --to %s' "$NEWID" "$OLD_ID")"
case_ "chain B: pa -> d1 -> d2 -> d3a -> r2 (abandon before any restart)"
world c0
run pa; pass_phase pa
run d1; pass_phase d1
TMUXV=1; run d2; pass_phase d2; TMUXV=""
run d3a; pass_phase d3a
run r2; pass_phase r2
expect "links back: current=OLD_ID" links_are "$OLD_ID" "$NEWID"
expect "mutators: build, promote, rollback --to OLD_ID only" muts_are "$(printf 'build\npromote %s\nrollback --to %s' "$NEWID" "$OLD_ID")"

# ================================================================ global invariant
case_ "global: no disallowed or unknown call in ANY test of this run"
cat "$LOG" >> "$W/all-calls.log"
echo "(stub calls over the whole run: $(wc -l < "$W/all-calls.log") lines; node release.mjs calls by subcommand: $(grep -oE '^NODE deploy/release.mjs [a-z]+' "$W/all-calls.log" | sed 's/.*mjs //' | sort | uniq -c | tr '\n' ' '))"
expect "no systemctl restart/start/stop/reset-failed/enable/disable, no sudo, no unqualified rollback, no unknown stub call" bash -c "! grep -qE 'DISALLOWED|UNKNOWN' '$W/all-calls.log'"

echo
echo "RESULT: $PASS passed, $FAIL failed ($((PASS + FAIL)) assertions)"
[ "$FAIL" -eq 0 ] && { echo "MOCK TEST PASS"; exit 0; }
echo "MOCK TEST FAIL"; exit 1
