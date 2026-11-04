#!/usr/bin/env bash
# ISSUE-333 / O2 rehearsals on streamanator: every scenario on its OWN disposable clone of the freshly restored production backup (TEMPLATE),
# on the guarded loopback cluster. No production access, no DEV database or DEV service is touched (their MainPIDs are recorded before/after).
#   W=... R=<40-hex> TEMPLATE=afldb_v2_i333o2_<tag>_rst_test RUN=<label> bash rehearse-i333-o2.sh [scenario ...]
set -u -o pipefail
: "${W:?}" "${R:?}" "${TEMPLATE:?}" "${RUN:?}"
[[ "$RUN" =~ ^[a-z0-9]+$ ]] || { echo "STOP RUN must match [a-z0-9]+"; exit 2; }
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
PORT=55493
CAND="$W/cand"
export AFLDB_PYTHON="$W/venv/bin/python" W
export EVROOT="$W/evidence-private/rehearsal-$RUN"
[ -e "$EVROOT" ] && { echo "STOP $EVROOT exists"; exit 2; }; mkdir -p -m 700 "$EVROOT"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
say() { echo "$(date -u +%FT%TZ) $*"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
dev_services() { for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done; }
SCENARIOS=("$@")
[ ${#SCENARIOS[@]} -gt 0 ] || SCENARIOS=(i333_happy i333_conflict i333_drift i333_rollback_commit i333_rollback_surplus i333_rollback_preserve
  i333_commit_inflight i333_commit_inflight_long i333_uncertain_committed i333_uncertain_killed
  o2_happy o2_drift o2_already_resolved o2_rollback_commit o2_rollback_surplus o2_commit_inflight_long o2_uncertain_committed o2_uncertain_killed)

[ "$(cd "$CAND" && git rev-parse HEAD)" = "$R" ] && [ "$(cd "$CAND" && git status --porcelain | wc -l)" = 0 ] || { echo "STOP candidate not clean at $R"; exit 3; }
ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$" && { echo "STOP port $PORT already listening"; exit 3; }
df -h /mnt/ssd | tail -1
echo "DEV services BEFORE:"; dev_services | tee "$EVROOT/dev-before.txt"
fin() { local rc=$?; say "stop the cluster"; IR stop || true; sleep 2
  echo "DEV services AFTER:"; dev_services | tee "$EVROOT/dev-after.txt"; cmp -s "$EVROOT/dev-before.txt" "$EVROOT/dev-after.txt" && echo "DEV services unchanged" || echo "WARN DEV services differ"
  echo "== SUMMARY"; grep -h '^CHECK ' "$EVROOT"/*.log | sort | uniq -c | awk '{print $2, $3}' | sort | uniq -c
  grep -h '^CHECK FAIL' "$EVROOT"/*.log; say "DONE rc=$rc"; exit $rc; }
trap fin EXIT
( IR start > "$EVROOT/pg-start.out" 2>&1 < /dev/null & ); sleep 4
IR status || exit 4
pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid"); ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$EVROOT/listener.txt"
grep -q "127.0.0.1:$PORT" "$EVROOT/listener.txt" && grep -q "pid=$pmpid," "$EVROOT/listener.txt" && [ "$(grep -c . "$EVROOT/listener.txt")" = 1 ] \
  || { echo "STOP listener is not exclusively the cluster we started"; exit 4; }
for S in "${SCENARIOS[@]}"; do
  DB="afldb_v2_r${RUN}_${S}_test"
  say "SCENARIO $S on $DB (clone of $TEMPLATE)"
  IR create-db "$DB" --template "$TEMPLATE" > "$EVROOT/$S.log" 2>&1 || { echo "CHECK FAIL $S clone" | tee -a "$EVROOT/$S.log"; continue; }
  IR verify "$DB" >> "$EVROOT/$S.log" 2>&1
  RUNDB "$DB" bash "$W/in/scn.sh" "$S" >> "$EVROOT/$S.log" 2>&1
  echo "scenario exit $?" >> "$EVROOT/$S.log"
  grep -E '^CHECK |SCENARIO DONE' "$EVROOT/$S.log"
done
