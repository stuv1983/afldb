#!/usr/bin/env bash
# Usage (on the Linux harness host): bash tests.sh <orig|a1>   -- runs every case against $H/blocks-<set>/
source "$(dirname "$0")/lib.sh"
SET=${1:?orig|a1}; B=$H/blocks-$SET; RAW=$H/raw-$SET; rm -rf "$RAW"; mkdir -p "$RAW"; : > "$RAW/SUMMARY.txt"
FX=$H/fixtures
ensure_origin
echo "harness set=$SET host=$(hostname) bash=$BASH_VERSION git=$(git --version) $(date -u +%FT%TZ)" | tee "$RAW/SUMMARY.txt"
for f in "$B"/*.sh; do echo "block $(basename "$f") $(sha256sum < "$f" | cut -c1-64)"; done >> "$RAW/SUMMARY.txt"

stageA() { mkdir -p "$HT/home/b1a-r6r-$STAMP"; cp "$FX/art/prod/"* "$HT/home/b1a-r6r-$STAMP/"; }
stageD() { # a completed P3 state: D with dump + sha + before capture (+ optional before-check verdict), artifacts installed in checkout
  local d=$HT/home/backups/afldb-b1a-$STAMP; mkdir -p "$d"; head -c 4096 /dev/zero > "$d/afldb_prod-20261118-001500.dump"
  (cd "$d" && sha256sum afldb_prod-20261118-001500.dump > afldb_prod-20261118-001500.dump.sha256)
  cp "${1:-$FX/accept-before.txt}" "$d/accept-before-prod.txt"; [ -n "${2:-}" ] && echo "$2" > "$d/before-check.txt"
  mkdir -p "$H/chk/docs/v2/evidence/remediation-20261114/run6r/b1a"
  cp "$FX/art/prod/b1a-repair-2026-r6r.mts" "$FX/art/prod/b1a-accept-r6r.sql" "$H/chk/docs/v2/evidence/remediation-20261114/run6r/b1a/"
}
DSHA=$(head -c 4096 /dev/zero | sha256sum | cut -d' ' -f1)
p5args() { if [ "$SET" = a1 ]; then echo "$STAMP VERDICT-PASS ${1:-$DSHA}"; else echo "$STAMP"; fi; }

# ---------------- P1 (read-only precheck) ----------------
newcase p1-ok "$H0" "$PREP"; run "$B/p1-s1-precheck.sh"; expect "precheck PASS at H0, origin=PREP" 'P1 RESULT PASS'
FUT=$(git -c user.name=harness -c user.email=harness@invalid -C "$H/origin.git" commit-tree "$(git -C "$H/origin.git" rev-parse "$PREP^{tree}")" -p "$PREP" -m "future docs-only (harness)")
newcase p1-origin-future "$H0" "$FUT"; run "$B/p1-s1-precheck.sh"
if [ "$SET" = a1 ]; then expect "remote drift stops P1" 'STOP line' 'P1 RESULT PASS'; else expect "original P1 has no remote check" 'P1 RESULT PASS'; fi
newcase p1-no-tsx "$H0" "$PREP"; rm -rf "$H/chk/node_modules/tsx"; run "$B/p1-s1-precheck.sh"
if [ "$SET" = a1 ]; then expect "missing tsx stops" 'STOP line' 'P1 RESULT PASS'; else expect "DEFECT reproduced: missing tsx passes" 'P1 RESULT PASS'; fi
newcase p1-settle-active "$H0" "$PREP"; export STUB_ACTIVE_afldb_settle_afl_api_service=active; run "$B/p1-s1-precheck.sh"; unset STUB_ACTIVE_afldb_settle_afl_api_service
expect "active settle stops" 'STOP line' 'P1 RESULT PASS'
newcase p1-writer-proc "$H0" "$PREP"; export STUB_PGREP='1234 pg_dump afldb_prod'; run "$B/p1-s1-precheck.sh"; unset STUB_PGREP
expect "writer process stops" 'STOP line' 'P1 RESULT PASS'
newcase p1-wrong-head "$CP" "$PREP"; run "$B/p1-s1-precheck.sh"; expect "HEAD not c1c4b22e stops" 'STOP line' 'P1 RESULT PASS'

# ---------------- P2 (git pin) ----------------
newcase p2-pin-ok "$H0" "$PREP"; run "$B/p2-s2-ff.sh" "$STAMP"
expect "origin=PREP: PASS, HEAD=CP" 'P2 RESULT PASS'; echo "HEAD after $(git -C "$H/chk" rev-parse HEAD)" >> "$RAW/$CASE.txt"
newcase p2-origin-at-CP "$H0" "$CP"; run "$B/p2-s2-ff.sh" "$STAMP"
if [ "$SET" = a1 ]; then expect "origin=a2e6ea99 refused (drift)" 'STOP unexpected remote drift' 'P2 RESULT PASS'; else expect "origin=a2e6ea99 accepted by original" 'P2 RESULT PASS'; fi
newcase p2-origin-at-c34ae24d "$H0" c34ae24d610eab4d05adfd908de426173d077c94; run "$B/p2-s2-ff.sh" "$STAMP"
if [ "$SET" = a1 ]; then expect "origin=c34ae24d refused" 'STOP unexpected remote drift' 'P2 RESULT PASS'; else expect "origin=c34ae24d accepted by original" 'P2 RESULT PASS'; fi
# a future docs-only commit on top of PREP
FUT=$(git -c user.name=harness -c user.email=harness@invalid -C "$H/origin.git" commit-tree "$(git -C "$H/origin.git" rev-parse "$PREP^{tree}")" -p "$PREP" -m "future docs-only (harness)")
newcase p2-origin-future-docs "$H0" "$FUT"; run "$B/p2-s2-ff.sh" "$STAMP"
if [ "$SET" = a1 ]; then expect "future docs-only origin refused" 'STOP unexpected remote drift' 'P2 RESULT PASS'; else expect "DEFECT reproduced: future docs-only origin accepted by original" 'P2 RESULT PASS'; fi
newcase p2-start-dirty "$H0" "$PREP"; echo x > "$H/chk/stray.txt"; run "$B/p2-s2-ff.sh" "$STAMP"
expect "dirty checkout stops before fetch" 'STOP line' 'P2 RESULT PASS'
newcase p2-start-wrong-head "$PREP" "$PREP"; run "$B/p2-s2-ff.sh" "$STAMP"
expect "start HEAD not H0/CP stops" 'STOP' 'P2 RESULT PASS'
newcase p2-status-fails-then-rerun "$H0" "$PREP"; export STUB_REL_status_RC=1; run "$B/p2-s2-ff.sh" "$STAMP"; unset STUB_REL_status_RC
expect "status failure stops P2" 'STOP line' 'P2 RESULT PASS'
cp "$RAW/$CASE.txt" "$RAW/$CASE.first.txt"; : > "$HT/calls.log"; run "$B/p2-s2-ff.sh" "$STAMP"
if [ "$SET" = a1 ]; then expect "re-run after post-ff failure passes" 'P2 RESULT PASS'; else expect "DEFECT reproduced: re-run refused after post-ff failure" 'STOP' 'P2 RESULT PASS'; fi
newcase p2-A-exists-nonempty "$H0" "$PREP"; mkdir -p "$HT/home/b1a-r6r-$STAMP"; touch "$HT/home/b1a-r6r-$STAMP/x"; run "$B/p2-s2-ff.sh" "$STAMP"
expect "non-empty pre-existing A stops" 'STOP' 'P2 RESULT PASS'
newcase p2-bad-stamp "$H0" "$PREP"; run "$B/p2-s2-ff.sh" "2026-11-18"
expect "malformed STAMP stops before any git write" 'STOP' 'P2 RESULT PASS'

# ---------------- P3 (guard, dump proof, BEFORE-CHECK) ----------------
newcase p3-ok; stageA; run "$B/p3-b1a0-dump.sh" "$STAMP"
expect "normal: BEFORE-CHECK PASS" 'BEFORE-CHECK PASS' 'STOP line'
[ "$SET" = a1 ] && { grep -qx 'BEFORE-CHECK PASS' "$HT/home/backups/afldb-b1a-$STAMP/before-check.txt" && echo "PASS  $CASE: verdict persisted" || echo "FAIL  $CASE: verdict persisted"; } | tee -a "$RAW/SUMMARY.txt"
grep -q 'PGPASSWORD_set=yes' "$HT/calls.log" && ! grep -q 'p%40ss\|p@ss' "$HT/calls.log" && echo "PASS  $CASE: password not in psql argv" | tee -a "$RAW/SUMMARY.txt" || echo "FAIL  $CASE: password argv" | tee -a "$RAW/SUMMARY.txt"
grep -q "backup.sh --dir $HT/home/backups/afldb-b1a-$STAMP --keep 1000" "$HT/calls.log" && echo "PASS  $CASE: backup --dir new --keep 1000" | tee -a "$RAW/SUMMARY.txt" || echo "FAIL  $CASE: backup args" | tee -a "$RAW/SUMMARY.txt"
newcase p3-wrong-head "$H0"; stageA; run "$B/p3-b1a0-dump.sh" "$STAMP"
if [ "$SET" = a1 ]; then expect "wrong HEAD stops before install/dump" 'STOP line' 'DUMP '; else expect "DEFECT reproduced: wrong HEAD not stopped, dump taken" 'DUMP '; fi
newcase p3-dirty; stageA; echo x > "$H/chk/stray.txt"; run "$B/p3-b1a0-dump.sh" "$STAMP"
if [ "$SET" = a1 ]; then expect "dirty checkout stops before dump" 'STOP line' 'DUMP '; else expect "DEFECT reproduced: dirty checkout not stopped" 'DUMP '; fi
newcase p3-artifact-hash-bad; stageA; echo tamper >> "$HT/home/b1a-r6r-$STAMP/b1a-accept-r6r.sql"; run "$B/p3-b1a0-dump.sh" "$STAMP"
expect "tampered artifact stops" 'STOP line' 'DUMP '
newcase p3-before-diff; stageA; export STUB_ACCEPT=$FX/accept-before-drift.txt; run "$B/p3-b1a0-dump.sh" "$STAMP"; unset STUB_ACCEPT
expect "drifted BEFORE capture: FAIL" 'BEFORE-CHECK FAIL' 'BEFORE-CHECK PASS'
newcase p3-dump-pending; stageA; export STUB_DUMP_ROWS=668; run "$B/p3-b1a0-dump.sh" "$STAMP"; unset STUB_DUMP_ROWS
if [ "$SET" = a1 ]; then expect "dump 2026 rows != 669: FAIL" 'BEFORE-CHECK FAIL'; else expect "original does not assert dump proof (prints only)" 'BEFORE-CHECK PASS'; fi
newcase p3-wrong-db-dump; stageA; export STUB_DUMP_DB=afldb_dev; run "$B/p3-b1a0-dump.sh" "$STAMP"; unset STUB_DUMP_DB
expect "dump header dbname not afldb_prod stops" 'STOP line' 'BEFORE-CHECK'
newcase p3-backup-fails; stageA; export STUB_BACKUP_RC=1; run "$B/p3-b1a0-dump.sh" "$STAMP"; unset STUB_BACKUP_RC
expect "backup failure stops" 'STOP line' 'BEFORE-CHECK'

# ---------------- P4 (DEV verify wrapper) ----------------
p4stage() { local w=$HT/ssd/afldb-b1a0-$STAMP; mkdir -p "$w/art/b1a" "$w/art/b1a0"; head -c 4096 /dev/zero > "$w/afldb_prod-20261118-001500.dump"
  (cd "$w" && sha256sum afldb_prod-20261118-001500.dump > afldb_prod-20261118-001500.dump.sha256)
  cp "$FX/art/dev/b1a/"* "$w/art/b1a/"; cp "$FX/art/dev/b1a0/"* "$w/art/b1a0/"; }
newcase p4-pass; p4stage; export STUB_VERIFY_LINE='VERDICT PASS backup proven by a fresh disposable restore'; run "$B/p4-dev-verify.sh" "$STAMP" "$DSHA" 4096; unset STUB_VERIFY_LINE
expect "verify rc0 + VERDICT PASS" 'P4 RESULT VERDICT PASS'
grep -q 'verify-stub PORT=61432' "$HT/calls.log" && echo "PASS  $CASE: PORT 61432 passed" | tee -a "$RAW/SUMMARY.txt" || echo "FAIL  $CASE: port" | tee -a "$RAW/SUMMARY.txt"
newcase p4-rc1-with-pass-line; p4stage; export STUB_VERIFY_LINE='VERDICT PASS backup proven by a fresh disposable restore' STUB_VERIFY_RC=1; run "$B/p4-dev-verify.sh" "$STAMP" "$DSHA" 4096; unset STUB_VERIFY_LINE STUB_VERIFY_RC
expect "verify rc1 is NOT PASS even with the line" 'P4 RESULT NOT PASS' 'RESULT VERDICT PASS'
newcase p4-fail-line; p4stage; export STUB_VERIFY_LINE='VERDICT FAIL'; run "$B/p4-dev-verify.sh" "$STAMP" "$DSHA" 4096; unset STUB_VERIFY_LINE
expect "VERDICT FAIL is NOT PASS" 'P4 RESULT NOT PASS' 'RESULT VERDICT PASS'
newcase p4-sha-mismatch; p4stage; run "$B/p4-dev-verify.sh" "$STAMP" "$(printf 'f%.0s' $(seq 64))" 4096
expect "wrong sha stops before verify" 'STOP line' 'verify-stub'
newcase p4-bytes-mismatch; p4stage; run "$B/p4-dev-verify.sh" "$STAMP" "$DSHA" 4097
expect "wrong size stops" 'STOP line' 'RESULT'
newcase p4-art-tamper; p4stage; echo x >> "$HT/ssd/afldb-b1a0-$STAMP/art/b1a0/b1a0-dev-restore-verify.sh"; run "$B/p4-dev-verify.sh" "$STAMP" "$DSHA" 4096
expect "tampered verify script stops" 'STOP line' 'RESULT'

# ---------------- P5 (dry run) ----------------
newcase p5-pass; stageA; stageD "" "BEFORE-CHECK PASS"; export STUB_DRY_OUT=$FX/dry-pass.txt; run "$B/p5-b1a-dryrun.sh" $(p5args); unset STUB_DRY_OUT
expect "dry run pass" 'P5 RESULT DRY-RUN PASS' 'NOT PASS'
newcase p5-fp-drift; stageA; stageD "" "BEFORE-CHECK PASS"; export STUB_DRY_OUT=$FX/dry-fpdrift.txt; run "$B/p5-b1a-dryrun.sh" $(p5args); unset STUB_DRY_OUT
expect "fingerprint drift: NOT PASS" 'P5 RESULT NOT PASS' 'DRY-RUN PASS$'
newcase p5-H-missing; stageA; stageD "$FX/accept-before-noH.txt" "BEFORE-CHECK PASS"; export STUB_DRY_OUT=$FX/dry-pass.txt; run "$B/p5-b1a-dryrun.sh" $(p5args); unset STUB_DRY_OUT
if [ "$SET" = a1 ]; then expect "missing H labels: NOT PASS" 'P5 RESULT NOT PASS'; else expect "DEFECT reproduced: missing H labels pass vacuously" 'P5 RESULT DRY-RUN PASS'; fi
newcase p5-runner-refused; stageA; stageD "" "BEFORE-CHECK PASS"; export STUB_DRY_OUT=$FX/out-refused.txt STUB_DRY_RC=1; run "$B/p5-b1a-dryrun.sh" $(p5args); unset STUB_DRY_OUT STUB_DRY_RC
expect "runner REFUSED exit 1: NOT PASS" 'P5 RESULT NOT PASS'
newcase p5-before-check-fail; stageA; stageD "" "BEFORE-CHECK FAIL: do not run B1a (packet 6R §4.2)"; export STUB_DRY_OUT=$FX/dry-pass.txt; run "$B/p5-b1a-dryrun.sh" $(p5args); unset STUB_DRY_OUT
if [ "$SET" = a1 ]; then expect "P3 FAIL on record: refused before runner" 'STOP line' 'runner mode'; else expect "DEFECT reproduced: original runs dry run despite BEFORE-CHECK FAIL" 'P5 RESULT DRY-RUN PASS'; fi
if [ "$SET" = a1 ]; then
  newcase p5-wrong-verified-sha; stageA; stageD "" "BEFORE-CHECK PASS"; export STUB_DRY_OUT=$FX/dry-pass.txt; run "$B/p5-b1a-dryrun.sh" $(p5args "$(printf 'e%.0s' $(seq 64))"); unset STUB_DRY_OUT
  expect "P4-verified sha != prod dump sha: refused before runner" 'STOP line' 'runner mode'
  newcase p5-no-verdict-arg; stageA; stageD "" "BEFORE-CHECK PASS"; run "$B/p5-b1a-dryrun.sh" "$STAMP"
  expect "missing VERDICT-PASS arg: refused" 'STOP line' 'runner mode'
fi
newcase p5-rerun-refused; stageA; stageD "" "BEFORE-CHECK PASS"; echo old > "$HT/home/b1a-r6r-$STAMP/dryrun.txt"; run "$B/p5-b1a-dryrun.sh" $(p5args)
expect "existing dryrun.txt: refused" 'STOP line' 'runner mode'

# ---------------- P6 (commit outcome classification + cleanup) ----------------
p6case() { # name, commit fixture, rc, after fixture, [p5 verdict]
  newcase "$1"; stageA; stageD "" "BEFORE-CHECK PASS"; cp "$FX/dry-pass.txt" "$HT/home/b1a-r6r-$STAMP/dryrun.txt"
  echo "${5:-P5 RESULT DRY-RUN PASS}" > "$HT/home/b1a-r6r-$STAMP/p5-result.txt"
  export STUB_COMMIT_OUT=$2 STUB_COMMIT_RC=$3 STUB_ACCEPT=$4; run "$B/p6-b1a-commit.sh" "$STAMP"; unset STUB_COMMIT_OUT STUB_COMMIT_RC STUB_ACCEPT
  [ -z "$(git -C "$H/chk" status --porcelain)" ] && echo "PASS  $CASE: checkout porcelain empty afterwards" | tee -a "$RAW/SUMMARY.txt" || echo "FAIL  $CASE: porcelain not empty" | tee -a "$RAW/SUMMARY.txt"
  echo "### exit code $RC" >> "$RAW/$CASE.txt"; }
p6case p6-committed "$FX/out-committed.txt" 0 "$FX/accept-after.txt"
expect "COMMITTED + exact" 'ACCEPTANCE-DIFF EXACT'; [ "$SET" = a1 ] && { [ "$RC" = 0 ] && grep -q '^P6 RESULT COMMITTED EXACT$' "$RAW/$CASE.txt" && echo "PASS  $CASE: verdict COMMITTED EXACT exit 0" || echo "FAIL  $CASE: verdict"; } | tee -a "$RAW/SUMMARY.txt"
grep -q 'runner mode=commit import_dsn_set=yes' "$HT/calls.log" && echo "PASS  $CASE: runner got --commit with the import DSN env" | tee -a "$RAW/SUMMARY.txt" || echo "FAIL  $CASE: runner args" | tee -a "$RAW/SUMMARY.txt"
for v in "unknown:4:out-unknown.txt:accept-after.txt" "unknown-notcommitted:4:out-unknown.txt:accept-before.txt" "already:3:out-already.txt:accept-after.txt" \
         "refused:1:out-refused.txt:accept-before.txt" "error:2:out-error.txt:accept-before.txt" "no-outcome:1:out-none.txt:accept-after.txt"; do
  IFS=: read -r nm code out acc <<<"$v"
  p6case "p6-$nm" "$FX/$out" "$code" "$FX/$acc"
  if [ "$SET" = a1 ]; then [ "$RC" = 3 ] && grep -q '^P6 RESULT ATTENTION' "$RAW/$CASE.txt" && ! grep -q 'COMMITTED EXACT' "$RAW/$CASE.txt" \
      && echo "PASS  $CASE: exit 3 ATTENTION -> R1 probe" || echo "FAIL  $CASE: classification (RC=$RC)"
  else [ "$RC" = 0 ] && echo "DEFECT reproduced  $CASE: original exits 0 with free-text result (runner exit $code)" || echo "INFO  $CASE: original RC=$RC"; fi | tee -a "$RAW/SUMMARY.txt"
done
newcase p6-accept-psql-fails; stageA; stageD "" "BEFORE-CHECK PASS"; cp "$FX/dry-pass.txt" "$HT/home/b1a-r6r-$STAMP/dryrun.txt"; echo "P5 RESULT DRY-RUN PASS" > "$HT/home/b1a-r6r-$STAMP/p5-result.txt"
export STUB_COMMIT_OUT=$FX/out-committed.txt STUB_COMMIT_RC=0 STUB_ACCEPT=$FX/accept-after.txt STUB_PSQL_RC=2; run "$B/p6-b1a-commit.sh" "$STAMP"; unset STUB_COMMIT_OUT STUB_COMMIT_RC STUB_ACCEPT STUB_PSQL_RC
expect "acceptance query failure is NOT EXACT" 'ACCEPTANCE-DIFF NOT EXACT' 'DIFF EXACT$'
p6case p6-p5-notpass "$FX/out-committed.txt" 0 "$FX/accept-after.txt" "P5 RESULT NOT PASS: no commit; packet 6R §4.2"
if [ "$SET" = a1 ]; then expect "P5 NOT PASS on record: commit refused" 'STOP line' 'runner mode'; else expect "DEFECT reproduced: original commits despite P5 NOT PASS" 'OUTCOME COMMITTED'; fi
if [ "$SET" = a1 ]; then run "$B/r3-remove-artifacts.sh"; expect "after refused P6, R3 removes the artifacts (SITTING: R3 then R1)" "R3 RESULT porcelain empty"; fi
newcase p6-rerun-refused; stageA; stageD "" "BEFORE-CHECK PASS"; cp "$FX/dry-pass.txt" "$HT/home/b1a-r6r-$STAMP/dryrun.txt"; echo "P5 RESULT DRY-RUN PASS" > "$HT/home/b1a-r6r-$STAMP/p5-result.txt"; echo old > "$HT/home/b1a-r6r-$STAMP/commit.txt"
run "$B/p6-b1a-commit.sh" "$STAMP"; expect "existing commit.txt: never re-run" 'STOP line' 'runner mode'

# ---------------- P7 / P7b (build in tmux, id parse) ----------------
newcase p7-build-ok; export STUB_BUILD_OUT=$FX/build-ready.txt; run "$B/p7-s3-build.sh"; unset STUB_BUILD_OUT
expect "build finished in wait" 'P7 build finished'
grep -F -- "[--typecheck-evidence] [npm run typecheck rc 0 on Linux (DEV streamanator, node v22.23.2) at f6af6da9 (run5/T2-QUALIFICATION.md section 2); C-prime a2e6ea99 = f6af6da9 + records-only]" "$HT/calls.log" >/dev/null \
  && echo "PASS  $CASE: evidence string reached release.mjs as ONE argument intact" | tee -a "$RAW/SUMMARY.txt" || echo "FAIL  $CASE: evidence quoting" | tee -a "$RAW/SUMMARY.txt"
LOG=$(sed -n 's/^LOG //p' "$RAW/$CASE.txt"); cp "$LOG" "$RAW/$CASE.buildlog.txt"
run "$B/p7b-s3-build-check.sh" "$LOG"; mv "$RAW/$CASE.txt" "$RAW/$CASE.p7b.txt"; cp "$RAW/$CASE.p7b.txt" "$RAW/$CASE.txt"
expect "P7b parses READY id" 'P7b RESULT BUILD PASS a2e6ea9995a4-TESTid_01'
newcase p7b-build-failed; L=$HT/home/b1-build-20261118T000000Z.log; mkdir -p "$HT/home"; printf 'release: building\nBUILD_EXIT=1\n' > "$L"; run "$B/p7b-s3-build-check.sh" "$L"
expect "BUILD_EXIT=1 stops" 'STOP line' 'BUILD PASS'
newcase p7b-bad-log-path; run "$B/p7b-s3-build-check.sh" "/tmp/evil.log"
expect "log path outside pattern refused" 'STOP line' 'BUILD PASS'
newcase p7-tmux-exists; export STUB_TMUX_EXISTS=1; run "$B/p7-s3-build.sh"; unset STUB_TMUX_EXISTS
expect "existing tmux session refused" 'STOP tmux session b1-build already exists'

# ---------------- P8 (gate, promote) ----------------
NEW=a2e6ea9995a4-TESTid_01
newcase p8-ok; mkdir -p "$HT/rel/releases/$NEW"; run "$B/p8-s4s5-gate-promote.sh" "$NEW"
expect "gate + promote PASS" 'P8 RESULT PROMOTED'
newcase p8-gate-refuses; mkdir -p "$HT/rel/releases/$NEW"; export STUB_REL_host_gate_RC=1; run "$B/p8-s4s5-gate-promote.sh" "$NEW"; unset STUB_REL_host_gate_RC
expect "gate refusal stops before promote" 'STOP line' 'stub promote'
newcase p8-half-switch; mkdir -p "$HT/rel/releases/$NEW"; export STUB_PROMOTE_HALF=1; run "$B/p8-s4s5-gate-promote.sh" "$NEW"; unset STUB_PROMOTE_HALF
expect "current moved but previous not: STOP (no PROMOTED)" 'STOP line' 'P8 RESULT PROMOTED'
newcase p8-rerun-after-promote; mkdir -p "$HT/rel/releases/$NEW"; run "$B/p8-s4s5-gate-promote.sh" "$NEW"; run "$B/p8-s4s5-gate-promote.sh" "$NEW"
expect "second P8 refused (links already moved)" 'STOP line' 'stub host-gate'
newcase p8-bad-id; run "$B/p8-s4s5-gate-promote.sh" "c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x"
expect "non-a2e6ea99 id refused" 'STOP line' 'stub'

# ---------------- P9 ----------------
newcase p9-plain; run "$B/p9-s7s8-checks.sh" "$NEW"; expect "plain path" 'P9 RESULT'
grep -q -- "status --expect $NEW$" "$HT/calls.log" && echo "PASS  $CASE: status --expect without confirm" | tee -a "$RAW/SUMMARY.txt"
newcase p9-confirm; run "$B/p9-s7s8-checks.sh" "$NEW" confirm; expect "confirm path" 'P9 RESULT'
grep -q -- "--confirm-attended-restart" "$HT/calls.log" && echo "PASS  $CASE: confirm flag passed to S7" | tee -a "$RAW/SUMMARY.txt"
newcase p9-s8-fails; export STUB_PIC_RC=1; run "$B/p9-s7s8-checks.sh" "$NEW"; unset STUB_PIC_RC; expect "S8 failure stops" 'STOP line' 'P9 RESULT'

# ---------------- R1 / R2 / R3 ----------------
newcase r1-probe; stageA; stageD "" "BEFORE-CHECK PASS"; printf 'OUTCOME COMMIT-UNKNOWN x\nexit=4\n' > "$HT/home/b1a-r6r-$STAMP/commit.txt"
export STUB_ACCEPT=$FX/accept-after.txt; run "$B/r1-state.sh" "$STAMP" probe; unset STUB_ACCEPT
expect "probe prints pending|669|0" 'pss2026\|pending\|669\|0'
if [ "$SET" = a1 ]; then expect "R1 shows the lost session's OUTCOME" 'OUTCOME COMMIT-UNKNOWN'; else expect "DEFECT reproduced: original R1 does not show commit.txt" 'probe exit=0' 'OUTCOME COMMIT-UNKNOWN'; fi
newcase r1-probe-no-A; export STUB_ACCEPT=$FX/accept-after.txt; run "$B/r1-state.sh" "$STAMP" probe; unset STUB_ACCEPT
expect "probe without A reports non-zero, no crash" 'probe exit=[1-9]'
newcase r2-links-after-promote; mkdir -p "$HT/rel/releases/$NEW"; ln -sfn "releases/$NEW" "$HT/rel/current"; ln -sfn "releases/$OLD_ID" "$HT/rel/previous"
run "$B/r2-rollback.sh" links; expect "rollback links to c1c4b22e" 'R2 RESULT LINKS ROLLED BACK'
run "$B/r2-rollback.sh" links; expect "second rollback refused (previous is now NEW)" 'STOP line'
run "$B/r2-rollback.sh" verify; expect "verify after rollback" 'R2 RESULT ROLLBACK VERIFIED'
newcase r2-half-promote; mkdir -p "$HT/rel/releases/$NEW"; ln -sfn "releases/$NEW" "$HT/rel/current"; run "$B/r2-rollback.sh" links
expect "half-switched promote: R2 refuses (owner needs --to)" 'STOP line' 'ROLLED BACK'
newcase r3-present; stageD "" ""; run "$B/r3-remove-artifacts.sh"; expect "removes artifacts, porcelain empty" 'R3 RESULT porcelain empty'
run "$B/r3-remove-artifacts.sh"; expect "idempotent second run" 'R3 RESULT porcelain empty'
newcase r3-other-untracked; stageD "" ""; echo x > "$H/chk/other.txt"; run "$B/r3-remove-artifacts.sh"; expect "unrelated untracked file: STOP, not deleted" 'STOP line'
[ -f "$H/chk/other.txt" ] && echo "PASS  $CASE: unrelated file left in place" | tee -a "$RAW/SUMMARY.txt"

echo "== totals: $(grep -c '^PASS' "$RAW/SUMMARY.txt") PASS, $(grep -c '^FAIL' "$RAW/SUMMARY.txt") FAIL, $(grep -c '^DEFECT' "$RAW/SUMMARY.txt") DEFECT-lines" | tee -a "$RAW/SUMMARY.txt"
