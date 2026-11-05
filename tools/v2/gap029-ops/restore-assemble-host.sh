#!/usr/bin/env bash
# GAP-029: for ONE data stage, restore that stage's OWN fresh production backup into a guarded disposable database on the isolated cluster, then assemble the
# stage's machine-generated, sealed restore evidence from the restored copy. DERIVED from the reviewed docs/v2/evidence/gap029-hardening-20261103/scripts/
# restore-assemble-host.sh; the substitutions are: (1) the inputs are the CAPTURE DIRECTORY (dump + sidecar + SHA256SUMS + listings) and every hash is
# re-verified here by the independent check `gap029-ops.ts check-capture` before anything is restored; (2) the dump, its sha256 and the provenance come
# from that directory, never from separately typed values; (3) the ledger prefix and the production-target identity check come from the profile;
# (4) the evidence class is printed and the outputs are listed in a machine-readable form. No restore or assembly rule was removed.
#
# Nothing here touches production, the DEV database or any DEV service. It reads the capture directory; it writes only under $W. It never types in a
# restore-derived value: the assembler reads them from the guarded restored database (tools/v2/gap029-assemble-restore-evidence.ts).
#
# Usage (as the host user): W=<workspace: cand/ (pinned checkout + node_modules), pg-root/, venv/ (python with psycopg)> R=<40-hex execution revision>
#   STAGE=S1|S2|S3|S4|I336 CAPDIR=<copied capture directory> PROD_TARGET=<production target json> TAG=<label [a-z0-9_]+> [PROFILE=<profile>] [PORT=55493] bash restore-assemble-host.sh
# Outputs under $W/evidence-private/$TAG: restore-evidence.json, backup.json (the --backup input of that stage's production plan), work/ (the stage tool's own
# rehearsal output; S2: work/child.json), restore-target.json and logs. Exit 0 only when the sealed backup.json exists.
set -u -o pipefail
: "${W:?}" "${R:?}" "${STAGE:?}" "${CAPDIR:?}" "${PROD_TARGET:?}" "${TAG:?}"
[[ "$TAG" =~ ^[a-z0-9_]+$ ]] || { echo "STOP TAG must match [a-z0-9_]+ (it becomes part of an isolated database name)"; exit 2; }
case "$STAGE" in S1|S2|S3|S4|I336) ;; *) echo "STOP STAGE must be S1, S2, S3, S4 or I336"; exit 2 ;; esac
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROFILE=${PROFILE:-$HERE/profile.production.env}
[ -r "$PROFILE" ] || { echo "STOP profile unreadable"; exit 2; }
if grep -qvE '^(#.*|[A-Z_]+="[^"$`\\]*"|)$' "$PROFILE"; then echo "STOP profile contains a line that is not KEY=\"plain value\""; exit 2; fi
if grep -E '^[A-Z_]+=' "$PROFILE" | cut -d= -f1 | grep -qvxE 'PROFILE_NAME|EVIDENCE_CLASS|EXPECT_HOST|EXPECT_USER|PROD_CHECKOUT|OPS_ROOT|BACKUP_ROOT|PGBIN|NODE|PYTHON|EXPECT_SYSID|EXPECT_OID|EXPECT_CLUSTER|EXPECT_DB|EXPECT_DB_HOST|EXPECT_DB_PORT|EXPECT_LEDGER_ROWS|EXPECT_LEDGER_LAST|EXPECT_EXT|EXPECT_DB_OWNER|WRITER_UNITS|ALL_UNITS|TIMER_UNIT|SSH_HOST'; then echo "STOP profile sets a key that is not in the profile grammar"; exit 2; fi
# shellcheck disable=SC1090
. "$PROFILE"
PORT=${PORT:-55493}
CAND="$W/cand"; EVP="$W/evidence-private/$TAG"
export AFLDB_PYTHON="${PY:-$W/venv/bin/python}"   # a python with psycopg (the S2/S4 tools and the importer need it)
mkdir -p -m 700 "$W/evidence-private"; [ -e "$EVP" ] && { echo "STOP $EVP exists; choose a new TAG (evidence is never overwritten)"; exit 2; }; mkdir -m 700 "$EVP"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
say() { echo "$(date -u +%FT%TZ) $*"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
RDB=afldb_v2_gap029_${TAG}_rst_test
dev_services() { for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done; }

say "A0 inputs (profile $PROFILE_NAME, evidence class $EVIDENCE_CLASS)"
[ "$(cd "$CAND" && git rev-parse HEAD)" = "$R" ] || { echo "STOP candidate is not at $R"; exit 3; }
[ "$(cd "$CAND" && git status --porcelain | wc -l)" = 0 ] || { echo "STOP candidate is not clean"; exit 3; }
case "$CAPDIR$PROD_TARGET$W" in *"$CAND"*) echo "STOP inputs must be outside the checkout"; exit 3 ;; esac
(cd "$CAND" && node --import tsx tools/v2/gap029-ops.ts check-capture --stage "$STAGE" --dir "$CAPDIR" --profile "$PROFILE") | tee "$EVP/check-capture.txt" || { echo "STOP the capture directory failed its independent check"; exit 3; }
(cd "$CAND" && node --import tsx tools/v2/gap029-ops.ts check-target --target "$PROD_TARGET" --profile "$PROFILE" --dir "$CAPDIR") || { echo "STOP the production target file failed its check"; exit 3; }
DUMP=$(ls "$CAPDIR"/afldb_prod-*.dump); PROVENANCE=$(ls "$CAPDIR"/afldb_prod-*.provenance.json)
DUMP_SHA=$(sha256sum "$DUMP" | cut -d' ' -f1)
ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$" && { echo "STOP port $PORT already listening"; exit 3; }
echo "dump sha256 $DUMP_SHA verified by check-capture; candidate clean at $R; stage $STAGE"
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
RUNDB "$RDB" node "$CAND/tools/v2/gap029-ops/restore.mjs" "$DUMP" "$DUMP_SHA" | tee "$EVP/restore.out" || exit 5
RESTORED_AT=$(date -u +%FT%T.%3NZ)
echo "restore_started=$RESTORED_AT_START restored_at=$RESTORED_AT"
cp "$CAND/tools/v2/gap029-ops/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"; RUNDB "$RDB" node .probe-dbs.mjs "$RDB" | tee "$EVP/restore-probe.txt"; rm -f "$CAND/.probe-dbs.mjs"
LEDGER_PREFIX=${LEDGER_PREFIX:-${EXPECT_LEDGER_LAST%%_*}_}
grep -qF '"ledger":"'"$LEDGER_PREFIX" "$EVP/restore-probe.txt" || { echo "STOP restored ledger does not start $LEDGER_PREFIX (expected ledger last $EXPECT_LEDGER_LAST)"; exit 5; }

TOC=$(/usr/lib/postgresql/16/bin/pg_restore --list "$DUMP" | grep -cv '^;'); echo "archive toc entries: $TOC"
say "A3 restore evidence (identity proven by query inside the guarded database; source identity from the capture provenance, checked against the production target)"
RUNDB "$RDB" bash -c "cd '$CAND' && node --import tsx tools/v2/gap029-assemble-restore-evidence.ts restore-evidence --provenance '$PROVENANCE' --dump '$DUMP' --dump-sha256 '$DUMP_SHA' --restored-at '$RESTORED_AT' --toc-entries '$TOC' --production-target '$PROD_TARGET' --out '$EVP/restore-evidence.json'" || exit 6

say "A4 assemble the sealed backup evidence for $STAGE from the restored copy"
LABEL_ARGS=""; [ "$STAGE" = S2 ] && LABEL_ARGS="--label '${LABEL:-annual-html-20260826}'"
RUNDB "$RDB" bash -c "cd '$CAND' && node --import tsx tools/v2/gap029-assemble-restore-evidence.ts assemble --stage '$STAGE' --production-target '$PROD_TARGET' --dump '$DUMP' --dump-sha256 '$DUMP_SHA' --restore-evidence '$EVP/restore-evidence.json' --work-dir '$EVP/work' --out '$EVP/backup.json' $LABEL_ARGS" || exit 7
for f in backup.json restore-evidence.json; do echo "OUTPUT $f $(sha256sum "$EVP/$f" | cut -d' ' -f1)"; done
if [ "$STAGE" = S2 ]; then [ -f "$EVP/work/child.json" ] || { echo "STOP S2 produced no child.json"; exit 7; }; echo "OUTPUT child.json $(sha256sum "$EVP/work/child.json" | cut -d' ' -f1)"; fi
echo "ASSEMBLY_COMPLETE stage=$STAGE class=$EVIDENCE_CLASS evidence_dir=$EVP"
