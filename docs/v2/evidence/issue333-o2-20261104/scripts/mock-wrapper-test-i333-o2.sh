#!/bin/bash
# Mocked exercise of every phase of prod-apply-i333-o2.sh. Usage: mock-wrapper-test.sh <wrapper> <plan-i333.json> <plan-o2.json>
# The only transformation of the wrapper under test is the /home/arm prefix -> a scratch root (diffed and shown).
set -u
WRAP=$1; PI=$2; PO=$3
SP="$(cd "$(dirname "$0")" && pwd)"
REALGIT=$(command -v git)
ROOT=$SP/mockroot; rm -rf "$ROOT"; mkdir -p "$ROOT"
R=50ed6e4f4a697160ef263ade293792363e52e975
OPS=$ROOT/home/arm/ops/issue333-o2-${R:0:8}
mkdir -p "$ROOT/home/arm/projects/afldb/.venv/bin" "$OPS/cand/tools/v2" "$OPS/evidence" "$OPS/in" "$ROOT/mock"
T=$ROOT/wrapper.sh
sed "s#/home/arm#$ROOT/home/arm#g" "$WRAP" > "$T"
echo "--- transformation diff (only /home/arm path tokens may differ) ---"
diff <(sed "s#/home/arm#@@#g" "$WRAP") <(sed "s#$ROOT/home/arm#@@#g" "$T") && echo "diff after reversing the prefix: IDENTICAL"
printf 'AFLDB_BACKUP_DATABASE_URL="postgresql://afldb_backup:SECRETRO@localhost/afldb_prod"\nAFLDB_IMPORT_DATABASE_URL=postgresql://afldb_import:SECRETRW@localhost/afldb_prod\n' > "$ROOT/home/arm/projects/afldb/.env"
printf '#!/bin/bash\nexec python "$@"\n' > "$ROOT/home/arm/projects/afldb/.venv/bin/python"
cat > "$ROOT/mock/hostname" <<'E'
#!/bin/bash
echo "${MOCK_HOST:-afldb-prod}"
E
cat > "$ROOT/mock/id" <<'E'
#!/bin/bash
echo "${MOCK_USER:-arm}"
E
cat > "$ROOT/mock/git" <<'E'
#!/bin/bash
case "$1" in rev-parse) echo "${MOCK_REV:-50ed6e4f4a697160ef263ade293792363e52e975}";; status) [ -n "${MOCK_DIRTY:-}" ] && echo " M x.py"; exit 0;; esac
E
cat > "$ROOT/mock/systemctl" <<'E'
#!/bin/bash
echo "${MOCK_SYSTEMCTL:-inactive}"
E
cat > "$ROOT/mock/date" <<'E'
#!/bin/bash
if [ "${1:-}" = "+%H%M" ] && [ -n "${MOCK_HM:-}" ]; then echo "$MOCK_HM"; else exec /usr/bin/date "$@"; fi
E
chmod +x "$ROOT"/mock/* "$ROOT/home/arm/projects/afldb/.venv/bin/python"
for tool in issue333-coach-assignments-production o2-converged-findings-production; do
cat > "$OPS/cand/tools/v2/$tool.py" <<'E'
import os, sys
log = os.environ["MOCK_LOG"]
with open(log, "a") as f:
    f.write("TOOL %s mode=%s ro_dsn=%s rw_dsn=%s secrets_in_argv=%s\n" % (os.path.basename(sys.argv[0]), sys.argv[1], "AFLDB_GAP029_DSN" in os.environ, "AFLDB_GAP029_WRITE_DSN" in os.environ, any("SECRET" in a for a in sys.argv)))
print(os.environ.get("MOCK_OUT", ""))
sys.exit(int(os.environ.get("MOCK_RC", "0")))
E
done
export MOCK_LOG=$ROOT/tool.log; : > "$MOCK_LOG"
export PATH="$ROOT/mock:$PATH"
cp "$PI" "$OPS/evidence/plan-i333.json"; cp "$PO" "$OPS/evidence/plan-o2.json"
PLI=$OPS/evidence/plan-i333.json; PLO=$OPS/evidence/plan-o2.json
FAILS=0; N=0
run() { # name expected-rc cmd...   (stdout+stderr kept in $ROOT/last.out)
  local name=$1 want=$2; shift 2; N=$((N+1))
  "$@" > "$ROOT/last.out" 2>&1; local rc=$?
  if [ "$rc" = "$want" ]; then echo "PASS [$N] $name (rc=$rc)"; else echo "FAIL [$N] $name (rc=$rc, wanted $want)"; FAILS=$((FAILS+1)); fi
}
has() { if grep -q -- "$1" "$ROOT/last.out"; then echo "      output has: $1"; else echo "FAIL      output lacks: $1"; FAILS=$((FAILS+1)); fi; }
hasnt() { if grep -q -- "$1" "$ROOT/last.out"; then echo "FAIL      output has (must not): $1"; FAILS=$((FAILS+1)); else echo "      output lacks (as required): $1"; fi; }
W() { bash "$T" "$@"; }
NOW_PLUS() { python -c "import sys;from datetime import datetime,timedelta,timezone;print((datetime.now(timezone.utc)+timedelta(minutes=int(sys.argv[1]))).strftime('%Y-%m-%dT%H:%M:%SZ'))" "$1"; }
EXP=$(NOW_PLUS 80)

echo "=== approve ==="
run "approve-i333 success" 0 W approve-i333 $R "$PLI" "Owner approval ref O1" "$EXP"; has "approval read-back OK"; has "== DONE"
python - "$OPS/evidence/approval-i333.json" "$PLI" "$R" "$EXP" <<'E'
import json,sys
a=json.load(open(sys.argv[1])); p=json.load(open(sys.argv[2]))
ok = a["planDigest"]==p["digest"] and a["operation"]=="issue333-coach-assignments" and a["target"]==p["target"] and a["revision"]==sys.argv[3] and a["expiresAt"]==sys.argv[4] and a["coreTarSha256"]==p["coreTar"]["sha256"]
print("      independent file check:", "OK" if ok else "MISMATCH")
sys.exit(0 if ok else 1)
E
[ $? = 0 ] || FAILS=$((FAILS+1))
ls "$OPS/evidence" | grep -q tmp && { echo "FAIL leftover tmp file"; FAILS=$((FAILS+1)); } || echo "      no leftover temp file"
H1=$(sha256sum "$OPS/evidence/approval-i333.json")
run "approve-i333 existing approval refused" 3 W approve-i333 $R "$PLI" "again" "$EXP"; has "approval file exists"; hasnt "== DONE"
[ "$H1" = "$(sha256sum "$OPS/evidence/approval-i333.json")" ] && echo "      existing approval unchanged" || { echo "FAIL existing approval changed"; FAILS=$((FAILS+1)); }
run "approve-o2 success" 0 W approve-o2 $R "$PLO" "Owner approval ref O2" "$EXP"; has "approval read-back OK"
python - "$OPS/evidence/approval-o2.json" "$PLO" "$R" "$EXP" <<'E'
import json,sys
a=json.load(open(sys.argv[1])); p=json.load(open(sys.argv[2]))
ok = a["planDigest"]==p["digest"] and a["operation"]=="o2-converged-findings" and a["target"]==p["target"] and a["revision"]==sys.argv[3] and a["expiresAt"]==sys.argv[4] and a["resolution"]=="canonical_apply_not_needed" and len(a["ids"])==36 and a["ids"]==p["ids"]
print("      independent file check:", "OK" if ok else "MISMATCH")
sys.exit(0 if ok else 1)
E
[ $? = 0 ] || FAILS=$((FAILS+1))
rm -f "$OPS/evidence/approval-o2.json"
run "approve-o2 bad expiry format" 1 W approve-o2 $R "$PLO" "ref" "2026-11-04 04:00"; has "expires-at must be"; hasnt "== DONE"; [ ! -e "$OPS/evidence/approval-o2.json" ] && echo "      no file created"
run "approve-o2 expiry in the past" 1 W approve-o2 $R "$PLO" "ref" "2026-11-04T00:00:00Z"; has "not in the future"; hasnt "== DONE"
run "approve-o2 expiry beyond plan" 1 W approve-o2 $R "$PLO" "ref" "2026-11-06T00:00:00Z"; has "outlives the plan"; hasnt "== DONE"
run "approve-o2 empty reference" 1 W approve-o2 $R "$PLO" " " "$EXP"; has "empty reference"; hasnt "== DONE"
mv "$OPS/evidence" "$OPS/evidence.gone"; mkdir -p "$OPS/evidence"; rmdir "$OPS/evidence"
cp "$OPS/evidence.gone/plan-o2.json" "$ROOT/plan-o2.json"
run "approve-o2 creation failure (evidence dir missing) must NOT succeed" 1 W approve-o2 $R "$ROOT/plan-o2.json" "ref" "$EXP"; has "approval creation FAILED"; hasnt "== DONE"
mv "$OPS/evidence.gone" "$OPS/evidence"
echo "--- the ORIGINAL committed wrapper on the same failure (proves the defect and the fix) ---"
"$REALGIT" -C "$(dirname "$WRAP")" show 93c45479:docs/v2/evidence/issue333-o2-20261104/scripts/prod-apply-i333-o2.sh | sed "s#/home/arm#$ROOT/home/arm#g" > "$ROOT/orig.sh" 2>/dev/null
if [ -s "$ROOT/orig.sh" ]; then
  mv "$OPS/evidence" "$OPS/evidence.gone"
  bash "$ROOT/orig.sh" approve-o2 $R "$ROOT/plan-o2.json" "ref" "$EXP" > "$ROOT/orig.out" 2>&1; echo "      ORIGINAL wrapper rc=$? ; says DONE: $(grep -c '== DONE' "$ROOT/orig.out")"
  mv "$OPS/evidence.gone" "$OPS/evidence"
fi

echo "=== state ==="
PRES="STATE PLANNED RESULT PRESENT (exactly the reviewed 436 assignments were added)"
BASE="STATE BASELINE (the plan has not been applied)"
export MOCK_OUT="$PRES" MOCK_RC=0
run "state present/expect present" 0 W state-i333 $R "$PLI" present; has "VERDICT MATCH: PLANNED RESULT PRESENT"
run "state present/expect any" 0 W state-i333 $R "$PLI"
run "state present/expect baseline" 7 W state-i333 $R "$PLI" baseline; has "verdict is not the expected"
export MOCK_OUT="$BASE"
run "state baseline/expect present (exit 0 alone is NOT enough)" 7 W state-o2 $R "$PLO" present; has "state exit 0"; has "verdict is not the expected 'present'"; hasnt "VERDICT MATCH"
run "state baseline/expect baseline" 0 W state-o2 $R "$PLO" baseline; has "VERDICT MATCH: BASELINE"
export MOCK_OUT="STATE OTHER (neither the plan baseline nor the planned result)" MOCK_RC=6
run "state OTHER propagates tool rc" 6 W state-o2 $R "$PLO" present
export MOCK_OUT="STATE UNDETERMINED: a writer session is still live" MOCK_RC=6
run "state UNDETERMINED propagates tool rc" 6 W state-i333 $R "$PLI" present
export MOCK_OUT="OUTCOME REFUSED_BEFORE_MUTATION (exit 1)" MOCK_RC=1
run "state tool refusal propagates rc" 1 W state-i333 $R "$PLI" present
export MOCK_OUT="x" MOCK_RC=0
run "state bad expectation" 2 W state-i333 $R "$PLI" bogus

echo "=== apply ==="
run "apply without approval file" 3 W apply-o2 $R "$PLO" 20261104T021037Z; has "no approval file"
export MOCK_OUT="OUTCOME COMMITTED_VERIFIED (exit 0)" MOCK_RC=0
export MOCK_HM=0430
run "apply inside no-apply window" 4 W apply-i333 $R "$PLI" 20261104T021037Z; has "no-apply window"
export MOCK_HM=1420 MOCK_SYSTEMCTL=active
run "apply with a settle writer active" 4 W apply-i333 $R "$PLI" 20261104T021037Z; has "is running"
export MOCK_SYSTEMCTL=inactive
: > "$MOCK_LOG"
run "apply COMMITTED_VERIFIED (rc 0)" 0 W apply-i333 $R "$PLI" 20261104T021037Z; has "apply exit 0"; has "NEXT: run state-i333"
grep -q "mode=apply ro_dsn=True rw_dsn=True secrets_in_argv=False" "$MOCK_LOG" && echo "      apply child got both DSNs via env, none in argv" || { echo "FAIL dsn env"; FAILS=$((FAILS+1)); }
hasnt "SECRET"
for rc in 1 2 3 4 5; do
  export MOCK_RC=$rc MOCK_OUT="OUTCOME code $rc"
  run "apply tool rc $rc propagates" $rc W apply-i333 $R "$PLI" 20261104T021037Z; has "apply exit $rc"
done
export MOCK_RC=0
W approve-o2 $R "$PLO" "ref" "$EXP" > /dev/null 2>&1
run "apply-o2 rc 0 with approval" 0 W apply-o2 $R "$PLO" 20261104T021037Z; has "backup-O2.json"

echo "=== guards ==="
run "bad revision" 2 W state-i333 abc "$PLI"
run "unknown phase" 2 W bogus-x $R "$PLI"
MOCK_HOST=other run "wrong host" 3 W state-i333 $R "$PLI"
MOCK_USER=root run "wrong user" 3 W state-i333 $R "$PLI"
MOCK_DIRTY=1 run "dirty checkout" 3 W state-i333 $R "$PLI"
MOCK_REV=0000000000000000000000000000000000000000 run "wrong HEAD" 3 W state-i333 $R "$PLI"
run "plan file missing" 3 W state-i333 $R "$ROOT/nope.json"
echo
echo "TOTAL checks: $N ; FAILURES: $FAILS"
exit $FAILS
