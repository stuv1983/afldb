set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=$(cat /home/arm/.blockb-w-path); PORT=55496
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
CAND="$W/cand"; RDB=afldb_v2_blockb_b0_rst_test; EVP="$W/evidence-private/b0"
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$RDB" -- "$@"); }
ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && { echo "STOP port listening"; exit 3; }
( IR start > "$W/tz-start.out" 2>&1 < /dev/null & ); sleep 4
IR status || exit 4
PSQL='/usr/lib/postgresql/16/bin/psql -X -q -At -v ON_ERROR_STOP=1 "$AFLDB_TEST_DATABASE_URL"'
RUNDB bash -c "$PSQL -c \"ALTER DATABASE $RDB SET TimeZone = 'Australia/Melbourne'\"" || { echo "ALTER failed"; IR stop; exit 5; }
RUNDB bash -c "$PSQL -c \"SELECT current_setting('TimeZone')\""
[ ! -e "$EVP/baseline-restored-utc-session.json" ] && mv "$EVP/baseline-restored.json" "$EVP/baseline-restored-utc-session.json"
RUNDB bash -c 'cd "$1" && AFLDB_BROWNLOW_CORRECTION_DSN="$AFLDB_OWNER_DATABASE_URL" node --import tsx --conditions=react-server tools/v2/brownlow-production-correction.ts baseline --target "$2/restored-target.json" --out "$2/baseline-restored.json"' _ "$CAND" "$EVP"
echo "BASELINE EXIT $?"
sha256sum "$EVP"/baseline-restored*.json; cat "$EVP/baseline-restored.json"
IR stop || true; sleep 2
ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && echo "WARN still listening" || echo "cluster stopped; no listener"
for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u) MainPID=$(systemctl show -p MainPID --value $u)"; done
