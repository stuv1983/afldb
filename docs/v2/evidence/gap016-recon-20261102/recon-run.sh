set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=$(cat /home/arm/.blockb-w-path); PORT=55496
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
CAND="$W/cand"; RDB=afldb_v2_blockb_recon_rst_test; EVP="$W/evidence-private/recon"
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$RDB" -- "$@"); }
[ "$(cd $CAND && git rev-parse HEAD)" = ea98a35f20610e75c18e698bc0d9fe084c3c783d ] && [ "$(cd $CAND && git status --porcelain | wc -l)" = 0 ] || { echo "STOP candidate not clean at R"; exit 3; }
ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && { echo "STOP port listening"; exit 3; }
( IR start > "$W/recon-start.out" 2>&1 < /dev/null & ); sleep 4
IR status || exit 4
echo "== history reconciliation (read-only, isolated, restored post-E copy)"
[ -e "$EVP/brownlow-history-postE.json" ] && { echo "STOP output exists"; IR stop; exit 5; }
RUNDB bash -c 'cd "$1" && node --import tsx --conditions=react-server tools/v2/brownlow-history.ts "$2/brownlow-history-postE.json"' _ "$CAND" "$EVP"
echo "HISTORY EXIT $?"
sha256sum "$EVP/brownlow-history-postE.json"
echo "== restored-copy SQL facts"
cat > "$CAND/.recon-facts.mjs" <<'EOS'
import postgres from 'postgres';
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true } });
const q = async (l, t) => { const r = await sql.unsafe(t); console.log('## ' + l); console.log(JSON.stringify(r)); };
await q('identity', `SELECT current_database() AS db, current_setting('TimeZone') AS tz`);
await q('receipts', `SELECT operation, count(*) AS n FROM brownlow_correction_receipts GROUP BY 1 ORDER BY 1`);
await q('season_votes coverage', `SELECT count(DISTINCT season) AS seasons, min(season) AS min, max(season) AS max, count(*) AS rows FROM brownlow_season_votes`);
await q('winners by season', `SELECT season, array_agg(player_id ORDER BY player_id) AS winners FROM brownlow_season_votes WHERE is_winner GROUP BY season ORDER BY season`);
await q('ineligible flagged per season', `SELECT season, count(*) AS flagged, count(*) FILTER (WHERE eligible_rank IS NULL) AS no_rank, count(*) FILTER (WHERE is_winner) AS winners FROM brownlow_season_votes WHERE is_ineligible GROUP BY season ORDER BY season`);
await q('round vs season', `WITH r AS (SELECT season, player_id, sum(votes)::int AS rv FROM brownlow_round_votes WHERE season BETWEEN 1984 AND 2025 GROUP BY 1,2), s AS (SELECT season, player_id, votes FROM brownlow_season_votes WHERE season BETWEEN 1984 AND 2025) SELECT count(*) AS pairs, count(*) FILTER (WHERE r.rv IS NOT NULL AND s.votes IS NOT NULL AND r.rv<>s.votes) AS value_differs, count(*) FILTER (WHERE s.votes IS NULL AND r.rv>0) AS round_positive_without_season_row, count(*) FILTER (WHERE r.rv IS NULL) AS season_row_without_round FROM r FULL JOIN s USING (season, player_id)`);
await q('round votes', `SELECT count(*) AS rows, count(*) FILTER (WHERE season BETWEEN 1984 AND 2025 AND match_id IS NOT NULL) AS in_scope_match, count(*) FILTER (WHERE season=2026) AS r2026, count(*) FILTER (WHERE season=2026 AND match_id IS NOT NULL) AS r2026_match, count(*) FILTER (WHERE season=2025 AND source_id IS NOT NULL) AS s2025_sourced, count(*) FILTER (WHERE season=2025 AND source_id IS NULL AND votes>0) AS s2025_sourceless_positive FROM brownlow_round_votes`);
await q('2026 digest', `SELECT count(*)||':'||md5(coalesce(string_agg(md5(to_jsonb(x)::text), '|' ORDER BY md5(to_jsonb(x)::text)), '')) AS d FROM brownlow_round_votes x WHERE season = 2026`);
await q('staged 2025', `SELECT count(*) AS rows, count(*) FILTER (WHERE votes>0) AS positive, count(DISTINCT match_key) AS matches FROM staging.afl_api_brownlow_vote WHERE season=2025`).catch(async (e) => console.log('staged probe: ' + e.message));
await q('decisions', `SELECT count(*) AS n, count(*) FILTER (WHERE verdict='ineligible') AS ineligible FROM brownlow_eligibility_decisions`);
await sql.end({ timeout: 2 });
EOS
RUNDB node .recon-facts.mjs 2>&1 | tee "$EVP/recon-facts.txt"; rm -f "$CAND/.recon-facts.mjs"
IR stop || true; sleep 2
ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && echo "WARN still listening" || echo "cluster stopped; no listener"
for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u) MainPID=$(systemctl show -p MainPID --value $u)"; done
(cd "$CAND" && echo "cand porcelain=$(git status --porcelain | wc -l)")
