#!/usr/bin/env bash
# ISSUE-333 / O2 rehearsal: ONE scenario on ONE disposable clone. Runs inside `isolated-pg.ts run <clone> --` (which sets the DSNs) from the
# candidate checkout. Every check prints "CHECK PASS|FAIL <scenario> <what> exit=<n>"; nothing here decides by the writer's exit code alone:
# the outcome line printed by the ceremony (its own read-only probe) and the tool-independent digests are both retained.
#   bash scn.sh <scenario>        (EVROOT, W, AFLDB_PYTHON in the environment)
set -u -o pipefail
SCN=${1:?scenario}
OUT="$EVROOT/$SCN"; mkdir -m 700 "$OUT" || exit 2
PY="$AFLDB_PYTHON"
export PYTHONDONTWRITEBYTECODE=1 AFLDB_GAP029_DSN="$AFLDB_TEST_DATABASE_URL" AFLDB_GAP029_WRITE_DSN="$AFLDB_IMPORT_DATABASE_URL"
H() { "$PY" "$W/in/rehearsal_helper.py" "$@"; }
C1="tools/v2/issue333-coach-assignments-production.py"
C2="tools/v2/o2-converged-findings-production.py"
run() { local name=$1; shift; echo "--- $name: $*" | sed "s#$W#\$W#g"; "$@" > "$OUT/$name.out" 2>&1; local rc=$?; cat "$OUT/$name.out"; echo "    (exit $rc)"; return $rc; }
expect() { if [ "$2" = "$1" ]; then echo "CHECK PASS $SCN $3 exit=$2"; else echo "CHECK FAIL $SCN $3 exit=$2 expected=$1"; fi; }
has() { if grep -q "$2" "$OUT/$1.out"; then echo "CHECK PASS $SCN $1 says '$2'"; else echo "CHECK FAIL $SCN $1 lacks '$2'"; fi; }
fig() { cp "$W/in/coach-figures.mts" .coach-figures.mts; node --import tsx --conditions=react-server .coach-figures.mts "$OUT/$1.json"; local rc=$?; rm -f .coach-figures.mts; return $rc; }
digest_of() { "$PY" -c 'import json,sys; print(json.load(open(sys.argv[1]))["digest"])' "$1"; }
same() { "$PY" - "$OUT/digests-before.json" "$OUT/$1" "$2" <<'PYEOF'
import json, sys
a, b = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
keys = sys.argv[3].split(",")
bad = [k for k in keys if a[k] != b[k]]
print(("CHECK PASS " if not bad else "CHECK FAIL ") + f"digests unchanged {','.join(keys)}" + (f" -- changed {bad}" if bad else ""))
PYEOF
}
show() { "$PY" -c 'import json,sys; d=json.load(open(sys.argv[1])); print({k: d[k] for k in sys.argv[2].split(",")})' "$OUT/$1" "$2"; }
PRESERVE1="match_coaches_not_2026,coaches,import_batches_le_82,import_rejections,data_issues_41_76_unresolved,data_issues_other"
PRESERVE2="match_coaches_not_2026,match_coaches_2026,coaches,import_batches_le_82,import_batches_gt_82,data_issues_41_76_fixed_columns,data_issues_other,player_match_stats_flagged_rows"

H target > "$OUT/target.json" || exit 3
cat "$OUT/target.json"
H digests > "$OUT/digests-before.json" || exit 3
show digests-before.json "match_coaches_2026,sides_2026_without_coach,import_batches_gt_82,data_issues_41_76_unresolved,user_triggers_touched_tables"
T="$OUT/target.json"

plan1() { run "$1" "$PY" "$C1" plan --target "$T" --core-tar "$W/in/core.tar" --staging-dir "$OUT/staging-$1" --rehearsal --out "$OUT/$1.json"; }
plan2() { run "$1" "$PY" "$C2" plan --target "$T" --rehearsal --out "$OUT/$1.json"; }
apply1() { run "$1" "$PY" "$C1" apply --plan "$OUT/plan.json" --rehearsal --out "$OUT/$1.json"; }
apply2() { run "$1" "$PY" "$C2" apply --plan "$OUT/plan.json" --rehearsal --out "$OUT/$1.json"; }
state1() { run "$1" "$PY" "$C1" state --plan "$OUT/plan.json" --out "$OUT/$1.json"; }
state2() { run "$1" "$PY" "$C2" state --plan "$OUT/plan.json" --out "$OUT/$1.json"; }
killed() {   # $1 ceremony, $2 lock to hold, $3 writer application_name: the ceremony + writer are SIGKILLed while the writer waits on a held lock
  H hold-lock "$2" 120 > "$OUT/lock-holder.out" 2>&1 & local HOLDER=$!
  for i in $(seq 1 50); do grep -q LOCKED "$OUT/lock-holder.out" && break; sleep 0.2; done; cat "$OUT/lock-holder.out"
  setsid "$PY" "$1" apply --plan "$OUT/plan.json" --rehearsal --out "$OUT/apply-killed.json" > "$OUT/apply-killed.out" 2>&1 & local CPID=$!
  H wait-writer "$3" Lock 180 | tee "$OUT/wait-writer.out"
  kill -9 -- -"$CPID"; wait "$CPID" 2>/dev/null; echo "ceremony process group $CPID SIGKILLed while its writer waited on the lock (exit $?)"; cat "$OUT/apply-killed.out"
  sleep 2; kill "$HOLDER"; wait "$HOLDER" 2>/dev/null; echo "lock holder stopped"
  [ -e "$OUT/apply-killed.json" ] && echo "CHECK FAIL $SCN killed ceremony left an outcome record" || echo "CHECK PASS $SCN killed ceremony left no outcome record"
}
inflight() {  # $1 ceremony, $2 writer path, $3 writer application_name: SIGKILL ONLY the writer process while the server sleeps inside its COMMIT
  "$PY" "$1" apply --plan "$OUT/plan.json" --rehearsal --out "$OUT/apply-inflight.json" > "$OUT/apply-inflight.out" 2>&1 & local CPID=$!
  H wait-writer "$3" Timeout 300 | tee "$OUT/wait-writer.out"
  local WPID; WPID=$(pgrep -f "$2 apply --plan $OUT/plan.json" | head -1)
  kill -9 "$WPID"; echo "writer process $WPID SIGKILLed while the server was inside its COMMIT (deferred trigger sleeping)"
  wait "$CPID"; local rc=$?; cat "$OUT/apply-inflight.out"; echo "    (ceremony exit $rc)"; return $rc
}
writer_direct() {  # $1 writer, $2 digest env name: the writer runs WITHOUT its ceremony (models the ceremony dying after launch; the writer commits)
  local D rc; D=$(digest_of "$OUT/plan.json")
  export AFLDB_IMPORT_DATABASE_URL "$2=$D"           # the DSN is already in the runner's environment; it is never put on a command line
  run writer-direct "$PY" "$1" apply --plan "$OUT/plan.json"; rc=$?; unset "$2"; return $rc
}

case "$SCN" in
i333_happy)
  fig figures-before; plan1 plan; expect 0 $? "plan"
  apply1 apply; expect 0 $? "apply"; has apply "COMMITTED_VERIFIED"
  state1 state; expect 0 $? "state"; has state "PLANNED RESULT PRESENT"
  H digests > "$OUT/digests-after.json"; same digests-after.json "$PRESERVE1"
  show digests-after.json "match_coaches_2026,sides_2026_without_coach,import_batches_gt_82"
  fig figures-after
  apply1 apply-second; expect 1 $? "second apply of the same plan"; has apply-second "REFUSED_BEFORE_MUTATION"
  H digests > "$OUT/digests-after-second.json"; "$PY" -c 'import json,sys; a,b=(json.load(open(f)) for f in sys.argv[1:]); print("CHECK", "PASS" if a==b else "FAIL", "second apply wrote nothing")' "$OUT/digests-after.json" "$OUT/digests-after-second.json"
  ;;
i333_conflict)
  H fixture i333-conflict; plan1 plan; expect 1 $? "plan over a pre-existing 2026 assignment"; has plan "REFUSED_BEFORE_MUTATION"
  ;;
i333_drift)
  plan1 plan; expect 0 $? "plan"
  H fixture i333-drift-coach; apply1 apply; expect 1 $? "apply after a coaches row changed"; has apply "baseline drift"
  H digests > "$OUT/digests-after.json"; show digests-after.json "match_coaches_2026,sides_2026_without_coach,import_batches_gt_82"
  same digests-after.json "match_coaches_not_2026,match_coaches_2026,import_batches_le_82,import_batches_gt_82"
  ;;
i333_rollback_commit)
  H fixture i333-trigger-commit; plan1 plan; expect 0 $? "plan (clone-only trigger is in the baseline)"
  apply1 apply; expect 2 $? "apply whose COMMIT fails"; has apply "ROLLED_BACK"
  state1 state; expect 0 $? "state"; has state "BASELINE"
  H digests > "$OUT/digests-after.json"; same digests-after.json "match_coaches_not_2026,match_coaches_2026,coaches,import_batches_le_82,import_batches_gt_82"
  ;;
i333_rollback_surplus)
  H fixture i333-trigger-surplus; plan1 plan; expect 0 $? "plan (clone-only trigger is in the baseline)"
  apply1 apply; expect 2 $? "apply with a surplus trigger write"; has apply "ROLLED_BACK"
  state1 state; expect 0 $? "state"; has state "BASELINE"
  H digests > "$OUT/digests-after.json"; same digests-after.json "match_coaches_not_2026,match_coaches_2026,coaches,import_batches_le_82,import_batches_gt_82"
  ;;
i333_rollback_preserve)
  H fixture i333-trigger-preserve; plan1 plan; expect 0 $? "plan (clone-only trigger is in the baseline)"
  apply1 apply; expect 2 $? "apply whose transaction also changed a pre-existing assignment"; has apply "ROLLED_BACK"
  state1 state; expect 0 $? "state"; has state "BASELINE"
  H digests > "$OUT/digests-after.json"; same digests-after.json "match_coaches_not_2026,match_coaches_2026,coaches,import_batches_le_82,import_batches_gt_82"
  ;;
i333_commit_inflight)
  H fixture i333-trigger-sleep-15; plan1 plan; expect 0 $? "plan"
  inflight "$C1" tools/migration/add_match_coaches_2026.py afldb-issue333-writer; expect 0 $? "ceremony after its writer was killed mid-COMMIT (commit completes within the wait)"
  has apply-inflight "COMMITTED_VERIFIED"; grep -q writerFailedAfterCommit "$OUT/apply-inflight.json" && echo "CHECK PASS $SCN outcome record carries writerFailedAfterCommit" || echo "CHECK FAIL $SCN outcome record lacks writerFailedAfterCommit"
  state1 state; expect 0 $? "state"; has state "PLANNED RESULT PRESENT"
  H digests > "$OUT/digests-after.json"; same digests-after.json "$PRESERVE1"
  ;;
i333_commit_inflight_long)
  H fixture i333-trigger-sleep-50; plan1 plan; expect 0 $? "plan"
  inflight "$C1" tools/migration/add_match_coaches_2026.py afldb-issue333-writer; expect 5 $? "ceremony while the killed writer's COMMIT outlasts the 30 s wait"
  has apply-inflight "OUTCOME_UNDETERMINED"
  state1 state-while-live; expect 6 $? "state while the writer session is live"; has state-while-live "UNDETERMINED"
  H wait-gone afldb-issue333-writer 120
  state1 state; expect 0 $? "state after the session ended"; has state "PLANNED RESULT PRESENT"
  ;;
i333_uncertain_committed)
  plan1 plan; expect 0 $? "plan"
  writer_direct tools/migration/add_match_coaches_2026.py AFLDB_ISSUE333_PLAN_DIGEST; expect 0 $? "writer alone (no ceremony probe)"
  state1 state; expect 0 $? "state after an unclassified run"; has state "PLANNED RESULT PRESENT"
  apply1 apply-after; expect 1 $? "apply after the unclassified commit"; has apply-after "REFUSED_BEFORE_MUTATION"
  H digests > "$OUT/digests-after.json"; same digests-after.json "$PRESERVE1"
  ;;
i333_uncertain_killed)
  plan1 plan; expect 0 $? "plan"
  killed "$C1" import_batches afldb-issue333-writer
  state1 state; expect 0 $? "state after the kill"; has state "BASELINE"
  apply1 apply-recovered; expect 0 $? "the same plan applied after the kill was classified BASELINE"; has apply-recovered "COMMITTED_VERIFIED"
  H digests > "$OUT/digests-after.json"; same digests-after.json "$PRESERVE1"
  ;;
o2_happy)
  plan2 plan; expect 0 $? "plan"
  apply2 apply; expect 0 $? "apply"; has apply "COMMITTED_VERIFIED"
  state2 state; expect 0 $? "state"; has state "PLANNED RESULT PRESENT"
  H digests > "$OUT/digests-after.json"; same digests-after.json "$PRESERVE2"
  show digests-after.json "data_issues_41_76_unresolved,data_issues_41_76_resolved_not_needed"
  apply2 apply-second; expect 1 $? "second apply of the same plan"; has apply-second "REFUSED_BEFORE_MUTATION"
  ;;
o2_drift)
  plan2 plan; expect 0 $? "plan"
  H fixture o2-drift-canonical; apply2 apply; expect 1 $? "apply after a canonical value changed"; has apply "REFUSED_BEFORE_MUTATION"
  plan2 plan-again; expect 1 $? "plan after the drift (field no longer converged)"; has plan-again "NOT equal"
  H digests > "$OUT/digests-after.json"; same digests-after.json "data_issues_41_76_unresolved,data_issues_other"
  ;;
o2_already_resolved)
  plan2 plan; expect 0 $? "plan"
  H fixture o2-resolve-one; apply2 apply; expect 1 $? "apply after one finding was resolved by another actor"; has apply "REFUSED_BEFORE_MUTATION"
  plan2 plan-again; expect 1 $? "plan with one already-resolved finding"; has plan-again "not an unresolved"
  H digests > "$OUT/digests-after.json"; same digests-after.json "data_issues_other,player_match_stats_flagged_rows"
  ;;
o2_rollback_commit)
  H fixture o2-trigger-commit; plan2 plan; expect 0 $? "plan (clone-only trigger is in the baseline)"
  apply2 apply; expect 2 $? "apply whose COMMIT fails"; has apply "ROLLED_BACK"
  state2 state; expect 0 $? "state"; has state "BASELINE"
  H digests > "$OUT/digests-after.json"; same digests-after.json "data_issues_41_76_unresolved,data_issues_other"
  ;;
o2_rollback_surplus)
  H fixture o2-trigger-surplus; plan2 plan; expect 0 $? "plan (clone-only trigger is in the baseline)"
  apply2 apply; expect 2 $? "apply with a surplus trigger write"; has apply "ROLLED_BACK"
  state2 state; expect 0 $? "state"; has state "BASELINE"
  H digests > "$OUT/digests-after.json"; same digests-after.json "data_issues_41_76_unresolved,data_issues_other"
  ;;
o2_commit_inflight_long)
  H fixture o2-trigger-sleep-50; plan2 plan; expect 0 $? "plan"
  inflight "$C2" tools/v2/o2_converged_findings.py afldb-o2-writer; expect 5 $? "ceremony while the killed writer's COMMIT outlasts the 30 s wait"
  has apply-inflight "OUTCOME_UNDETERMINED"
  state2 state-while-live; expect 6 $? "state while the writer session is live"; has state-while-live "UNDETERMINED"
  H wait-gone afldb-o2-writer 120
  state2 state; expect 0 $? "state after the session ended"; has state "PLANNED RESULT PRESENT"
  ;;
o2_uncertain_committed)
  plan2 plan; expect 0 $? "plan"
  writer_direct tools/v2/o2_converged_findings.py AFLDB_O2_PLAN_DIGEST; expect 0 $? "writer alone (no ceremony probe)"
  state2 state; expect 0 $? "state after an unclassified run"; has state "PLANNED RESULT PRESENT"
  apply2 apply-after; expect 1 $? "apply after the unclassified commit"; has apply-after "REFUSED_BEFORE_MUTATION"
  ;;
o2_uncertain_killed)
  plan2 plan; expect 0 $? "plan"
  killed "$C2" data_issues_41 afldb-o2-writer
  state2 state; expect 0 $? "state after the kill"; has state "BASELINE"
  apply2 apply-recovered; expect 0 $? "the same plan applied after the kill was classified BASELINE"; has apply-recovered "COMMITTED_VERIFIED"
  ;;
*) echo "unknown scenario $SCN"; exit 2 ;;
esac
H digests > "$OUT/digests-final.json"
echo "SCENARIO DONE $SCN"
