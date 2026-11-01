#!/usr/bin/env bash
# Block B: restore verification of a production backup AND the baseline of the restored copy (derived from restore-verify-m.sh).
# Restores the verified dump into a guarded disposable database on the isolated cluster, writes CLEAN JSON evidence
# ($EVP/restore-facts.json, $EVP/restored-target.json) and runs the REAL Brownlow runner `baseline` against the restored copy
# ($EVP/baseline-restored.json). Nothing here touches production, the DEV database or any DEV service.
# Usage: EXPECT_ROWS=118 EXPECT_LAST=<last migration name> EXPECT_DIGEST=<ledger digest> W=<workspace with the pinned candidate at W/cand + node_modules + in/restore.mjs + in/probe-dbs.mjs>
#        R=<40-hex> DUMP=<file> DUMP_SHA=<sha256> TAG=<label> [SAME_CLUSTER=1] bash restore-verify-b.sh
# SAME_CLUSTER=1 (used only by the rehearsal, which already runs a cluster that also holds the live clone): skip RV1 and RV4 and use the running cluster on $AFLDB_V2_PG_PORT.
set -u -o pipefail
: "${W:?}" "${R:?}" "${DUMP:?}" "${DUMP_SHA:?}" "${TAG:?}" "${EXPECT_ROWS:?}" "${EXPECT_LAST:?}" "${EXPECT_DIGEST:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
PORT=${AFLDB_V2_PG_PORT:-55493}
CAND="$W/cand"; EVP="$W/evidence-private/$TAG"; mkdir -p -m 700 "$W/evidence-private" "$EVP"
export AFLDB_V2_PG_ROOT="${AFLDB_V2_PG_ROOT:-$W/pg-root}" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
say() { echo "$(date -u +%FT%TZ) $*"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
# isolated-pg `run` refuses while the repository holds a .env: set it aside for exactly the call (the rehearsal candidate has one; production-like candidates do not)
RUNDB() { local db="$1"; shift; local rc; [ -f "$CAND/.env" ] && mv "$CAND/.env" "$W/env.aside.rv"; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); rc=$?; [ -f "$W/env.aside.rv" ] && mv "$W/env.aside.rv" "$CAND/.env"; return $rc; }
RDB=afldb_v2_blockb_${TAG}_rst_test

say "RV0 inputs"
[ "$(cd "$CAND" && git rev-parse HEAD)" = "$R" ] && [ "$(cd "$CAND" && git status --porcelain | wc -l)" = 0 ] || { echo "STOP candidate not clean at $R"; exit 3; }
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "STOP dump sha256 mismatch"; exit 3; }
echo "dump sha256 verified; candidate clean at $R"
if [ "${SAME_CLUSTER:-0}" != 1 ]; then
  ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$" && { echo "STOP port $PORT already listening"; exit 3; }
fi
echo "DEV services BEFORE:"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done

if [ "${SAME_CLUSTER:-0}" != 1 ]; then
  say "RV1 start the guarded cluster"
  ( IR start > "$EVP/pg-start.out" 2>&1 < /dev/null & ) ; sleep 4
  IR status || exit 4
  pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid"); ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$EVP/listener.txt"
  grep -q "127.0.0.1:$PORT" "$EVP/listener.txt" && grep -q "pid=$pmpid," "$EVP/listener.txt" && [ "$(grep -c . "$EVP/listener.txt")" = 1 ] || { echo "STOP listener is not exclusively the cluster we started"; exit 4; }
fi

say "RV2 restore into a guarded disposable database"
IR create-db "$RDB" || exit 5
RESTORE_START=$(date -u +%FT%T.%3NZ)
RUNDB "$RDB" node "$W/in/restore.mjs" "$DUMP" "$DUMP_SHA" || exit 5
RESTORED_AT=$(date -u +%FT%T.%3NZ)
echo "restore_started=$RESTORE_START restored_at=$RESTORED_AT"
cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"; RUNDB "$RDB" node .probe-dbs.mjs "$RDB" | tee "$EVP/restore-probe.txt"; rm -f "$CAND/.probe-dbs.mjs"
grep -q "\"ledger\":\"$EXPECT_LAST\"" "$EVP/restore-probe.txt" || { echo "STOP restored ledger is not $EXPECT_LAST"; exit 5; }
/usr/lib/postgresql/16/bin/pg_restore --list "$DUMP" | grep -cv '^;' | sed 's/^/archive toc entries: /'

say "RV3 restored copy facts and target (read-only) -> clean JSON files"
cat > "$CAND/.restore-facts.mjs" <<'EOS'
import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const [evp, restoredAt, port] = process.argv.slice(2);
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
const led = await sql`SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE "C"`;
const digest = createHash('sha256').update(led.map((r) => `${r.name}	${r.checksum}
`).join('')).digest('hex');
const [c] = await sql`SELECT (SELECT count(*) FROM matches)::int AS matches, (SELECT count(*) FROM fixtures)::int AS fixtures`;
const [t] = await sql`SELECT current_database() AS database, (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid",
  (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier", current_setting('cluster_name') AS "clusterName",
  shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS "databaseComment"`;
const facts = { ledgerRows: led.length, ledgerLast: led[led.length - 1].name, ledgerDigest: digest, ...c, restoredAt };
writeFileSync(`${evp}/restore-facts.json`, `${JSON.stringify(facts)}\n`, { flag: 'wx', mode: 0o600 });
writeFileSync(`${evp}/restored-target.json`, `${JSON.stringify({ host: '127.0.0.1', port: Number(port), user: 'afldb_owner', ...t })}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(facts));
await sql.end({ timeout: 2 });
EOS
RUNDB "$RDB" node .restore-facts.mjs "$EVP" "$RESTORED_AT" "$PORT"; rm -f "$CAND/.restore-facts.mjs"
[ -s "$EVP/restore-facts.json" ] && grep -q "\"ledgerRows\":$EXPECT_ROWS," "$EVP/restore-facts.json" && grep -q "\"ledgerDigest\":\"$EXPECT_DIGEST\"" "$EVP/restore-facts.json" || { echo "STOP restored ledger is not the expected state"; exit 5; }

say "RV3b baseline of the restored copy (the real runner, read-only)"
RUNDB "$RDB" bash -c 'cd "$1" && AFLDB_BROWNLOW_CORRECTION_DSN="$AFLDB_OWNER_DATABASE_URL" node --import tsx --conditions=react-server tools/v2/brownlow-production-correction.ts baseline --target "$2/restored-target.json" --out "$2/baseline-restored.json"' _ "$CAND" "$EVP" || { echo "STOP restored baseline refused"; exit 6; }
[ -s "$EVP/baseline-restored.json" ] || { echo "STOP no restored baseline written"; exit 6; }

if [ "${SAME_CLUSTER:-0}" != 1 ]; then
  say "RV4 stop the cluster and prove isolation"
  IR stop || true; sleep 2
  ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && { echo "WARN port still listening"; }
fi
echo "DEV services AFTER:"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
say "RV DONE restored_at=$RESTORED_AT evidence=$EVP"
