#!/bin/bash
# AFLDB-ISSUE-316: owner-authorised U3 correction precondition gate, 2026-10-24.
# Streamed through ssh; no remote files or canonical changes. No census or Brownlow table reads.
set -eu -o pipefail
R=/home/arm/projects/afldb
[ "$(hostname)" = afldb-prod ] || { echo "STOP: unexpected host"; exit 3; }
ENVF="$R/.env"
[ -r "$ENVF" ] || { echo "BLOCKED: env file unreadable"; exit 2; }
DSN=$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' "$ENVF" | tail -1 | sed 's/^"\(.*\)"$/\1/')
[ -n "$DSN" ] || { echo "BLOCKED: AFLDB_BACKUP_DATABASE_URL empty"; exit 2; }
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
PGUSER=$(printf '%s' "$DSN" | sed -E "s#$RE#\2#")
PGHOST=$(printf '%s' "$DSN" | sed -E "s#$RE#\5#")
PGPORT=$(printf '%s' "$DSN" | sed -E "s#$RE#\7#"); [ -n "$PGPORT" ] || PGPORT=5432
PGDATABASE=$(printf '%s' "$DSN" | sed -E "s#$RE#\8#")
PWENC=$(printf '%s' "$DSN" | sed -E "s#$RE#\4#")
PGPASSWORD=$(printf '%b' "${PWENC//%/\\x}"); unset PWENC DSN
echo "dsn_identity user=$PGUSER host=$PGHOST port=$PGPORT database=$PGDATABASE"
[ "$PGDATABASE" = afldb_prod ] && [ "$PGUSER" = afldb_backup ] || { unset PGPASSWORD; echo "BLOCKED: credential is not afldb_backup@afldb_prod"; exit 2; }
export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000'
export PGAPPNAME=afldb-i316-u3-correction-precheck PGCONNECT_TIMEOUT=10


sed -n '1,375p' "$R/src/db/queries/player-derived.ts"
