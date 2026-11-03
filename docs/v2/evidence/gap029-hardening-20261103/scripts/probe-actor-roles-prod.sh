{
# GAP-029 hardening probe (3 Nov 2026): READ-ONLY. Resolves two questions, nothing else:
#   (1) actor: is auth_users.id 1 the owner's enabled, fully enrolled, non-fixture Super Admin (the predicate of
#       migration 105's assert_viable_super_admin_actor, evaluated with plain SELECTs; the function itself is NOT called because
#       it row-locks FOR SHARE and takes EXECUTE through afldb_import only);
#   (2) privileges: what afldb_import can actually do to public.data_edits on THIS target, and every access restriction that
#       could change the answer (table ACL, column ACL, row-level security, role settings, memberships, migration 108, grants
#       provenance), plus ONE empirical COUNT as afldb_import in a READ ONLY transaction.
# No write of any kind. The only host write is none: output goes to stdout. DB access: afldb_backup (and, for the one empirical
# count, afldb_import) through the existing protected credential channel in the checkout .env, parsed into PG* variables only,
# never argv, never printed. Every statement runs with default_transaction_read_only=on.
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
creds() { # $1 = variable name, $2 = required user ; sets PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD
  local v; v=$(sed -n "s/^$1=//p" "$ENVF" | tail -1 | sed 's/^"\(.*\)"$/\1/')
  [ -n "$v" ] || return 2
  [[ "$v" =~ $RE ]] || { unset v; return 3; }
  PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}
  PGPASSWORD=$(printf '%b' "${BASH_REMATCH[4]//\%/\\x}"); unset v
  [ "$PGUSER" = "$2" ] && [ "$PGDATABASE" = afldb_prod ] && [ "$PGHOST" = localhost ] && [ "$PGPORT" = 5432 ] || return 4
  export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
}
RO='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000'
q() { PGOPTIONS="$RO" PGAPPNAME=afldb-gap029-hardening-probe "$PGBIN/psql" -X -q -At -F "$(printf '\t')" -P pager=off -v ON_ERROR_STOP=1 "$@"; }

step "C1 credential (afldb_backup) and identity"
creds AFLDB_BACKUP_DATABASE_URL afldb_backup || stop "afldb_backup credential not usable (value not printed)" 2
q -c "SELECT 'identity', current_database(), current_user, inet_server_port()::text, (SELECT oid::text FROM pg_database WHERE datname=current_database()),
 (SELECT system_identifier::text FROM pg_control_system()), current_setting('cluster_name'),
 coalesce(shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database'),'<null>'),
 current_setting('transaction_read_only'), current_setting('server_version')" || stop "identity failed" 5
q -c "SELECT 'ledger', count(*)::text, max(name COLLATE \"C\") FROM afldb_meta.schema_migrations"
q -c "SELECT 'ledger_108', name, checksum FROM afldb_meta.schema_migrations WHERE name LIKE '108\_%' OR name LIKE '105\_%' OR name LIKE '066\_%' ORDER BY name COLLATE \"C\""

step "A actor: auth_users id 1 against the migration-105 predicate, then every Super Admin (ids only)"
q -c "SELECT 'actor1', u.id::text, u.role::text AS role, (u.disabled_at IS NULL)::text AS enabled, (u.password_hash IS NOT NULL)::text AS password_enrolled,
  (u.totp_secret IS NOT NULL)::text AS totp_enrolled,
  (NOT ( position('@' in u.email) <= 1 OR position('@' in u.email) = length(u.email) OR rtrim(lower(split_part(u.email,'@',2)),'.') = ''
      OR rtrim(lower(split_part(u.email,'@',2)),'.') ~ '(^|\.)(test|example|invalid|localhost)\$'
      OR rtrim(lower(split_part(u.email,'@',2)),'.') ~ '(^|\.)(example\.com|example\.net|example\.org)\$' ))::text AS non_fixture_email,
  (lower(u.email)=lower('stuart.villanti@gmail.com'))::text AS owner_email_match,
  u.can_manage_admins::text, u.must_change_password::text, u.created_at::text
  FROM auth_users u WHERE u.id = 1"
q -c "SELECT 'actor1_viable_by_predicate', (u.role::text='super_admin' AND u.disabled_at IS NULL AND u.password_hash IS NOT NULL AND u.totp_secret IS NOT NULL
   AND NOT ( position('@' in u.email) <= 1 OR position('@' in u.email) = length(u.email) OR rtrim(lower(split_part(u.email,'@',2)),'.') = ''
      OR rtrim(lower(split_part(u.email,'@',2)),'.') ~ '(^|\.)(test|example|invalid|localhost)\$'
      OR rtrim(lower(split_part(u.email,'@',2)),'.') ~ '(^|\.)(example\.com|example\.net|example\.org)\$' ))::text FROM auth_users u WHERE u.id = 1"
q -c "SELECT 'super_admins', id::text, (disabled_at IS NULL)::text AS enabled, (password_hash IS NOT NULL AND totp_secret IS NOT NULL)::text AS enrolled, (lower(email)=lower('stuart.villanti@gmail.com'))::text AS owner_email_match FROM auth_users WHERE role::text='super_admin' ORDER BY id"
q -c "SELECT 'actor_counts', role::text, (disabled_at IS NOT NULL)::text AS disabled, count(*)::text FROM auth_users GROUP BY 2,3 ORDER BY 2,3"
q -c "SELECT 'actor_fn', p.proname, pg_get_userbyid(p.proowner), p.prosecdef::text, coalesce(array_to_string(p.proconfig, ' '),'<none>'), has_function_privilege('afldb_import', p.oid, 'EXECUTE')::text AS import_exec,
  has_function_privilege('afldb_backup', p.oid, 'EXECUTE')::text AS backup_exec, has_function_privilege('afldb_app', p.oid, 'EXECUTE')::text AS app_exec
  FROM pg_proc p WHERE p.proname = 'assert_viable_super_admin_actor'"

step "P1 afldb_import on public.data_edits: catalog view (table, column, sequence, ACL, RLS, role settings, memberships)"
q -c "SELECT 'role', rolname, rolsuper::text, rolcanlogin::text, rolinherit::text, rolbypassrls::text, coalesce(array_to_string(rolconfig,' '),'<none>') FROM pg_roles WHERE rolname IN ('afldb_import','afldb_auth','afldb_app','afldb_backup','afldb_owner') ORDER BY 2"
q -c "SELECT 'role_db_settings', coalesce(r.rolname,'<all roles>'), coalesce(d.datname,'<all dbs>'), array_to_string(s.setconfig,' ') FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid=s.setrole LEFT JOIN pg_database d ON d.oid=s.setdatabase ORDER BY 2,3"
q -c "SELECT 'memberships', m.rolname AS member, g.rolname AS grantee_of FROM pg_auth_members am JOIN pg_roles m ON m.oid=am.member JOIN pg_roles g ON g.oid=am.roleid WHERE m.rolname LIKE 'afldb\_%' ORDER BY 2,3"
q -c "SELECT 'table_priv', r.rolname, has_table_privilege(r.rolname,'public.data_edits','SELECT')::text AS sel, has_table_privilege(r.rolname,'public.data_edits','INSERT')::text AS ins,
  has_table_privilege(r.rolname,'public.data_edits','UPDATE')::text AS upd, has_table_privilege(r.rolname,'public.data_edits','DELETE')::text AS del, has_table_privilege(r.rolname,'public.data_edits','TRUNCATE')::text AS trunc,
  has_sequence_privilege(r.rolname,'public.data_edits_id_seq','USAGE')::text AS seq_usage
  FROM pg_roles r WHERE r.rolname IN ('afldb_import','afldb_auth','afldb_app','afldb_backup') ORDER BY 2"
q -c "SELECT 'column_select_import', count(*)::text AS columns, count(*) FILTER (WHERE has_column_privilege('afldb_import','public.data_edits',a.attname,'SELECT'))::text AS selectable
  FROM pg_attribute a WHERE a.attrelid='public.data_edits'::regclass AND a.attnum>0 AND NOT a.attisdropped"
q -c "SELECT 'acl', coalesce(g.rolname,'PUBLIC'), x.privilege_type, x.is_grantable::text, pg_get_userbyid(x.grantor) FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x LEFT JOIN pg_roles g ON g.oid=x.grantee WHERE c.oid='public.data_edits'::regclass ORDER BY 2,3"
q -c "SELECT 'rls', relrowsecurity::text, relforcerowsecurity::text, pg_get_userbyid(relowner), relkind::text FROM pg_class WHERE oid='public.data_edits'::regclass"
q -c "SELECT 'policies', count(*)::text FROM pg_policies WHERE schemaname='public' AND tablename='data_edits'"
q -c "SELECT 'triggers_on_data_edits', count(*)::text FROM pg_trigger WHERE tgrelid='public.data_edits'::regclass AND NOT tgisinternal"
q -c "SELECT 'meta_import_writable_has_data_edits', count(*)::text FROM afldb_meta.import_writable_tables WHERE table_name = 'data_edits'" 2>/dev/null || echo "meta_import_writable_has_data_edits n/a"
q -c "SELECT 'rows_visible_to_backup', count(*)::text, coalesce(max(id),0)::text FROM data_edits"
unset PGPASSWORD PGUSER PGHOST PGPORT PGDATABASE

step "C2 credential (afldb_import): parsed identity only, then ONE empirical READ ONLY count on data_edits"
IMPV=$(sed -n 's/^AFLDB_IMPORT_DATABASE_URL=//p' "$ENVF" | tail -1 | sed 's/^"\(.*\)"$/\1/')
if [[ "$IMPV" =~ $RE ]]; then echo "import_dsn user=${BASH_REMATCH[2]} host=${BASH_REMATCH[5]} port=${BASH_REMATCH[7]:-5432} database=${BASH_REMATCH[8]} has_query=$([[ "$IMPV" == *\?* ]] && echo yes || echo no)"; else echo "import_dsn unparseable or missing"; fi
unset IMPV BASH_REMATCH
if creds AFLDB_IMPORT_DATABASE_URL afldb_import; then
  q -c "SELECT 'import_identity', current_user, session_user, current_database(), current_setting('transaction_read_only'), (SELECT rolsuper::text FROM pg_roles WHERE rolname=current_user)"
  q -c "SELECT 'import_data_edits_count', count(*)::text, coalesce(max(id),0)::text FROM data_edits" && echo "import_data_edits_select=OK" || echo "import_data_edits_select=DENIED_OR_FAILED"
  q -c "SELECT 'import_seq_state', last_value::text, is_called::text FROM data_edits_id_seq"  && echo "import_seq_read=OK" || echo "import_seq_read=DENIED_OR_FAILED"
  q -c "SELECT 'import_effective', has_table_privilege(current_user,'public.data_edits','SELECT')::text, has_table_privilege(current_user,'public.data_edits','INSERT')::text, has_table_privilege(current_user,'public.data_edits','UPDATE')::text"
else
  echo "afldb_import credential not usable from the .env channel (value not printed)"
fi
unset PGPASSWORD PGUSER PGHOST PGPORT PGDATABASE
step "DONE"
}
