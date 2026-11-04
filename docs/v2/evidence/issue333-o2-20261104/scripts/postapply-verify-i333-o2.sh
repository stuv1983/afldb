:
{
# ISSUE-333 (O1) / O2 POST-APPLY read-only verification, production. No write of any kind: psql runs in a read-only session as afldb_backup
# (default_transaction_read_only=on); the application-query figures run as the application role afldb_app (SELECT-only grants) from the ops
# checkout, with the DSN passed to the child environment only and never printed. Output goes to stdout only.
#   bash postapply-verify-i333-o2.sh <figures.mts path> <figures-out.json path (must not exist)>
set -u -o pipefail
export LC_ALL=C
umask 077
R=/home/arm/projects/afldb
OPS=/home/arm/ops/issue333-o2-50ed6e4f
PGBIN=/usr/lib/postgresql/16/bin
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD; echo "STOP: $1"; exit "${2:-1}"; }
FIG=${1:?figures.mts}; FIGOUT=${2:?figures out}
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || stop "unexpected host/user" 3
ENVF="$R/.env"
envval() { sed -n "s/^$1=//p" "$ENVF" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }
DSN=$(envval AFLDB_BACKUP_DATABASE_URL)
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
[[ "$DSN" =~ $RE ]] || { unset DSN; stop "backup credential has an unexpected form" 2; }
PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}; PWENC=${BASH_REMATCH[4]}
PGPASSWORD=$(printf '%b' "${PWENC//\%/\\x}"); unset PWENC DSN BASH_REMATCH
[ "$PGUSER" = afldb_backup ] && [ "$PGDATABASE" = afldb_prod ] || stop "credential is not afldb_backup/afldb_prod" 2
export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
q() { PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=2000' PGAPPNAME=afldb-i333o2-postapply "$PGBIN/psql" -X -q -At -F '|' -P pager=off -v ON_ERROR_STOP=1 -c "$1"; }

step "I identity"
q "SELECT current_database(), current_user, current_setting('transaction_read_only'), (SELECT system_identifier::text FROM pg_control_system()), (SELECT oid FROM pg_database WHERE datname=current_database())"
step "O1 counts (baseline: match_coaches 32034, coaches 386, import_batches 75 max 82, rejections 681, match_coaches_2026 0, sides_without_coach 436)"
q "SELECT 'match_coaches', count(*) FROM match_coaches UNION ALL SELECT 'coaches', count(*) FROM coaches
 UNION ALL SELECT 'match_coaches_2026', count(*) FROM match_coaches mc JOIN matches m ON m.id=mc.match_id WHERE m.season=2026
 UNION ALL SELECT 'sides_2026_without_coach', count(*) FROM (SELECT id, home_club_id c FROM matches WHERE season=2026 UNION ALL SELECT id, away_club_id FROM matches WHERE season=2026) s LEFT JOIN match_coaches mc ON mc.match_id=s.id AND mc.club_id=s.c WHERE mc.match_id IS NULL
 UNION ALL SELECT 'import_batches', count(*) FROM import_batches UNION ALL SELECT 'import_batches_max_id', max(id) FROM import_batches
 UNION ALL SELECT 'import_rejections', count(*) FROM import_rejections UNION ALL SELECT 'import_rejections_max_id', coalesce(max(id),0) FROM import_rejections"
q "SELECT 'batches_after_82', id, source_id, tool, target_table, status::text, records_read, records_inserted, records_updated, records_rejected, started_at, completed_at, left(coalesce(error,''),80) FROM import_batches WHERE id>82 ORDER BY id"
q "SELECT 'new_rows_by_batch', import_batch_id, source_id, count(*), min(match_id), max(match_id) FROM match_coaches WHERE import_batch_id>82 GROUP BY 2,3 ORDER BY 2"
q "SELECT 'rows_with_batch_leq82_or_null', count(*) FROM match_coaches WHERE import_batch_id IS NULL OR import_batch_id<=82"
q "SELECT 'season_2026_by_season_batch', m.season, count(*), count(DISTINCT mc.coach_id) FROM match_coaches mc JOIN matches m ON m.id=mc.match_id WHERE m.season>=2025 GROUP BY 2 ORDER BY 2"
q "SELECT 'carr_fraser', c.id, c.afltables_coach_path, c.name_key, count(mc.*), count(mc.*) FILTER (WHERE mc.import_batch_id>82) FROM coaches c LEFT JOIN match_coaches mc ON mc.coach_id=c.id WHERE c.name_key IN ('Carr, Josh','Fraser, Josh') GROUP BY 2,3,4 ORDER BY 2"
q "SELECT 'coach_2026_distinct', count(DISTINCT mc.coach_id) FROM match_coaches mc JOIN matches m ON m.id=mc.match_id WHERE m.season=2026"
step "O2 findings (baseline: 40 rows, 40 open, ids 41-76 open canonical_apply_failed foreign_source_owner)"
q "SELECT 'data_issues_total', count(*), count(*) FILTER (WHERE resolved_at IS NULL), max(id) FROM data_issues"
q "SELECT 'o2_resolved', count(*), min(id), max(id), min(resolved_at), max(resolved_at), string_agg(DISTINCT resolution, ';'), count(*) FILTER (WHERE issue_type='canonical_apply_failed' AND details->>'refusal'='foreign_source_owner') FROM data_issues WHERE id BETWEEN 41 AND 76 AND resolved_at IS NOT NULL"
q "SELECT 'o2_rows_still_open', count(*) FROM data_issues WHERE id BETWEEN 41 AND 76 AND resolved_at IS NULL"
q "SELECT 'o2_details_md5', md5(string_agg(id::text||'|'||issue_key||'|'||details::text||'|'||severity::text||'|'||coalesce(entity_id::text,'')||'|'||detected_at::text, ',' ORDER BY id)) FROM data_issues WHERE id BETWEEN 41 AND 76"
q "SELECT 'other_issues', id, issue_type, entity_type, severity::text, resolved_at, resolution, detected_at FROM data_issues WHERE NOT (id BETWEEN 41 AND 76) ORDER BY id"
q "SELECT 'other_issues_md5', md5(string_agg(id::text||'|'||issue_type||'|'||coalesce(issue_key,'')||'|'||details::text||'|'||coalesce(resolved_at::text,'')||'|'||coalesce(resolution,''), ',' ORDER BY id)) FROM data_issues WHERE NOT (id BETWEEN 41 AND 76)"
q "SELECT 'open_by_type', issue_type, count(*) FROM data_issues WHERE resolved_at IS NULL GROUP BY 2 ORDER BY 2"
q "SELECT 'pms_afltables_owner_36', count(*) FROM data_issues d JOIN player_match_stats p ON p.id=d.entity_id JOIN sources s ON s.id=p.source_id WHERE d.id BETWEEN 41 AND 76 AND s.key='afltables'"
unset PGPASSWORD

step "F application-query figures (src/db/queries/coaches.ts via the ops checkout; role afldb_app; SELECT-only)"
APPDSN=$(envval DATABASE_URL)
[ -n "$APPDSN" ] || stop "DATABASE_URL missing in the checkout env" 2
cd "$OPS/cand" || stop "no ops checkout" 3
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
[ -e .coach-figures.mts ] && stop ".coach-figures.mts already exists in the ops checkout" 3
cp "$FIG" .coach-figures.mts
DATABASE_URL="$APPDSN" NODE_ENV=production AFLDB_POOL_MAX=2 node --import tsx --conditions=react-server .coach-figures.mts "$FIGOUT"; FRC=$?
rm -f .coach-figures.mts
unset APPDSN
echo "figures exit $FRC"
echo "ops checkout status lines after figures: $(git status --porcelain | wc -l)"
step DONE
exit $FRC
}
