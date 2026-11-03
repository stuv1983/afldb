#!/usr/bin/env bash
# GAP-029 FINAL verification follow-up (restore host, READ-ONLY): tests why the S2 gate VERIFY's baseline_sha256 differs on the post-S4 restore (see final-s2-followup.py).
# Same guarded cluster ceremony as final-restore-verify-host.sh (start, exclusive-listener proof, stop, DEV-service before/after). No restore, no write.
# Usage: W=<workspace> R=<40-hex> TAG=<new label> EXPECT=<dir> FV=<dir outside the checkout> CHILD=<child.json> DB_FINAL=<final restore db> DB_POST_S2=<db> DB_POST_S3=<db> bash final-s2-followup-host.sh
set -u -o pipefail
: "${W:?}" "${R:?}" "${TAG:?}" "${EXPECT:?}" "${FV:?}" "${CHILD:?}" "${DB_FINAL:?}" "${DB_POST_S2:?}" "${DB_POST_S3:?}"
[[ "$TAG" =~ ^[a-z0-9_]+$ ]] || { echo "STOP TAG"; exit 2; }
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" PYTHONDONTWRITEBYTECODE=1
CAND="$W/cand"; PORT=${PORT:-55493}; EVP="$W/evidence-private/$TAG"; export AFLDB_PYTHON="$W/venv/bin/python"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
mkdir -m 700 "$EVP" || { echo "STOP $EVP exists"; exit 2; }
SUM="$EVP/followup-summary.txt"; : > "$SUM"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$SUM"; }; rec() { echo "$*" | tee -a "$SUM"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
dev_services() { for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done; }
FAILS=0; ok() { rec "PASS $1"; }; bad() { FAILS=$((FAILS+1)); rec "FAIL $1"; }
[ "$(cd "$CAND" && git rev-parse HEAD)" = "$R" ] && [ "$(cd "$CAND" && git status --porcelain | wc -l)" = 0 ] && ok "candidate clean at $R" || { bad "candidate not clean"; exit 3; }
ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$" && { bad "port $PORT already listening"; exit 3; }
dev_services | tee "$EVP/dev-before.txt" >> "$SUM"
fin() { local rc=$?; IR stop || true; sleep 2; dev_services > "$EVP/dev-after.txt"
  cmp -s "$EVP/dev-before.txt" "$EVP/dev-after.txt" && ok "DEV services unchanged" || bad "DEV service state differs"
  [ "$(cd "$CAND" && git status --porcelain | wc -l)" = 0 ] && ok "pinned checkout still clean" || bad "pinned checkout not clean"
  rec "FOLLOW-UP RESULT: $([ "$FAILS" = 0 ] && echo PASS || echo "FAIL ($FAILS)")"; exit $([ "$FAILS" = 0 ] && echo 0 || echo 1); }
trap fin EXIT
( IR start > "$EVP/pg-start.out" 2>&1 < /dev/null & ); sleep 4; IR status || exit 4
pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid"); ss -ltnp 2>/dev/null | grep ":$PORT " > "$EVP/listener.txt"
grep -q "127.0.0.1:$PORT" "$EVP/listener.txt" && grep -q "pid=$pmpid," "$EVP/listener.txt" && [ "$(grep -c . "$EVP/listener.txt")" = 1 ] && ok "listener is exclusively the cluster we started" || { bad "listener not exclusive"; exit 4; }

say "F1 S2 gate on the retained post-S2 and post-S3 restores"
RUNDB "$DB_FINAL" env CAND="$CAND" EXPECT="$EXPECT" CHILD="$CHILD" DB_POST_S2="$DB_POST_S2" DB_POST_S3="$DB_POST_S3" "$AFLDB_PYTHON" -B "$FV/final-s2-followup.py" 2>&1 | tee "$EVP/s2-followup.out" | tee -a "$SUM"
[ "${PIPESTATUS[0]}" = 0 ] && ok "F1 S2 follow-up" || bad "F1 S2 follow-up"

say "F2 draft_picks: the post-S2 rows are an unchanged prefix of the final table; the additions are exactly S3's eight"
cat > "$EVP/prefix.mjs.tmp" <<'JS'
const postgres = require('postgres');
const [post2, fin] = process.argv.slice(2);
const open = (n) => { const u = new URL(process.env.AFLDB_TEST_DATABASE_URL); u.pathname = '/' + n; return postgres(u.toString(), { max: 1, onnotice: () => {}, connect_timeout: 10, connection: { default_transaction_read_only: true } }); };
(async () => {
  const a = open(post2), b = open(fin);
  try {
    const [m] = await a`SELECT max(id)::int AS mx, count(*)::int AS n FROM draft_picks`;
    const q = (s) => s`SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) AS d FROM draft_picks t WHERE id <= ${m.mx}`;
    const [pa] = await q(a); const [pb] = await q(b);
    const added = await b`SELECT dp.id::int AS id, dp.draft_year::int AS y, dp.pick_number::int AS pick, dp.player_id::int AS pid, dp.detail LIKE 'V2-GAP-029;%' AS gap FROM draft_picks dp WHERE id > ${m.mx} ORDER BY id`;
    const prefixOk = pa.n === pb.n && pa.d === pb.d;
    const addOk = added.length === 8 && added.every((r) => r.gap);
    console.log(`${prefixOk ? 'PASS' : 'FAIL'} post-S2 draft_picks (${pa.n} rows, id <= ${m.mx}) identical in the final restore`);
    console.log(`${addOk ? 'PASS' : 'FAIL'} rows added after S2: ${added.length}, all V2-GAP-029 selections: ${JSON.stringify(added.map((r) => `${r.y}#${r.pick} p${r.pid}`))}`);
    process.exit(prefixOk && addOk ? 0 : 1);
  } finally { await a.end({ timeout: 3 }); await b.end({ timeout: 3 }); }
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });
JS
cp "$EVP/prefix.mjs.tmp" "$CAND/.prefix.cjs"
RUNDB "$DB_FINAL" bash -c "cd '$CAND' && node .prefix.cjs '$DB_POST_S2' '$DB_FINAL'" 2>&1 | tee "$EVP/prefix.out" | tee -a "$SUM"; prc=${PIPESTATUS[0]}; rm -f "$CAND/.prefix.cjs"
[ "$prc" = 0 ] && ok "F2 draft_picks prefix and additions" || bad "F2 draft_picks prefix and additions"
