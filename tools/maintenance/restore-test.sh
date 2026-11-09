#!/usr/bin/env bash
#
# AFLDB restore verification.
#
#   tools/maintenance/restore-test.sh                 restore the newest backup
#   tools/maintenance/restore-test.sh <file.dump>     restore a specific backup
#
# A backup is not proven until it has been restored and checked. This
# restores into afldb_restore_test (never afldb_dev) and runs core parity
# checks against the restored copy.
#
# Requires afldb_restore_test to exist. It is created once by
# tools/maintenance/01_setup_service.sh.
#
set -euo pipefail

cd "$(dirname "$0")/../.."
[ -f .env ] && set -a && . ./.env && set +a

# AFLDB-ISSUE-341: libpq chooses WHERE a connection goes from the connection
# string AND from these environment variables (the routing set tools/db/psql.ts
# LIBPQ_ROUTING_ENV pins for the destructive rebuild, ISSUE-278). Inherited from
# the caller or set by .env, any of them can move psql or pg_restore away from
# the database the URL names. They are removed here, after .env, so the DSN
# validated below is the ONLY thing that routes every child of this script.
for __routing_var in PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE \
                     PGSERVICEFILE PGSYSCONFDIR PGOPTIONS PGTARGETSESSIONATTRS \
                     PGLOADBALANCEHOSTS; do
  unset "$__routing_var"
done
unset __routing_var

BACKUP_DIR="${AFLDB_BACKUP_DIR:-$HOME/backups/afldb}"
OWNER_DSN="${AFLDB_OWNER_DATABASE_URL:-}"

if [[ -z "$OWNER_DSN" ]]; then
  echo "ERROR: AFLDB_OWNER_DATABASE_URL is not set." >&2
  exit 1
fi

RESTORE_DB="afldb_restore_test"

# AFLDB-ISSUE-341: the accepted connection contract.
#
# The form .env.example and the installers write, and nothing looser:
#
#   postgres[ql]://USER[:PASSWORD]@HOST[:PORT]/DBNAME[?OPTION=VALUE&...]
#
# USER and DBNAME are plain identifiers ([A-Za-z0-9_]), HOST is one name or
# bracketed address (no comma-separated host list), and the query may carry
# only transport options that cannot change the destination. In particular
# `?dbname=` overrides the URL path in libpq (PostgreSQL 16 fe-connect.c,
# closed ISSUE-278 H-278-1), so rewriting only the path used to leave a query
# that silently pointed the destructive steps back at the source database.
# Anything outside this contract -- key=value strings, service names, host
# lists, a percent-encoded keyword -- is refused, never interpreted.
refuse_dsn() {
  echo "ERROR: AFLDB_OWNER_DATABASE_URL is outside the restore connection contract: $1." >&2
  echo "       Expected postgresql://USER:PASSWORD@HOST:PORT/DBNAME with no target-changing options." >&2
  exit 1
}

DSN_RE='^(postgres|postgresql)://([A-Za-z0-9_]+)(:([^@/?#]*))?@([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:([0-9]{1,5}))?/([A-Za-z0-9_]+)(\?([^#]*))?$'
if [[ ! "$OWNER_DSN" =~ $DSN_RE ]]; then
  refuse_dsn "it is not a single-host URL with a user and a plain database name"
fi
DSN_SCHEME="${BASH_REMATCH[1]}"
EXPECTED_USER="${BASH_REMATCH[2]}"
DSN_HAS_PASSWORD="${BASH_REMATCH[3]:+yes}"
DSN_PASSWORD_RAW="${BASH_REMATCH[4]}"
DSN_HOST="${BASH_REMATCH[5]}"
DSN_PORT="${BASH_REMATCH[7]}"
SOURCE_DB="${BASH_REMATCH[8]}"
DSN_QUERY="${BASH_REMATCH[10]}"

# Only these query options are accepted; each is transport, not routing.
ALLOWED_QUERY_KEYS=" sslmode sslrootcert sslcert sslkey sslcrl connect_timeout application_name "
if [[ -n "$DSN_QUERY" ]]; then
  IFS='&' read -r -a __query_items <<< "$DSN_QUERY"
  for __item in "${__query_items[@]}"; do
    __key="${__item%%=*}"
    if [[ "$__item" != *=* || -z "$__key" || "$ALLOWED_QUERY_KEYS" != *" ${__key} "* ]]; then
      refuse_dsn "query option '${__key:-<empty>}' can change the target or is not supported"
    fi
  done
  unset __query_items __item __key
fi

if [[ "$SOURCE_DB" == "$RESTORE_DB" ]]; then
  echo "ERROR: source and restore target are the same database (${RESTORE_DB})." >&2
  exit 1
fi

# Move the password out of argv and into PGPASSWORD. A DSN on a command line is
# visible in `ps` and /proc/<pid>/cmdline; the environment is readable only by
# the owner. libpq percent-decodes a URL password, so the same decoding is
# applied here; a sequence that cannot be decoded exactly is refused rather
# than guessed at.
BAD_PERCENT_RE='%([^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|[0-9A-Fa-f]?$)'
if [[ -n "$DSN_HAS_PASSWORD" && -n "$DSN_PASSWORD_RAW" ]]; then
  # A backslash would be read as an escape by printf %b; a NUL cannot live in
  # an environment variable. Neither is a password libpq could use either.
  if [[ "$DSN_PASSWORD_RAW" == *\\* || "$DSN_PASSWORD_RAW" == *%00* ]] \
     || [[ "$DSN_PASSWORD_RAW" =~ $BAD_PERCENT_RE ]]; then
    refuse_dsn "the password is not cleanly percent-encoded"
  fi
  printf -v PGPASSWORD '%b' "${DSN_PASSWORD_RAW//\%/\\x}"
  export PGPASSWORD
fi
unset DSN_PASSWORD_RAW

DSN_AUTHORITY="${EXPECTED_USER}@${DSN_HOST}${DSN_PORT:+:${DSN_PORT}}"
DSN_SUFFIX="${DSN_QUERY:+?${DSN_QUERY}}"
OWNER_DSN="${DSN_SCHEME}://${DSN_AUTHORITY}/${SOURCE_DB}${DSN_SUFFIX}"
RESTORE_DSN="${DSN_SCHEME}://${DSN_AUTHORITY}/${RESTORE_DB}${DSN_SUFFIX}"

# psql without ~/.psqlrc (which could \connect elsewhere) and stopping on error.
psql_x() { psql -X -v ON_ERROR_STOP=1 "$@"; }

# The SQL that proves, inside the very session about to act, that it is
# connected to the disposable database as the expected role. Both names are
# validated identifiers above, so they are safe to embed. Every destructive or
# marker-writing stream starts with it; a mismatch aborts that stream (and,
# through ON_ERROR_STOP and set -e, this script) before its first write.
identity_guard_sql() {
  cat <<SQL
DO \$afldb_identity\$
BEGIN
  IF current_database() <> '${RESTORE_DB}' OR current_user <> '${EXPECTED_USER}' THEN
    RAISE EXCEPTION 'AFLDB restore target identity mismatch: connected to % as %, expected ${RESTORE_DB} as ${EXPECTED_USER}',
      current_database(), current_user;
  END IF;
END
\$afldb_identity\$;
SQL
}

BACKUP="${1:-}"
if [[ -z "$BACKUP" ]]; then
  BACKUP=$(ls -1t "${BACKUP_DIR}"/"${SOURCE_DB}"-*.dump 2>/dev/null | head -1 || true)
fi
if [[ -z "$BACKUP" || ! -f "$BACKUP" ]]; then
  echo "ERROR: no backup found in ${BACKUP_DIR}" >&2
  exit 1
fi

echo "==> Restoring $(basename "$BACKUP") into afldb_restore_test"

if ! identity_guard_sql | psql_x -q "$RESTORE_DSN" > /dev/null 2>&1; then
  echo "ERROR: cannot connect to afldb_restore_test as ${EXPECTED_USER}, or the connection" >&2
  echo "       landed somewhere else. Nothing has been changed." >&2
  echo "       Create it first: sudo bash tools/maintenance/01_setup_service.sh" >&2
  exit 1
fi

# AFLDB-ISSUE-250: bind the restored copy to the exact dump file. Hash it BEFORE restoring (a
# file replaced mid-run cannot be bound), clear any earlier binding first (a failed run must
# never leave a stale one), and record it as the database comment only after every parity check
# passes. `db:promotion:check --phase freeze-dump` reads it back.
BACKUP_SHA256=$(sha256sum "$BACKUP" | awk '{print $1}')
if [[ ! "$BACKUP_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "ERROR: could not hash ${BACKUP}." >&2
  exit 1
fi

START=$(date +%s)

# Empty the target BEFORE restoring. Without this a failed restore leaves
# the previous generation in place, and because a reload is deterministic
# the parity checks can pass against data the dump never produced —
# "verified" on a backup that is not restorable.
#
# Tables are dropped individually rather than by dropping the schema:
# pg_trgm and unaccent live in public and are owned by another role, so
# DROP SCHEMA public CASCADE would fail on extension ownership.
#
# AFLDB-ISSUE-341: the identity guard, the marker clear and the DROP loop are
# ONE psql session, so the database proven is the database emptied.
echo "    clearing ${RESTORE_DB}"
{
  identity_guard_sql
  printf 'COMMENT ON DATABASE %s IS NULL;\n' "$RESTORE_DB"
  cat <<'SQL'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', r.schemaname, r.tablename);
  END LOOP;
END $$;
SQL
} | psql_x -q "$RESTORE_DSN"

# --clean --if-exists makes the restore repeatable.
#
# The restoring role does not own pg_trgm or unaccent, so --clean's
# DROP EXTENSION and the COMMENT ON EXTENSION statements always fail with
# "must be owner of extension". Both are harmless: the extensions already
# exist in the target and must stay.
#
# AFLDB-ISSUE-342: completion is decided by pg_restore's exit status, never
# by the absence of text. pg_restore exits 0 when nothing failed and 1 when
# it ran to the end ignoring errors, in which case its LAST act is the
# summary "errors ignored on restore: N". So the only accepted outcomes are:
#   0  with no error lines at all; or
#   1  with every error line one of the known extension-owner errors, at
#      least one of them, AND the closing summary naming exactly that count.
# Anything else -- a signal (128+n, e.g. 137), a missing or unrunnable binary
# (126/127), a fatal stop with status 1 but no summary, an empty log with a
# nonzero status, an unknown error -- fails here, before any parity check
# and with no proof marker (it was cleared above).
RESTORE_LOG=$(mktemp)
trap 'rm -f "$RESTORE_LOG"' EXIT

set +e
pg_restore \
  --dbname="$RESTORE_DSN" \
  --clean --if-exists \
  --no-owner \
  --no-privileges \
  --no-comments \
  --jobs=4 \
  "$BACKUP" > "$RESTORE_LOG" 2>&1
RESTORE_STATUS=$?
set -e

UNEXPECTED=$(grep -v '^pg_restore: warning' "$RESTORE_LOG" \
  | grep -v 'must be owner of extension' \
  | grep -v 'Command was: DROP EXTENSION' \
  | grep -v 'Command was: COMMENT ON EXTENSION' \
  | grep -v '^ *$' || true)

if [[ -n "$UNEXPECTED" ]]; then
  echo "ERROR: pg_restore reported errors beyond the known extension-owner ones:" >&2
  printf '%s\n' "$UNEXPECTED" >&2
  echo "       (pg_restore exit status ${RESTORE_STATUS})" >&2
  exit 1
fi

TOLERATED_ERRORS=$(grep -c 'must be owner of extension' "$RESTORE_LOG" || true)
IGNORED_SUMMARY=$(sed -n 's/^pg_restore: warning: errors ignored on restore: \([0-9][0-9]*\)$/\1/p' "$RESTORE_LOG" | tail -1)

case "$RESTORE_STATUS" in
  0)
    if [[ "$TOLERATED_ERRORS" -ne 0 || -n "$IGNORED_SUMMARY" ]]; then
      echo "ERROR: pg_restore exited 0 but its log reports errors; refusing an inconsistent result." >&2
      exit 1
    fi
    ;;
  1)
    if [[ "$TOLERATED_ERRORS" -lt 1 || -z "$IGNORED_SUMMARY" \
          || "$IGNORED_SUMMARY" -ne "$TOLERATED_ERRORS" ]]; then
      echo "ERROR: pg_restore exited 1 without completing: expected its closing" >&2
      echo "       'errors ignored on restore: N' summary to account for exactly the" >&2
      echo "       ${TOLERATED_ERRORS} extension-owner error(s) logged (summary: ${IGNORED_SUMMARY:-absent})." >&2
      exit 1
    fi
    echo "    pg_restore exited 1; it completed, ignoring only ${TOLERATED_ERRORS} extension-owner error(s)"
    ;;
  *)
    echo "ERROR: pg_restore terminated abnormally (exit status ${RESTORE_STATUS})." >&2
    echo "       The restore is incomplete and cannot be verified." >&2
    exit 1
    ;;
esac

ELAPSED=$(( $(date +%s) - START ))
echo "    restored in ${ELAPSED}s"

echo "==> Parity checks against the restored database"

FAILED=0
check() {
  local label="$1" query="$2"
  local source_value restored_value
  # A missing table means the restore did not complete. That must read as
  # a failed check, not as an aborted script with no verdict.
  source_value=$(psql -X "$OWNER_DSN"   -tAc "$query" 2>/dev/null) || source_value='<query failed>'
  restored_value=$(psql -X "$RESTORE_DSN" -tAc "$query" 2>/dev/null) || restored_value='<query failed>'
  if [[ "$source_value" == "$restored_value" && "$restored_value" != '<query failed>' ]]; then
    printf '    PASS  %-38s %s\n' "$label" "$restored_value"
  else
    printf '    FAIL  %-38s source=%s restored=%s\n' "$label" "$source_value" "$restored_value"
    FAILED=$((FAILED + 1))
  fi
}

check "player_match_stats rows"  "SELECT count(*) FROM player_match_stats"
check "players rows"             "SELECT count(*) FROM players"
check "matches rows"             "SELECT count(*) FROM matches"
check "clubs rows"               "SELECT count(*) FROM clubs"
check "career games total"       "SELECT sum(games) FROM player_career_stats"
check "career goals total"       "SELECT sum(goals) FROM player_career_stats"
check "Brownlow votes total"     "SELECT sum(votes) FROM brownlow_season_votes"
check "unrecorded disposals"     "SELECT count(*) FROM player_match_stats WHERE disposals IS NULL"
check "stat_availability rows"   "SELECT count(*) FROM stat_availability"

if [[ $FAILED -eq 0 ]]; then
  # set -e: if the binding cannot be recorded the script fails here, never "proven" without it.
  # AFLDB-ISSUE-341: the marker is written in the same session that re-proves the target.
  {
    identity_guard_sql
    printf "COMMENT ON DATABASE %s IS 'afldb.restore_test.v1 sha256=%s';\n" "$RESTORE_DB" "$BACKUP_SHA256"
  } | psql_x -q "$RESTORE_DSN"
  echo "    recorded restored dump sha256 ${BACKUP_SHA256}"
  echo "==> Restore verified: the backup is proven."
else
  echo "==> RESTORE VERIFICATION FAILED: ${FAILED} check(s) differ." >&2
  exit 1
fi
