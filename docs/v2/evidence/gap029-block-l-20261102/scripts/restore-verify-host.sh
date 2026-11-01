#!/usr/bin/env bash
# Restore verification of the Block L production backup on the guarded isolated cluster (streamanator, under $W/pg-root, 127.0.0.1:55493).
# Nothing here touches production, the DEV database or any DEV service. Reads the verified dump; writes only under $W.
# Usage: W=<workspace with the pinned candidate + node_modules> R=<40-hex> DUMP=<file> DUMP_SHA=<sha256> TAG=<label> bash restore-verify-host.sh
set -u -o pipefail
: "${W:?}" "${R:?}" "${DUMP:?}" "${DUMP_SHA:?}" "${TAG:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
PORT=55493
CAND="$W/cand"; EVP="$W/evidence-private/$TAG"; mkdir -p -m 700 "$W/evidence-private" "$EVP"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
say() { echo "$(date -u +%FT%TZ) $*"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
RDB=afldb_v2_gap029blockl_${TAG}_rst_test

say "RV0 inputs"
[ "$(cd "$CAND" && git rev-parse HEAD)" = "$R" ] && [ "$(cd "$CAND" && git status --porcelain | wc -l)" = 0 ] || { echo "STOP candidate not clean at $R"; exit 3; }
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "STOP dump sha256 mismatch"; exit 3; }
echo "dump sha256 verified; candidate clean at $R"
ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$" && { echo "STOP port $PORT already listening"; exit 3; }
echo "DEV services BEFORE:"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done

say "RV1 start the guarded cluster"
( IR start > "$EVP/pg-start.out" 2>&1 < /dev/null & ) ; sleep 4
IR status || exit 4
pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid"); ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$EVP/listener.txt"
grep -q "127.0.0.1:$PORT" "$EVP/listener.txt" && grep -q "pid=$pmpid," "$EVP/listener.txt" && [ "$(grep -c . "$EVP/listener.txt")" = 1 ] || { echo "STOP listener is not exclusively the cluster we started"; exit 4; }

say "RV2 restore into a guarded disposable database"
IR create-db "$RDB" || exit 5
RESTORE_START=$(date -u +%FT%T.%3NZ)
RUNDB "$RDB" node "$W/in/restore.mjs" "$DUMP" "$DUMP_SHA" || exit 5
RESTORED_AT=$(date -u +%FT%T.%3NZ)
echo "restore_started=$RESTORE_START restored_at=$RESTORED_AT"
cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"; RUNDB "$RDB" node .probe-dbs.mjs "$RDB" | tee "$EVP/restore-probe.txt"; rm -f "$CAND/.probe-dbs.mjs"
grep -q '"ledger":"117_brownlow_provider_eligibility_unknown.sql"' "$EVP/restore-probe.txt" || { echo "STOP restored ledger is not 117"; exit 5; }
/usr/lib/postgresql/16/bin/pg_restore --list "$DUMP" | grep -cv '^;' | sed 's/^/archive toc entries: /'

say "RV3 restored target identity and the tool's own baseline"
cat > "$CAND/.restore-identity.mjs" <<'EOS'
import postgres from 'postgres';
const url = new URL(process.env.AFLDB_TEST_DATABASE_URL);
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
const [row] = await sql`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier",
  d.oid::text AS "databaseOid", current_setting('cluster_name') AS "clusterName", shobj_description(d.oid,'pg_database') AS "databaseComment"
  FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`;
console.log(JSON.stringify({ host: '127.0.0.1', port: Number(url.port), ...row }, null, 2));
await sql.end({ timeout: 2 });
EOS
RUNDB "$RDB" node .restore-identity.mjs > "$EVP/target-restore.json"; rm -f "$CAND/.restore-identity.mjs"
cat "$EVP/target-restore.json"
RUNDB "$RDB" bash -c "cd '$CAND' && AFLDB_GAP029_DSN=\"\$AFLDB_TEST_DATABASE_URL\" node --import tsx --conditions=react-server tools/v2/apply-gap029-match-events-production.ts baseline --target '$EVP/target-restore.json' --out '$EVP/baseline-restore.json'" || exit 6
node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("restore baselineDigest="+b.baselineDigest+" revision="+b.revision)' "$EVP/baseline-restore.json"

say "RV4 stop the cluster and prove isolation"
IR stop || true; sleep 2
ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && { echo "WARN port still listening"; }
echo "DEV services AFTER:"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
say "RV DONE restored_at=$RESTORED_AT"
