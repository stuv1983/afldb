#!/usr/bin/env bash
# hostops ISSUE-352 rehearsal 2: docs/backup-restore.md section 6 procedure A (steps 3-5) on the ISOLATED cluster (port 55620):
# restore a scheduled-backup dump into a NEW candidate database with pg_restore --no-owner --no-comments --exit-on-error,
# reconcile grants with db:privileges, verify ledger / counts / "afldb_app cannot read auth_users". Times the restore (RTO).
# Never production, never 5432. Usage: W=/mnt/ssd/afldb-rem-hostops-20261114 bash rehearse-dr.sh
set -u -o pipefail
: "${W:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
PORT=55620
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
CAND="$W/cand"; R="$W/rehearsal"; EV="$W/evidence/r352"; mkdir -p "$EV"
SRC=afldb_v2_remhostops_src_test; DR=afldb_v2_remhostops_dr_test
BK="$R/backups"
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/dr.log"; }
ss -ltn | awk '{print $4}' | grep -E ":$PORT$" || { say "REFUSED: nothing on $PORT"; exit 1; }
DUMP=$(ls -1t "$BK"/${SRC}-*.dump | head -1); say "dump $(basename "$DUMP") $(stat -c %s "$DUMP") bytes"
(cd "$BK" && sha256sum -c "$(basename "$DUMP").sha256") || exit 1

say "== step 3: candidate database (isolated-pg create-db gives the owner role, extensions and schema ownership the superuser step gives on production)"
IR create-db "$DR" 2>&1 | tail -1
s=$(date +%s)
RUNDB "$DR" bash -c 'pg_restore --dbname="$AFLDB_OWNER_DATABASE_URL" --no-owner --no-comments --jobs=4 --exit-on-error "$0"' "$DUMP"
rc=$?; say "pg_restore rc=$rc elapsed $(( $(date +%s) - s ))s"

say "== step 4: db:privileges against the candidate"
s=$(date +%s)
RUNDB "$DR" node --import tsx tools/db/privileges.ts --target test 2>&1 | tail -4 | sed 's#postgres[a-z]*://[^ ]*#<dsn>#g'
say "privileges elapsed $(( $(date +%s) - s ))s"

say "== step 5: verification queries"
cat > "$R/dr-verify.sql" <<'SQL'
SELECT 'ledger_head', max(name) FROM afldb_meta.schema_migrations;
SELECT 'players', count(*) FROM players;
SELECT 'matches', count(*) FROM matches;
SELECT 'player_match_stats', count(*) FROM player_match_stats;
SELECT 'auth_users', count(*) FROM auth_users;
SELECT 'data_edits', count(*) FROM data_edits;
SELECT 'app_reads_auth_users', has_table_privilege('afldb_app','auth_users','SELECT');
SELECT 'app_reads_players', has_table_privilege('afldb_app','players','SELECT');
SQL
RUNDB "$DR" bash -c 'psql -X "$AFLDB_OWNER_DATABASE_URL" -tA -F" " -v ON_ERROR_STOP=1 -f "$0"' "$R/dr-verify.sql" 2>> "$EV/dr-verify.err" | tee "$EV/dr-verify.out"
say "== same queries on the SOURCE copy for comparison"
RUNDB "$SRC" bash -c 'psql -X "$AFLDB_OWNER_DATABASE_URL" -tA -F" " -v ON_ERROR_STOP=1 -f "$0"' "$R/dr-verify.sql" 2>> "$EV/dr-verify.err" | tee "$EV/dr-verify-source.out"
diff "$EV/dr-verify.out" "$EV/dr-verify-source.out" && say "candidate equals source on every verification query"
say "== done"
