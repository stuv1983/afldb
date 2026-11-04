#!/usr/bin/env bash
# ISSUE-333 (O1) + O2: restore the ONE fresh production backup taken for these two operations into a guarded disposable database on the isolated
# cluster, then assemble EACH operation's machine-generated, sealed restore evidence (stage I333, then stage O2) from that restored copy.
# DERIVED from the reviewed docs/v2/evidence/gap029-hardening-20261103/scripts/restore-assemble-host.sh by constant changes only: the stage list
# (I333 and O2 over one restore; the owner brief authorises ONE backup for both operations, where GAP-029 took one per stage), the database
# name prefix, and --core-tar for I333. A0-A3 and A9 are unchanged. The restored database is LEFT (stopped cluster) as the rehearsal template.
#
# Nothing here touches production, the DEV database or any DEV service. It reads the dump and the capture provenance; it writes only under $W.
# Usage: W=... R=<40-hex> DUMP=... DUMP_SHA=... PROVENANCE=... PROD_TARGET=... TAG=<label> CORE_TAR=$W/in/core.tar bash restore-assemble-i333-o2.sh
set -u -o pipefail
: "${W:?}" "${R:?}" "${DUMP:?}" "${DUMP_SHA:?}" "${PROVENANCE:?}" "${PROD_TARGET:?}" "${TAG:?}" "${CORE_TAR:?}"
[[ "$TAG" =~ ^[a-z0-9_]+$ ]] || { echo "STOP TAG must match [a-z0-9_]+ (it becomes part of an isolated database name)"; exit 2; }
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
PORT=55493
CAND="$W/cand"; EVP="$W/evidence-private/$TAG"
export AFLDB_PYTHON="${PY:-$W/venv/bin/python}"
mkdir -p -m 700 "$W/evidence-private"; [ -e "$EVP" ] && { echo "STOP $EVP exists; choose a new TAG (evidence is never overwritten)"; exit 2; }; mkdir -m 700 "$EVP"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
say() { echo "$(date -u +%FT%TZ) $*"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
RDB=afldb_v2_i333o2_${TAG}_rst_test
dev_services() { for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done; }

say "A0 inputs"
[ "$(cd "$CAND" && git rev-parse HEAD)" = "$R" ] || { echo "STOP candidate is not at $R"; exit 3; }
[ "$(cd "$CAND" && git status --porcelain | wc -l)" = 0 ] || { echo "STOP candidate is not clean"; exit 3; }
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "STOP dump sha256 mismatch"; exit 3; }
case "$DUMP$PROVENANCE$PROD_TARGET$W$CORE_TAR" in *"$CAND"*) echo "STOP inputs must be outside the checkout"; exit 3 ;; esac
ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$" && { echo "STOP port $PORT already listening"; exit 3; }
echo "dump sha256 verified; candidate clean at $R; stages I333 O2; restored database $RDB"
echo "DEV services BEFORE:"; dev_services | tee "$EVP/dev-before.txt"

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

for STAGE in I333 O2; do
  say "A4 assemble the sealed backup evidence for $STAGE from the restored copy"
  EXTRA=""; [ "$STAGE" = I333 ] && EXTRA="--core-tar '$CORE_TAR'"
  RUNDB "$RDB" bash -c "cd '$CAND' && node --import tsx tools/v2/gap029-assemble-restore-evidence.ts assemble --stage '$STAGE' --production-target '$PROD_TARGET' --dump '$DUMP' --dump-sha256 '$DUMP_SHA' --restore-evidence '$EVP/restore-evidence.json' --work-dir '$EVP/work-$STAGE' --out '$EVP/backup-$STAGE.json' $EXTRA" || exit 7
  echo "backup-$STAGE.json sha256 $(sha256sum "$EVP/backup-$STAGE.json" | cut -d' ' -f1)"
done
echo "restore-evidence.json sha256 $(sha256sum "$EVP/restore-evidence.json" | cut -d' ' -f1)"
echo "TEMPLATE_DB=$RDB"
