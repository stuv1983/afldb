{
# ISSUE-334/335 close-out (5 Nov 2026): owner-authorised READ-ONLY production census of ACTIVE match_coaches
# assignment overrides (data_overrides.entity_type = 'match_coaches'). Answers one question: does every active
# override resolve to an existing match and to a club that played in it?
# Key decode is copied VERBATIM from replay_admin_overrides(match_coaches) in tools/migration/common.py (match key =
# everything before the LAST '|', club slug = everything after it, equality only). Problem precedence follows the
# replay's CASE order; 'club did not play in the match' is an extra participation check placed after the replay's
# club check (the same predicate setCoachAssignment enforces in src/db/queries/admin-coaches.ts).
# No write of any kind: afldb_backup credential from the checkout .env (parsed into PG* only, never argv, never
# printed), default_transaction_read_only=on AND an explicit BEGIN ... READ ONLY ... ROLLBACK. No DDL, no temp objects.
# Output to stdout only.
set -u -o pipefail
export LC_ALL=C
umask 077
R=/home/arm/projects/afldb
PGBIN=/usr/lib/postgresql/16/bin
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD; echo "STOP: $1"; exit "${2:-1}"; }

step "H host and user"
echo "host=$(hostname) user=$(id -un)"
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || stop "unexpected host/user" 3
ENVF="$R/.env"; [ -r "$ENVF" ] || stop "env file unreadable" 2
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
v=$(sed -n "s/^AFLDB_BACKUP_DATABASE_URL=//p" "$ENVF" | tail -1 | sed 's/^"\(.*\)"$/\1/')
[[ "$v" =~ $RE ]] || { unset v; stop "afldb_backup credential not usable (value not printed)" 2; }
PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}
PGPASSWORD=$(printf '%b' "${BASH_REMATCH[4]//\%/\\x}"); unset v BASH_REMATCH
[ "$PGUSER" = afldb_backup ] && [ "$PGDATABASE" = afldb_prod ] && [ "$PGHOST" = localhost ] && [ "$PGPORT" = 5432 ] || stop "credential identity unexpected" 4
export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000'
export PGAPPNAME=afldb-issue335-override-census

step "Q census (one REPEATABLE READ, READ ONLY transaction, rolled back)"
"$PGBIN/psql" -X -q -At -F "$(printf '\t')" -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'identity', current_database(), current_user, current_setting('transaction_read_only'), current_setting('server_version'),
       (SELECT count(*)::text FROM afldb_meta.schema_migrations), (SELECT max(name COLLATE "C") FROM afldb_meta.schema_migrations);
SELECT 'overrides_by_state', is_active::text, field_group, count(*)::text
  FROM data_overrides WHERE entity_type = 'match_coaches' GROUP BY 2, 3 ORDER BY 2, 3;

-- classified: every ACTIVE match_coaches override, decoded exactly as the replay decodes it.
WITH decoded AS (
    SELECT o.id, o.entity_key, o.field_group, o.override_values, o.updated_at,
           strpos(reverse(o.entity_key), '|')                          AS tail,
           left(o.entity_key,
                length(o.entity_key) - strpos(reverse(o.entity_key), '|')) AS match_key,
           right(o.entity_key, strpos(reverse(o.entity_key), '|') - 1) AS club_slug
      FROM data_overrides o
     WHERE o.entity_type = 'match_coaches' AND o.is_active = true
), joined AS (
    SELECT d.*, m.id AS match_id, m.home_club_id, m.away_club_id, cl.id AS club_id, c.id AS coach_id
      FROM decoded d
      LEFT JOIN matches m  ON m.match_key = d.match_key
      LEFT JOIN clubs  cl  ON cl.slug = d.club_slug
      LEFT JOIN coaches c  ON c.afltables_coach_path = d.override_values->>'coach_identity'
), classified AS (
    SELECT j.*,
           CASE
               WHEN j.tail = 0 THEN 'A_malformed_no_delimiter'
               WHEN j.club_slug = '' THEN 'B_malformed_empty_slug'
               WHEN j.match_id IS NULL THEN 'C_missing_match'
               WHEN j.club_id IS NULL THEN 'D_invalid_club_slug'
               WHEN j.club_id <> j.home_club_id AND j.club_id <> j.away_club_id THEN 'E_club_not_participant'
               WHEN NOT jsonb_exists(j.override_values, 'coach_identity') OR j.override_values->>'coach_identity' IS NULL THEN 'F_no_coach_identity'
               WHEN j.coach_id IS NULL THEN 'G_coach_unresolved'
               ELSE 'Z_resolves'
           END AS class
      FROM joined j
)
SELECT 'class_count', class, count(*)::text FROM classified GROUP BY class
UNION ALL
SELECT 'active_total', '-', count(*)::text FROM classified
UNION ALL
-- A resolving override whose canonical row is absent or disagrees (would be restored by the next replay).
SELECT 'resolves_assignment_state',
       CASE WHEN mc.match_id IS NULL THEN 'row_absent'
            WHEN mc.coach_id = k.coach_id THEN 'row_matches_override'
            ELSE 'row_differs_from_override' END,
       count(*)::text
  FROM classified k
  LEFT JOIN match_coaches mc ON mc.match_id = k.match_id AND mc.club_id = k.club_id
 WHERE k.class = 'Z_resolves'
 GROUP BY 2
ORDER BY 1, 2;

-- bounded examples: at most 10 per non-resolving class (no secrets: key, ids, field group, timestamp only).
WITH decoded AS (
    SELECT o.id, o.entity_key, o.field_group, o.override_values, o.updated_at,
           strpos(reverse(o.entity_key), '|')                          AS tail,
           left(o.entity_key,
                length(o.entity_key) - strpos(reverse(o.entity_key), '|')) AS match_key,
           right(o.entity_key, strpos(reverse(o.entity_key), '|') - 1) AS club_slug
      FROM data_overrides o
     WHERE o.entity_type = 'match_coaches' AND o.is_active = true
), joined AS (
    SELECT d.*, m.id AS match_id, m.home_club_id, m.away_club_id, cl.id AS club_id, c.id AS coach_id
      FROM decoded d
      LEFT JOIN matches m  ON m.match_key = d.match_key
      LEFT JOIN clubs  cl  ON cl.slug = d.club_slug
      LEFT JOIN coaches c  ON c.afltables_coach_path = d.override_values->>'coach_identity'
), classified AS (
    SELECT j.*,
           CASE
               WHEN j.tail = 0 THEN 'A_malformed_no_delimiter'
               WHEN j.club_slug = '' THEN 'B_malformed_empty_slug'
               WHEN j.match_id IS NULL THEN 'C_missing_match'
               WHEN j.club_id IS NULL THEN 'D_invalid_club_slug'
               WHEN j.club_id <> j.home_club_id AND j.club_id <> j.away_club_id THEN 'E_club_not_participant'
               WHEN NOT jsonb_exists(j.override_values, 'coach_identity') OR j.override_values->>'coach_identity' IS NULL THEN 'F_no_coach_identity'
               WHEN j.coach_id IS NULL THEN 'G_coach_unresolved'
               ELSE 'Z_resolves'
           END AS class
      FROM joined j
), ranked AS (
    SELECT k.*, row_number() OVER (PARTITION BY k.class ORDER BY k.id) AS rn FROM classified k WHERE k.class <> 'Z_resolves'
)
SELECT 'example', class, id::text, entity_key, field_group, coalesce(override_values->>'coach_identity', '<none>'),
       coalesce(match_id::text, '<none>'), coalesce(club_id::text, '<none>'), updated_at::text
  FROM ranked WHERE rn <= 10 ORDER BY class, id;

SELECT 'still_read_only', current_setting('transaction_read_only');
ROLLBACK;
SQL
rc=$?
unset PGPASSWORD PGUSER PGHOST PGPORT PGDATABASE
echo "psql_rc=$rc"
step "DONE"
}
