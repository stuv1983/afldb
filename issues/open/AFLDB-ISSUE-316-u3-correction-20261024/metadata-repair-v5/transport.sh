# v5 database transport: existing protected credential, pinned principal, no sudo.
# Appended after operational-host.sh in the same remote `bash -c` script; run.cjs adds the single
# call line with the pinned production arguments. Reads one existing DSN from the arm-only .env,
# refuses unless it names exactly the pinned principal/endpoint, clears the inherited environment
# and execs psql with the password only in PGPASSWORD: never argv, never printed, never retained.
# Reads nothing from stdin itself: psql's stdin is the reviewed SQL.
i316_transport() {
  set +x
  tstop() { printf 'I316_TRANSPORT_STOP %s\n' "$1"; exit 1; }
  [ "$#" -eq 7 ] || tstop argument_count
  local mode=$1 envf=$2 key=$3 euser=$4 ehost=$5 eport=$6 edb=$7
  local n st dsn re u h p d pwenc pw v keep options remaining
  case "$mode" in prerequisite|execute) ;; *) tstop mode_invalid;; esac
  { [ -f "$envf" ] && [ ! -L "$envf" ]; } || tstop credential_file_missing
  [ -r "$envf" ] || tstop credential_file_unreadable
  st=$(/usr/bin/stat -c '%a %U' -- "$envf" </dev/null) || tstop credential_file_stat_failed
  [ "$st" = "600 $(/usr/bin/id -un </dev/null)" ] || tstop credential_file_permissions
  n=$(/usr/bin/grep -c -- "^${key}=" "$envf" </dev/null) || n=0
  [ "$n" = 1 ] || tstop credential_key_count
  dsn=$(/usr/bin/sed -n "s/^${key}=//p" "$envf" </dev/null) || tstop credential_read_failed
  case "$dsn" in *$'\r'*|*\\*) dsn=; tstop credential_shape_refused;; esac
  case "$dsn" in \"*\") dsn=${dsn#\"}; dsn=${dsn%\"};; esac
  re='^postgres(ql)?://([^:@/?#]+):([^@/?#]+)@([^/:?#]+):([0-9]+)/([^/?#]+)$'
  if ! [[ $dsn =~ $re ]]; then dsn=; tstop credential_shape_refused; fi
  u=${BASH_REMATCH[2]} pwenc=${BASH_REMATCH[3]} h=${BASH_REMATCH[4]} p=${BASH_REMATCH[5]} d=${BASH_REMATCH[6]}
  dsn=; [[ x =~ x ]]
  if [ "$u" != "$euser" ] || [ "$h" != "$ehost" ] || [ "$p" != "$eport" ] || [ "$d" != "$edb" ]; then
    pwenc=; tstop credential_principal_mismatch
  fi
  printf -v pw '%b' "${pwenc//%/\\x}"; pwenc=
  [ -n "$pw" ] || tstop credential_password_empty
  options='-c statement_timeout=600000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000'
  [ "$mode" = execute ] || options="$options -c default_transaction_read_only=on"
  keep=$HOME
  # Only the allowlist below reaches psql: no application DSN, service file or inherited PG* setting.
  while IFS= read -r v; do unset "$v" 2>/dev/null || tstop environment_clear_failed; done < <(compgen -e)
  export PATH=/usr/bin:/bin HOME="$keep" LC_ALL=C PGHOST="$h" PGPORT="$p" PGUSER="$u" PGDATABASE="$d" \
    PGAPPNAME="afldb-i316-metadata-repair-v5-$mode" PGOPTIONS="$options" PGCONNECT_TIMEOUT=10
  export PGPASSWORD="$pw"; pw=
  remaining=$(compgen -e | /usr/bin/sort | /usr/bin/tr '\n' ' ')
  [ "$remaining" = "HOME LC_ALL PATH PGAPPNAME PGCONNECT_TIMEOUT PGDATABASE PGHOST PGOPTIONS PGPASSWORD PGPORT PGUSER " ] \
    || { unset PGPASSWORD; tstop environment_not_cleared; }
  printf 'I316_TRANSPORT_PREREQUISITES_PASS mode=%s user=%s host=%s port=%s database=%s\n' "$mode" "$u" "$h" "$p" "$d"
  exec /usr/bin/psql -X -qAt -P pager=off -v ON_ERROR_STOP=1 -f -
}
