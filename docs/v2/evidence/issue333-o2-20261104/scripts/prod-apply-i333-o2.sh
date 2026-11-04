:
{
# ISSUE-333 (O1) / O2 production APPLY and STATE. Drives the reviewed ceremonies at revision R from the private ops checkout made by prod-ops-i333-o2.sh prep.
# Every refusal is the ceremony's. Revision 2 (2026-11-04): approval creation now fails closed and is read back; state can REQUIRE a verdict.
#   bash prod-apply-i333-o2.sh approve-i333 <R> <plan.json> <reference text> <expires-at ISO>   writes evidence/approval-i333.json (exclusive, atomic)
#   bash prod-apply-i333-o2.sh approve-o2   <R> <plan.json> <reference text> <expires-at ISO>   writes evidence/approval-o2.json (exclusive, atomic)
#   bash prod-apply-i333-o2.sh state-i333|state-o2 <R> <plan.json> [any|baseline|present]        read-only classification; exit 0 only if the verdict matches
#   bash prod-apply-i333-o2.sh apply-i333|apply-o2 <R> <plan.json> <backup stamp>                THE WRITE (needs the approval file)
# A nonzero state exit is a refusal or a mismatch; state exit 0 with expectation `any` is NOT proof of application (BASELINE also exits 0).
# Credentials: the existing channel in the checkout .env, exported to the child process only (never argv, never printed): the read/probe role
# afldb_backup (AFLDB_GAP029_DSN) and, for apply only, the writer afldb_import (AFLDB_GAP029_WRITE_DSN). No grant, service, timer or deploy action.
set -u -o pipefail
export LC_ALL=C
umask 077
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { echo "STOP: $1"; exit "${2:-1}"; }
PHASE=${1:?phase}; R=${2:?revision}; PLAN=${3:?plan.json}
[[ "$R" =~ ^[0-9a-f]{40}$ ]] || stop "revision must be 40 hex" 2
PROD=/home/arm/projects/afldb
PY=$PROD/.venv/bin/python
OPS=/home/arm/ops/issue333-o2-${R:0:8}
CAND=$OPS/cand; EV=$OPS/evidence
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH PYTHONDONTWRITEBYTECODE=1
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || stop "unexpected host/user" 3
cd "$CAND" || stop "no ops checkout" 3
[ "$(git rev-parse HEAD)" = "$R" ] && [ "$(git status --porcelain | wc -l)" = 0 ] || stop "ops checkout not clean at $R" 3
[ -f "$PLAN" ] || stop "plan file missing" 3
envval() { sed -n "s/^$1=//p" "$PROD/.env" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }
case "$PHASE" in *i333) TOOL=tools/v2/issue333-coach-assignments-production.py; L=i333 ;; *o2) TOOL=tools/v2/o2-converged-findings-production.py; L=o2 ;; *) stop "unknown phase" 2 ;; esac
STAMP_NOW=$(date -u +%Y%m%dT%H%M%SZ)
case "$PHASE" in
approve-*)
  REF=${4:?reference}; EXP=${5:?expires-at}
  APPR="$EV/approval-$L.json"
  [ -e "$APPR" ] && stop "approval file exists (never overwritten; choose a new plan if it is stale)" 3
  "$PY" - "$PLAN" "$R" "$REF" "$EXP" "$APPR" <<'PYEOF'
import json, os, sys
from datetime import datetime, timezone
plan, r, ref, exp, out = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
def parse(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
now = datetime.now(timezone.utc)
if not ref.strip():
    sys.exit("approval refused: empty reference")
try:
    e = parse(exp)
except ValueError:
    sys.exit("approval refused: expires-at must be YYYY-MM-DDTHH:MM:SSZ")
if not now < e:
    sys.exit("approval refused: expires-at is not in the future")
try:
    pe = datetime.fromisoformat(plan["expiresAt"].replace("Z", "+00:00"))
except (KeyError, ValueError):
    sys.exit("approval refused: the plan has no readable expiresAt")
if e > pe:
    sys.exit("approval refused: expires-at outlives the plan")
a = {"planDigest": plan["digest"], "operation": plan["operation"], "target": plan["target"], "revision": r, "reference": ref,
     "approvedAt": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"), "expiresAt": exp}
if plan["operation"] == "issue333-coach-assignments":
    a["coreTarSha256"] = plan["coreTar"]["sha256"]
else:
    a["resolution"], a["ids"] = plan["resolution"], plan["ids"]
tmp = out + ".tmp-%d" % os.getpid()
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
try:
    with os.fdopen(fd, "w") as f:
        f.write(json.dumps(a, indent=1, sort_keys=True) + "\n")
        f.flush(); os.fsync(f.fileno())
    os.link(tmp, out)            # atomic and exclusive: fails if the approval already exists; never a partial approval file
finally:
    try:
        os.unlink(tmp)
    except OSError:
        pass
print(json.dumps(a, sort_keys=True))
PYEOF
  RC=$?
  [ "$RC" = 0 ] || stop "approval creation FAILED (exit $RC); no approval was created" "$RC"
  # Read back what is on disk and compare with the plan and the arguments; the digest, operation, target, revision and expiry must be exactly these.
  "$PY" - "$PLAN" "$R" "$REF" "$EXP" "$APPR" <<'PYEOF'
import json, sys
plan, r, ref, exp, out = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
a = json.load(open(out))
want = {"planDigest": plan["digest"], "operation": plan["operation"], "target": plan["target"], "revision": r, "reference": ref, "expiresAt": exp}
bad = [k for k, v in want.items() if a.get(k) != v]
if plan["operation"] == "issue333-coach-assignments":
    if a.get("coreTarSha256") != plan["coreTar"]["sha256"]:
        bad.append("coreTarSha256")
elif a.get("resolution") != plan["resolution"] or a.get("ids") != plan["ids"]:
    bad.append("resolution/ids")
if bad:
    sys.exit("approval read-back MISMATCH: " + ", ".join(bad))
print("approval read-back OK: " + json.dumps({k: a[k] for k in ("planDigest", "operation", "target", "revision", "expiresAt", "approvedAt")}, sort_keys=True))
PYEOF
  RC=$?
  [ "$RC" = 0 ] || stop "approval read-back FAILED (exit $RC); the file at $APPR must not be used" "$RC"
  ;;
state-*)
  EXPECT=${4:-any}
  case "$EXPECT" in any|baseline|present) ;; *) stop "state expectation must be any, baseline or present" 2 ;; esac
  export AFLDB_GAP029_DSN=$(envval AFLDB_BACKUP_DATABASE_URL)
  step "state (read-only) expect=$EXPECT"
  OUT=$("$PY" "$TOOL" state --plan "$PLAN" --out "$EV/state-$L-$STAMP_NOW.json"); RC=$?
  unset AFLDB_GAP029_DSN
  printf '%s\n' "$OUT"
  echo "state exit $RC"
  [ "$RC" = 0 ] || exit "$RC"
  case "$EXPECT" in
    any) exit 0 ;;
    present) grep -q '^STATE PLANNED RESULT PRESENT' <<<"$OUT" && { echo "VERDICT MATCH: PLANNED RESULT PRESENT"; exit 0; } ;;
    baseline) grep -q '^STATE BASELINE' <<<"$OUT" && { echo "VERDICT MATCH: BASELINE"; exit 0; } ;;
  esac
  stop "state exit 0 but the verdict is not the expected '$EXPECT'" 7
  ;;
apply-*)
  BSTAMP=${4:?backup stamp}
  DUMP=/home/arm/backups/afldb/issue333-o2-$BSTAMP/afldb_prod-$BSTAMP.dump
  [ -f "$EV/approval-$L.json" ] || stop "no approval file" 3
  H=$(date +%H%M); [ "$H" \< 0415 ] || [ "$H" \> 0529 ] || stop "host time $H is inside the 04:15-05:30 no-apply window" 4
  for u in afldb-settle-afltables.service afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service; do
    case "$(systemctl is-active "$u" 2>/dev/null)" in active|activating|reloading) stop "writer $u is running" 4;; esac
  done
  export AFLDB_GAP029_DSN=$(envval AFLDB_BACKUP_DATABASE_URL) AFLDB_GAP029_WRITE_DSN=$(envval AFLDB_IMPORT_DATABASE_URL)
  if [ "$L" = i333 ]; then BJ=$OPS/in/backup-I333.json; else BJ=$OPS/in/backup-O2.json; fi
  step "APPLY $L (the ceremony re-plans read-only, then runs the writer once and classifies with its own read-only probe)"
  "$PY" "$TOOL" apply --plan "$PLAN" --approval "$EV/approval-$L.json" --backup-file "$DUMP" --restore-evidence "$OPS/in/restore-evidence.json" \
    --out "$EV/apply-$L-$STAMP_NOW.json"; RC=$?
  unset AFLDB_GAP029_DSN AFLDB_GAP029_WRITE_DSN
  echo "apply exit $RC (0 COMMITTED_VERIFIED, 1 REFUSED_BEFORE_MUTATION, 2 ROLLED_BACK, 3 COMMITTED_VERIFICATION_FAILED, 4 COMMITTED_VERIFICATION_UNAVAILABLE, 5 OUTCOME_UNDETERMINED)"
  echo "backup evidence used: $BJ (bound inside the plan; the ceremony re-checks it)"
  echo "NEXT: run state-$L with expectation 'present'; apply exit 0 alone is not the final verdict"
  exit $RC
  ;;
esac
step DONE
}
