:
{
# Block L read-only production probe (no write of any kind to the database; the only host write is none: output goes to stdout).
# DB access: afldb_backup through the existing protected channel (AFLDB_BACKUP_DATABASE_URL in the checkout .env), parsed into PG*
# variables only, never argv, never printed. Every statement runs in a read-only session.
set -u -o pipefail
export LC_ALL=C
umask 077
R=/home/arm/projects/afldb
PGBIN=/usr/lib/postgresql/16/bin
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD; echo "STOP: $1"; exit "${2:-1}"; }
IDS="$1"

step "H host, user, disk, memory"
echo "host=$(hostname) user=$(id -un) kernel=$(uname -r) uptime=$(uptime -p)"
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || stop "unexpected host/user" 3
df --output=avail,pcent -B1 /home/arm | tail -1; free -m | sed -n 2p
echo "node=$(/home/arm/.nvm/versions/node/v22.23.2/bin/node -v) tsx=$(ls $R/node_modules/.bin/tsx 2>&1)"
ls -ld /home/arm/ops 2>&1 | head -1

step "S services, timers, serving release (read-only systemctl)"
for u in afldb.service afldb-settle-afltables.service afldb-settle-afltables.timer afldb-settle-afl-api.service afldb-settle-afl-api.timer \
  afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer afldb-email-intake.service afldb-email-intake.timer; do
  printf '%s active=%s enabled=%s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null)" "$(systemctl is-enabled "$u" 2>/dev/null)"
done
echo "afldb.service MainPID=$(systemctl show afldb.service -p MainPID --value) ActiveEnterTimestamp=$(systemctl show afldb.service -p ActiveEnterTimestamp --value)"
for t in afldb-settle-afltables.timer; do echo "$t next=$(systemctl show --timestamp=unix -p NextElapseUSecRealtime --value $t 2>/dev/null)"; done
pgrep -af 'settle-|afl-api-|migrate\.ts|pg_dump|pg_restore|gap029' | grep -v pgrep || echo "no settle/migrate/dump/label process"
crontab -l 2>&1 | grep -v '^#' | head -5 || true
echo "checkout_head=$(GIT_OPTIONAL_LOCKS=0 git -C $R rev-parse HEAD 2>&1) status_lines=$(GIT_OPTIONAL_LOCKS=0 git -C $R status --porcelain 2>&1 | wc -l) branch=$(GIT_OPTIONAL_LOCKS=0 git -C $R branch --show-current 2>&1)"
echo "serving_release_dir: $(ls -l $R/../afldb-releases/current 2>/dev/null || ls -ld $R/release* 2>/dev/null | head -2)"
echo "build_id=$(cat $R/.next/BUILD_ID 2>/dev/null || echo none)"

step "E env var NAMES (values never printed) and parsed identities"
ENVF="$R/.env"; [ -r "$ENVF" ] || stop "env file unreadable" 2
echo "env_file_mode=$(stat -c '%a %U:%G' "$ENVF")"
grep -o -E '^[A-Z0-9_]*(DATABASE_URL|DSN)[A-Z0-9_]*=' "$ENVF" | sed 's/=$//' | sort | uniq -c
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
ident() { local v d; v=$(sed -n "s/^$1=//p" "$ENVF" | tail -1 | sed 's/^"\(.*\)"$/\1/'); [ -n "$v" ] || { echo "$1 missing"; return; }
  if [[ "$v" =~ $RE ]]; then echo "$1 user=${BASH_REMATCH[2]} host=${BASH_REMATCH[5]} port=${BASH_REMATCH[7]:-5432} database=${BASH_REMATCH[8]} has_query=$([[ "$v" == *\?* ]] && echo yes || echo no)"; else echo "$1 unparseable"; fi; }
for n in AFLDB_BACKUP_DATABASE_URL AFLDB_IMPORT_DATABASE_URL DATABASE_URL; do ident $n; done

step "C credential (afldb_backup) and read-only session"
DSN=$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' "$ENVF" | tail -1 | sed 's/^"\(.*\)"$/\1/')
[ -n "$DSN" ] || stop "AFLDB_BACKUP_DATABASE_URL empty" 2
[[ "$DSN" =~ $RE ]] || { unset DSN; stop "unexpected form (value not printed)" 2; }
PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}; PWENC=${BASH_REMATCH[4]}
PGPASSWORD=$(printf '%b' "${PWENC//\%/\\x}"); unset PWENC DSN BASH_REMATCH
[ "$PGUSER" = afldb_backup ] && [ "$PGDATABASE" = afldb_prod ] && [ "$PGHOST" = localhost ] && [ "$PGPORT" = 5432 ] || stop "credential is not afldb_backup@localhost:5432/afldb_prod" 2
export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
RO='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000'
q() { PGOPTIONS="$RO" PGAPPNAME=afldb-gap029-labels-probe "$PGBIN/psql" -X -q -At -F "$(printf '\t')" -P pager=off -v ON_ERROR_STOP=1 "$@"; }

step "I identity (for target.json), ledger, extensions"
q -c "SELECT 'identity', current_database(), current_user, inet_server_port()::text, (SELECT oid::text FROM pg_database WHERE datname=current_database()),
 (SELECT system_identifier::text FROM pg_control_system()), current_setting('cluster_name'),
 coalesce(shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database'),'<null>'),
 current_setting('transaction_read_only'), (SELECT rolsuper::text FROM pg_roles WHERE rolname=current_user), current_setting('server_version')" || stop "identity query failed" 5
q -c "SELECT 'ledger', count(*)::text, max(name COLLATE \"C\") FROM afldb_meta.schema_migrations" || stop "ledger count failed" 5
LEDGER=$(q -c "SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE \"C\"") || stop "ledger query failed" 5
echo "ledger_digest=$(printf '%s\n' "$LEDGER" | sha256sum | cut -c1-64) rows=$(printf '%s\n' "$LEDGER" | wc -l)"
printf '%s\n' "$LEDGER" | grep -E '^11[5-9]_' | sed 's/^/ledger_row /'
q -c "SELECT 'extensions', string_agg(extname||'='||extversion, ' ' ORDER BY extname) FROM pg_extension"
q -c "SELECT 'locks_access_exclusive', count(*)::text FROM pg_locks l JOIN pg_database d ON d.oid=l.database WHERE d.datname=current_database() AND l.locktype='relation' AND l.mode='AccessExclusiveLock'"
q -c "SELECT 'nonidle_sessions', count(*)::text FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state IS NOT NULL AND state<>'idle'"
q -c "SELECT 'pg_stat_activity_by_app', coalesce(application_name,''), count(*)::text FROM pg_stat_activity WHERE datname=current_database() GROUP BY 2 ORDER BY 2"

step "A actors: Super Admins (ids only) and who holds can_manage_admins; owner e-mail match is a boolean"
q -c "SELECT 'actor', id::text, role::text, (disabled_at IS NOT NULL)::text AS disabled, can_manage_admins::text, must_change_password::text, (lower(email)=lower('stuart.villanti@gmail.com'))::text AS owner_email_match FROM auth_users WHERE role::text='super_admin' ORDER BY id"
q -c "SELECT 'actor_counts', role::text, (disabled_at IS NOT NULL)::text, count(*)::text FROM auth_users GROUP BY 2,3 ORDER BY 2,3"

step "P privileges of the audited writer role (afldb_import) on the tables saveEdit touches"
q -c "SELECT 'priv', t.tbl, has_table_privilege('afldb_import', 'public.'||t.tbl, 'SELECT')::text AS sel, has_table_privilege('afldb_import', 'public.'||t.tbl, 'INSERT')::text AS ins, has_table_privilege('afldb_import', 'public.'||t.tbl, 'UPDATE')::text AS upd,
  CASE WHEN t.tbl='matches' THEN has_column_privilege('afldb_import','public.matches','match_event','UPDATE')::text ELSE '' END AS match_event_update
  FROM (VALUES ('matches'),('data_edits'),('data_overrides'),('auth_users')) AS t(tbl) ORDER BY 2"
q -c "SELECT 'role', rolname, rolsuper::text, rolcanlogin::text, rolinherit::text FROM pg_roles WHERE rolname IN ('afldb_import','afldb_app','afldb_backup','afldb_owner') ORDER BY 2"

step "L label state"
q -c "SELECT 'labelled_total', count(*)::text FROM matches WHERE match_event IS NOT NULL"
q -c "SELECT 'labelled_by', coalesce(match_event,'<null>'), count(*)::text FROM matches WHERE match_event IS NOT NULL GROUP BY 2 ORDER BY 2"
q -c "SELECT 'edits_match_event', count(*)::text FROM data_edits WHERE table_name='matches' AND field_group='match_event'"
q -c "SELECT 'overrides_match_event', count(*)::text, count(*) FILTER (WHERE is_active)::text FROM data_overrides WHERE entity_type='matches' AND field_group='match_event'"
q -c "SELECT 'matches_total', count(*)::text, max(id)::text, max(match_date)::text FROM matches"

step "M the 64 evidenced matches (identity columns; for local comparison with the evidence file)"
q -c "SELECT 'm', m.id::text, m.season::text, m.match_date::text, m.round_code, coalesce(m.venue_raw,'<null>'), hc.name, ac.name, m.home_score::text, m.away_score::text, coalesce(m.match_event,'<null>')
  FROM matches m JOIN clubs hc ON hc.id=m.home_club_id JOIN clubs ac ON ac.id=m.away_club_id WHERE m.id = ANY('{$IDS}'::bigint[]) ORDER BY m.id"
unset PGPASSWORD
step "DONE"
}
