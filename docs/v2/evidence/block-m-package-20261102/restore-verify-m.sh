#!/usr/bin/env bash
# Restore verification of a Block M production backup (derived from the Block L script: RV0-RV2 and RV4 unchanged except the ledger expectation; RV3 reads ledger/matches/fixtures facts instead of the label baseline)
# Restore verification of the Block L production backup on the guarded isolated cluster (streamanator, under $W/pg-root, 127.0.0.1:55493).
# Nothing here touches production, the DEV database or any DEV service. Reads the verified dump; writes only under $W.
# Usage: EXPECT_ROWS=117|118 EXPECT_LAST=<last migration name> EXPECT_DIGEST=<ledger digest> W=<workspace with the pinned candidate + node_modules> R=<40-hex> DUMP=<file> DUMP_SHA=<sha256> TAG=<label> bash restore-verify-host.sh
set -u -o pipefail
: "${W:?}" "${R:?}" "${DUMP:?}" "${DUMP_SHA:?}" "${TAG:?}" "${EXPECT_ROWS:?}" "${EXPECT_LAST:?}" "${EXPECT_DIGEST:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
PORT=55493
CAND="$W/cand"; EVP="$W/evidence-private/$TAG"; mkdir -p -m 700 "$W/evidence-private" "$EVP"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
say() { echo "$(date -u +%FT%TZ) $*"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
RDB=afldb_v2_blockm_${TAG}_rst_test

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
grep -q "\"ledger\":\"$EXPECT_LAST\"" "$EVP/restore-probe.txt" || { echo "STOP restored ledger is not $EXPECT_LAST"; exit 5; }
/usr/lib/postgresql/16/bin/pg_restore --list "$DUMP" | grep -cv '^;' | sed 's/^/archive toc entries: /'

say "RV3 restored copy facts (read-only; the live facts come from m-prod.sh pre/readback and must be equal)"
cat > "$CAND/.restore-facts.mjs" <<'EOS'
import postgres from 'postgres';
import { createHash } from 'node:crypto';
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
const led = await sql`SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE "C"`;
const digest = createHash('sha256').update(led.map((r) => `${r.name}	${r.checksum}
`).join('')).digest('hex');
const [c] = await sql`SELECT (SELECT count(*) FROM matches)::int AS matches, (SELECT count(*) FROM fixtures)::int AS fixtures`;
console.log(JSON.stringify({ ledgerRows: led.length, ledgerLast: led[led.length - 1].name, ledgerDigest: digest, ...c }));
await sql.end({ timeout: 2 });
EOS
RUNDB "$RDB" node .restore-facts.mjs | tee "$EVP/restore-facts.json"; rm -f "$CAND/.restore-facts.mjs"
grep -q "\"ledgerRows\":$EXPECT_ROWS," "$EVP/restore-facts.json" && grep -q "\"ledgerDigest\":\"$EXPECT_DIGEST\"" "$EVP/restore-facts.json" || { echo "STOP restored ledger is not the expected state"; exit 5; }

say "RV4 stop the cluster and prove isolation"
IR stop || true; sleep 2
ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && { echo "WARN port still listening"; }
echo "DEV services AFTER:"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
say "RV DONE restored_at=$RESTORED_AT"
