:
{
# ISSUE-333 (O1) / O2 production APPLY and STATE -- OWNER-RUN ONLY. Nothing in this repository runs it; the session that prepared it did not.
# It drives the reviewed ceremonies at revision R from the private ops checkout made by prod-ops-i333-o2.sh prep. Every refusal is the ceremony's.
#   bash prod-apply-i333-o2.sh approve-i333 <R> <plan.json> <reference text> <expires-at ISO>   writes evidence/approval-i333.json (exclusive)
#   bash prod-apply-i333-o2.sh approve-o2   <R> <plan.json> <reference text> <expires-at ISO>   writes evidence/approval-o2.json (exclusive)
#   bash prod-apply-i333-o2.sh state-i333|state-o2 <R> <plan.json>                              read-only classification
#   bash prod-apply-i333-o2.sh apply-i333|apply-o2 <R> <plan.json> <backup stamp>                THE WRITE (needs the approval file)
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
  [ -e "$EV/approval-$L.json" ] && stop "approval file exists (never overwritten; choose a new plan if it is stale)" 3
  "$PY" - "$PLAN" "$R" "$REF" "$EXP" "$EV/approval-$L.json" <<'PYEOF'
import json, os, sys
from datetime import datetime, timezone
plan, r, ref, exp, out = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
a = {"planDigest": plan["digest"], "operation": plan["operation"], "target": plan["target"], "revision": r, "reference": ref,
     "approvedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "expiresAt": exp}
if plan["operation"] == "issue333-coach-assignments":
    a["coreTarSha256"] = plan["coreTar"]["sha256"]
else:
    a["resolution"], a["ids"] = plan["resolution"], plan["ids"]
fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as f:
    f.write(json.dumps(a, indent=1, sort_keys=True) + "\n")
print(json.dumps(a, sort_keys=True))
PYEOF
  ;;
state-*)
  export AFLDB_GAP029_DSN=$(envval AFLDB_BACKUP_DATABASE_URL)
  step "state (read-only)"
  "$PY" "$TOOL" state --plan "$PLAN" --out "$EV/state-$L-$STAMP_NOW.json"; RC=$?
  unset AFLDB_GAP029_DSN; echo "state exit $RC"; exit $RC
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
  exit $RC
  ;;
esac
step DONE
}
