# streamanator: usage bb2-rv.sh <stage> <BKS> <dumpsha>   restore-verify + Melbourne alignment + baseline of restored copy
set -uo pipefail
S=$1; BKS=$2; SHA=$3
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=$(cat /home/arm/.blockb-w-path); PORT=55496
echo "restore-verify-b.sh sha: $(sha256sum $W/in/restore-verify-b.sh | cut -c1-64)"
cd "$W/in"
EXPECT_ROWS=118 EXPECT_LAST=118_fixtures_unconfirmed_participants.sql EXPECT_DIGEST=573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57 \
W="$W" R=ea98a35f20610e75c18e698bc0d9fe084c3c783d DUMP="$W/in/prod-$S/afldb_prod-$BKS.dump" DUMP_SHA=$SHA TAG=$S \
AFLDB_V2_PG_PORT=$PORT bash "$W/in/restore-verify-b.sh" > "$W/rv-$S.log" 2>&1 < /dev/null
RC=$?; echo "RV EXIT $RC"; cat "$W/rv-$S.log" | grep -vE '^(creating|selecting|running|performing|syncing|The |This |Data page|initializ)' ; [ $RC = 0 ] || exit $RC
# alignment of the disposable restore only (production setting and hash algorithm untouched)
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
CAND="$W/cand"; RDB=afldb_v2_blockb_${S}_rst_test; EVP="$W/evidence-private/$S"
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$RDB" -- "$@"); }
ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && { echo "STOP port listening"; exit 3; }
( IR start > "$W/tz-start-$S.out" 2>&1 < /dev/null & ); sleep 4
IR status || exit 4
PSQL='/usr/lib/postgresql/16/bin/psql -X -q -At -v ON_ERROR_STOP=1 "$AFLDB_TEST_DATABASE_URL"'
echo -n "restored session TimeZone BEFORE alignment: "; RUNDB bash -c "$PSQL -c \"SELECT current_setting('TimeZone')\""
RUNDB bash -c "$PSQL -c \"ALTER DATABASE $RDB SET TimeZone = 'Australia/Melbourne'\"" || { echo "ALTER failed"; IR stop; exit 5; }
echo -n "restored session TimeZone AFTER alignment: "; RUNDB bash -c "$PSQL -c \"SELECT current_setting('TimeZone')\""
[ ! -e "$EVP/baseline-restored-utc-session.json" ] && mv "$EVP/baseline-restored.json" "$EVP/baseline-restored-utc-session.json"
RUNDB bash -c 'cd "$1" && AFLDB_BROWNLOW_CORRECTION_DSN="$AFLDB_OWNER_DATABASE_URL" node --import tsx --conditions=react-server tools/v2/brownlow-production-correction.ts baseline --target "$2/restored-target.json" --out "$2/baseline-restored.json"' _ "$CAND" "$EVP"
BRC=$?; echo "BASELINE EXIT $BRC"
sha256sum "$EVP"/*.json; cat "$EVP/restore-facts.json"; echo
IR stop || true; sleep 2
ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && echo "WARN still listening" || echo "cluster stopped; no listener"
for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u) MainPID=$(systemctl show -p MainPID --value $u)"; done
exit $BRC
