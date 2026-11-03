#!/usr/bin/env bash
# GAP-029: for ONE data stage, restore that stage's OWN fresh production backup into a guarded disposable database on the isolated cluster,
# then assemble the stage's machine-generated, sealed restore evidence from the restored copy. Run once per stage (S1, S2, S3, S4), each with a
# DIFFERENT, freshly taken and restore-verified backup. There is no shared-backup mode.
#
# Nothing here touches production, the DEV database or any DEV service. It reads the dump and the capture provenance; it writes only under $W.
# It never types in a restore-derived value: the assembler reads them from the guarded restored database (see tools/v2/gap029-assemble-restore-evidence.ts).
#
# Usage (as the host user, e.g. arm):
#   W=<workspace holding the pinned checkout at $W/cand, node_modules, pg-root and in/> R=<40-hex frozen execution revision>
#   STAGE=S1|S2|S3|S4 DUMP=<dump> DUMP_SHA=<sha256> PROVENANCE=<capture provenance json> PROD_TARGET=<production target json> TAG=<label>
#   bash restore-assemble-host.sh
# Outputs under $W/evidence-private/$TAG: restore-evidence.json, backup.json (the --backup-file/--backup input of that stage's production plan),
# work/ (the stage tool's own rehearsal output), restore-target.json, and the logs. Exit 0 only when the sealed backup.json exists.
set -u -o pipefail
: "${W:?}" "${R:?}" "${STAGE:?}" "${DUMP:?}" "${DUMP_SHA:?}" "${PROVENANCE:?}" "${PROD_TARGET:?}" "${TAG:?}"
[[ "$TAG" =~ ^[a-z0-9_]+$ ]] || { echo "STOP TAG must match [a-z0-9_]+ (it becomes part of an isolated database name)"; exit 2; }
case "$STAGE" in S1|S2|S3|S4) ;; *) echo "STOP STAGE must be S1, S2, S3 or S4"; exit 2 ;; esac
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
PORT=55493
CAND="$W/cand"; EVP="$W/evidence-private/$TAG"
export AFLDB_PYTHON="${PY:-$W/venv/bin/python}"   # a python with psycopg (the S2/S4 tools and the importer need it)
mkdir -p -m 700 "$W/evidence-private"; [ -e "$EVP" ] && { echo "STOP $EVP exists; choose a new TAG (evidence is never overwritten)"; exit 2; }; mkdir -m 700 "$EVP"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
say() { echo "$(date -u +%FT%TZ) $*"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
RDB=afldb_v2_gap029_${TAG}_rst_test
dev_services() { for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done; }

say "A0 inputs"
[ "$(cd "$CAND" && git rev-parse HEAD)" = "$R" ] || { echo "STOP candidate is not at $R"; exit 3; }
[ "$(cd "$CAND" && git status --porcelain | wc -l)" = 0 ] || { echo "STOP candidate is not clean"; exit 3; }
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "STOP dump sha256 mismatch"; exit 3; }
case "$DUMP$PROVENANCE$PROD_TARGET$W" in *"$CAND"*) echo "STOP inputs must be outside the checkout"; exit 3 ;; esac
ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$" && { echo "STOP port $PORT already listening"; exit 3; }
echo "dump sha256 verified; candidate clean at $R; stage $STAGE"
echo "DEV services BEFORE:"; dev_services | tee "$EVP/dev-before.txt"

# cleanup trap FIRST: a slow start must not leave the isolated cluster running (the trap also covers the start itself)
fin() { local rc=$?; say "A9 stop the cluster and prove isolation"; IR stop || true; sleep 2
  ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && echo "WARN port still listening"
  echo "DEV services AFTER:"; dev_services | tee "$EVP/dev-after.txt"; cmp -s "$EVP/dev-before.txt" "$EVP/dev-after.txt" && echo "DEV services unchanged" || echo "WARN DEV services differ (compare dev-before.txt / dev-after.txt)"
  say "DONE rc=$rc"; exit $rc; }
trap fin EXIT
say "A1 start the guarded cluster"
( IR start > "$EVP/pg-start.out" 2>&1 < /dev/null & ); sleep 4
IR status || exit 4
pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid"); ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$EVP/listener.txt"
grep -q "127.0.0.1:$PORT" "$EVP/listener.txt" && grep -q "pid=$pmpid," "$EVP/listener.txt" && [ "$(grep -c . "$EVP/listener.txt")" = 1 ] \
  || { echo "STOP listener is not exclusively the cluster we started"; IR stop || true; exit 4; }


say "A2 restore into a guarded disposable database"
IR create-db "$RDB" || exit 5
RESTORED_AT_START=$(date -u +%FT%T.%3NZ)
RUNDB "$RDB" node "$W/in/restore.mjs" "$DUMP" "$DUMP_SHA" | tee "$EVP/restore.out" || exit 5
RESTORED_AT=$(date -u +%FT%T.%3NZ)
echo "restore_started=$RESTORED_AT_START restored_at=$RESTORED_AT"
cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"; RUNDB "$RDB" node .probe-dbs.mjs "$RDB" | tee "$EVP/restore-probe.txt"; rm -f "$CAND/.probe-dbs.mjs"
grep -qF '"ledger":"'"${LEDGER_PREFIX:-118_}" "$EVP/restore-probe.txt" || { echo "STOP restored ledger does not start ${LEDGER_PREFIX:-118_} (production's current ledger is 118_fixtures_unconfirmed_participants.sql)"; exit 5; }

TOC=$(/usr/lib/postgresql/16/bin/pg_restore --list "$DUMP" | grep -cv '^;'); echo "archive toc entries: $TOC"
say "A3 restore evidence (identity proven by query inside the guarded database; source identity from the capture provenance, checked against the production target)"
RUNDB "$RDB" bash -c "cd '$CAND' && node --import tsx tools/v2/gap029-assemble-restore-evidence.ts restore-evidence --provenance '$PROVENANCE' --dump '$DUMP' --dump-sha256 '$DUMP_SHA' --restored-at '$RESTORED_AT' --toc-entries '$TOC' --production-target '$PROD_TARGET' --out '$EVP/restore-evidence.json'" || exit 6

say "A4 assemble the sealed backup evidence for $STAGE from the restored copy"
LABEL_ARGS=""; [ -n "${LABEL:-}" ] && LABEL_ARGS="--label '$LABEL'"
RUNDB "$RDB" bash -c "cd '$CAND' && node --import tsx tools/v2/gap029-assemble-restore-evidence.ts assemble --stage '$STAGE' --production-target '$PROD_TARGET' --dump '$DUMP' --dump-sha256 '$DUMP_SHA' --restore-evidence '$EVP/restore-evidence.json' --work-dir '$EVP/work' --out '$EVP/backup.json' $LABEL_ARGS" || exit 7
echo "backup.json sha256 $(sha256sum "$EVP/backup.json" | cut -d' ' -f1)"; echo "restore-evidence.json sha256 $(sha256sum "$EVP/restore-evidence.json" | cut -d' ' -f1)"
