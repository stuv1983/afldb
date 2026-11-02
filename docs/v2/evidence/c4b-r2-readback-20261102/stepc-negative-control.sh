#!/bin/bash
# ISSUE-316 C4b r2: negative control for the `run.sh step-c` wrapper correction. Workstation / any Linux box; touches NO production and NO database.
#   bash stepc-negative-control.sh <fixed-run.sh> <original-run.sh>
# It extracts the real `step-c)` branch of each script (unmodified text), runs it in a throwaway sandbox with stubbed git/systemctl/tmux and a stub `q` that behaves like
# psql under ON_ERROR_STOP (prints `ERROR:` on stderr and returns 3) when its SQL contains $FAKE_Q_FAIL, and asserts:
#   1 fixed    + all queries succeed      -> exit 0 and "STEP-C DONE"
#   2 fixed    + a required query fails   -> exit non-zero, "STEP-C FAILED", and NO "STEP-C DONE"
#   3 original + the same failure         -> still "STEP-C DONE" and exit 0  (proves the control detects the defect)
#   4 fixed    + result.json has no run_id -> exit non-zero (an unanchored query must not silently pass)
set -u -o pipefail
FIXED=${1:?fixed run.sh}; ORIG=${2:?original run.sh}
SB=$(mktemp -d); trap 'rm -rf "$SB"' EXIT
mkdir -p "$SB/pkg" "$SB/chk/docs" "$SB/evd" "$SB/chk/data/sources/afl_api/matches"
# fake c-prod.sh: the two sourced ranges (14-18, 20-75) define the packaged readers; q mimics psql ON_ERROR_STOP
{ for i in $(seq 1 19); do echo ":"; done
  echo 'backup_identity() { echo "identity ok (stub)"; }'
  echo 'setting_raw() { if [ "${FAKE_SETTING_FAIL:-}" = 1 ]; then echo "ERROR:  stub setting failure" >&2; return 5; fi; echo false; }'
  echo 'q() { if [ -n "${FAKE_Q_FAIL:-}" ] && [[ "$*" == *"$FAKE_Q_FAIL"* ]]; then echo "ERROR:  column \"created_at\" does not exist" >&2; return 3; fi; echo "stub-row"; }'
  for i in $(seq 23 80); do echo ":"; done; } > "$SB/c-prod.sh"
printf 'PID=1\nNRESTARTS=0\nACTIVE_ENTER=1\n' > "$SB/pkg/step-a.txt"; echo 0 > "$SB/pkg/c4b-run.exit"
echo "x" > "$SB/evd/a.log"
CPSHA=$(sha256sum < "$SB/c-prod.sh" | cut -c1-64)

run_stepc() { # run_stepc <script> <result.json run_id: yes|no> ; env FAKE_* from caller ; prints output; returns the branch's exit status
  local script=$1 rid=$2 body
  if [ "$rid" = yes ]; then printf '{\n  "verdict": "CLEAR",\n  "run_id": "c4b-2026-11-02T083721874Z-3296445"\n}\n' > "$SB/evd/result.json"; else printf '{\n  "verdict": "CLEAR"\n}\n' > "$SB/evd/result.json"; fi
  body=$(awk '/^step-c\)/{f=1;next} f&&/^  ;;/{exit} f{print}' "$script")
  [ -n "$body" ] || { echo "could not extract step-c from $script"; return 99; }
  { echo 'set -u -o pipefail'
    echo "CHK=$SB/chk; PKGROOT=$SB/pkg; CPROD_REL=../c-prod.sh; CPROD_SHA=$CPSHA; N=$(printf 'a%.0s' $(seq 1 40))"
    echo 'git() { case "$*" in *rev-parse*) echo abc;; esac; }; systemctl() { case "$*" in *is-active*) echo inactive;; *is-enabled*) echo disabled;; *) echo 1;; esac; }; tmux() { echo "no server"; }'
    echo "set -- step-c \$N $SB/evd"
    echo 'EVD=${3}'
    echo "$body"
  } > "$SB/branch.sh"
  bash "$SB/branch.sh" 2>&1; return $?
}
FAIL=0
chk() { if [ "$2" = ok ]; then echo "  ok   $1"; else echo "  FAIL $1"; FAIL=$((FAIL+1)); fi; }

echo "== 1 fixed, all queries succeed"
out=$(FAKE_Q_FAIL= run_stepc "$FIXED" yes); rc=$?
[ "$rc" -eq 0 ] && grep -q '^STEP-C DONE' <<<"$out" && ! grep -q 'STEP-C FAILED' <<<"$out" && grep -q 'run start=2026-11-02T08:37:21.874Z' <<<"$out" && chk "exit 0, STEP-C DONE, run start parsed from the run id" ok || { chk "positive control" bad; echo "$out" | tail -8; }

echo "== 2 fixed, a required query fails (the import_batches read errors as psql would)"
out=$(FAKE_Q_FAIL=import_batches run_stepc "$FIXED" yes); rc=$?
[ "$rc" -ne 0 ] && grep -q 'STEP-C FAILED' <<<"$out" && ! grep -q '^STEP-C DONE' <<<"$out" && grep -q 'STEP-C QUERY FAILED' <<<"$out" && chk "non-zero exit ($rc), STEP-C FAILED, no STEP-C DONE" ok || { chk "negative control on the fixed script" bad; echo "$out" | tail -8; }

echo "== 2b fixed, the setting read fails"
out=$(FAKE_Q_FAIL= FAKE_SETTING_FAIL=1 run_stepc "$FIXED" yes); rc=$?
[ "$rc" -ne 0 ] && grep -q 'STEP-C FAILED' <<<"$out" && ! grep -q '^STEP-C DONE' <<<"$out" && chk "setting_raw failure propagates (exit $rc)" ok || { chk "setting_raw failure" bad; echo "$out" | tail -8; }

echo "== 3 original (pinned) script, the same failure: must still print DONE (the defect)"
out=$(FAKE_Q_FAIL=created_at run_stepc "$ORIG" yes); rc=$?
[ "$rc" -eq 0 ] && grep -q '^STEP-C DONE' <<<"$out" && grep -q 'ERROR:' <<<"$out" && chk "original: ERROR printed AND exit 0 AND STEP-C DONE (defect reproduced)" ok || { chk "defect not reproduced by the control" bad; echo "$out" | tail -8; }

echo "== 4 fixed, result.json without a run_id"
out=$(FAKE_Q_FAIL= run_stepc "$FIXED" no); rc=$?
[ "$rc" -ne 0 ] && grep -q 'no usable run_id' <<<"$out" && ! grep -q '^STEP-C DONE' <<<"$out" && chk "unanchored query refused (exit $rc)" ok || { chk "missing run_id" bad; echo "$out" | tail -8; }

[ "$FAIL" -eq 0 ] && { echo "STEPC NEGATIVE CONTROL PASS"; exit 0; } || { echo "STEPC NEGATIVE CONTROL FAILED ($FAIL)"; exit 1; }
