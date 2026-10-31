{
# AFLDB V2 release: host session script for afldb-prod (D-V2-PROD-EXEC-1 package, P-1).
# Derived from current-production-shadow/capture-prod.sh (P0-P4 identity block, credential channel), the
# cutover runbook steps 1-2 and 8, and HC-3. Streamed from Windows, never copied to the host:
#   cmd /c "ssh -o BatchMode=yes afldb bash -s -- <stage> <STAMP> [args] < host-session.sh > <stage>.log 2>&1"
# Stages (each re-checks identity first and writes only inside D=/home/arm/backups/afldb/release-v2-<STAMP>):
#   identity <STAMP> 110|117 [ledger117_digest]   read only (backup and owner principals)
#   writers  <STAMP>                               read only: scheduler loop, processes, sessions per role
#   retired  <STAMP>                               read only: after A-AFLT no afldb writer timer is enabled or active
#   init     <STAMP>                               creates D and D/pinned (mode 700); nothing else
#   pinned   <STAMP>                               verifies the copies the transfer placed in D/pinned
#   backup   <STAMP> frozen|postschema [ledger117_digest] HC-3: backup.sh --dir D --keep 999, then checks
#   restore-test <STAMP>                           HC-5 on the frozen dump (afldb_restore_test only)
#   manifest <STAMP> before|after [ledger117_digest] sealed-history manifest (read-only source); after compares
#   arel     <STAMP> <ledger117_digest> <frozen_archive_sha256>  A-REL: 111-117, privileges.sql, the two defaults, read-back
#   readback <STAMP> <ledger117_digest>            permission-readback.sql as afldb_backup -> D/P.permissions.txt
# Credentials: parsed from .env into libpq variables of the child that needs them, never argv, never printed.
# Sourced (not executed) the file only defines its functions, so the parsing can be exercised off-production.
set -u -o pipefail
export LC_ALL=C
umask 077
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD; echo "STOP: $1"; exit "${2:-1}"; }

hs_config() {
  EXPECT_HOST=afldb-prod; EXPECT_USER=arm
  R=/home/arm/projects/afldb
  BACKUPS=/home/arm/backups/afldb
  PGBIN=/usr/lib/postgresql/16/bin
  NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
  EXPECT_SYSID=7674454702926115004; EXPECT_OID=66668; EXPECT_DB=afldb_prod
  EXPECT_DSN_HOST=localhost; EXPECT_DSN_PORT=5432
  EXPECT_EXT='pg_trgm=1.6 plpgsql=1.0 unaccent=1.1'
  LEDGER110_LAST=110_match_sheet_player_match_stats_authority.sql
  LEDGER110_DIGEST=789946fe734b23c32ec87e59e3b860877d31a4b32b561624bf1d88fb8f055153
  LEDGER117_LAST=117_brownlow_provider_eligibility_unknown.sql
  REVIEWED_COMMIT=9ed9c9dd3e84682c43e96c46e98974b245eb54ed
  # The files the transfer places in D/pinned (package P-5): two read-only SQL files and the A-GO artifact
  # manifest tool; re-verified before every use.
  PIN_PERMISSION_READBACK=1e7a4f625069cba913194a6aff736236be52eae4d16892e45087564abcc62e43
  PIN_AREL_READBACK=c195fab894420ca951562eb55290b6d984623e73de32e41b347fd34331a3e5c9
  PIN_ARTIFACT_MANIFEST=ea37a7e70087185c88815be39cb952e94bde2be624d6b848c6a2ca2324055b10
  DEFAULT_IMPORT='ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO afldb_import;'
  DEFAULT_APP='ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging GRANT SELECT ON TABLES TO afldb_app;'
  WRITER_UNITS='afldb-settle-afltables.service afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service afldb-email-intake.service'
  RETIRED_TIMERS='afldb-settle-afltables.timer afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer afldb-email-intake.timer'
  ALL_UNITS='afldb.service afldb-settle-afltables.service afldb-settle-afltables.timer afldb-settle-afl-api.service afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer afldb-email-intake.service afldb-email-intake.timer'
}

# P0: host, user and tools.
hs_host() {
  [ "$(hostname)" = "$EXPECT_HOST" ] || stop "unexpected host $(hostname)" 3
  [ "$(id -un)" = "$EXPECT_USER" ] || stop "unexpected user $(id -un)" 3
  for x in pg_dump pg_restore psql; do [ -x "$PGBIN/$x" ] || stop "missing $PGBIN/$x" 3; done
  command -v sha256sum >/dev/null && [ -x "$NODE" ] || stop "missing sha256sum/node" 3
}

# P3: one DSN key from .env into PG* variables (values never printed). $1 = key, $2 = the required role.
# Sets PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD (not exported) and HS_DSN (the unmodified value).
hs_parse_dsn() {
  local key=$1 role=$2 envf="$R/.env" line pwenc
  [ -r "$envf" ] || stop "env file unreadable" 2
  [ "$(grep -c "^$key=" "$envf")" = 1 ] || stop "$key must appear exactly once in .env" 2
  line=$(sed -n "s/^$key=//p" "$envf" | sed 's/^"\(.*\)"$/\1/')
  [ -n "$line" ] || stop "$key empty" 2
  local re='^(postgres|postgresql)://([^:@/]+):([^@]*)@([^/:?]+)(:([0-9]+))?/([^?/]+)$'
  # Match first: an unparseable value must never reach a variable that is printed (capture-prod review LOW-1).
  [[ "$line" =~ $re ]] || { unset line; stop "$key has an unexpected form (value not printed)" 2; }
  PGUSER=${BASH_REMATCH[2]}; pwenc=${BASH_REMATCH[3]}; PGHOST=${BASH_REMATCH[4]}; PGPORT=${BASH_REMATCH[6]:-5432}; PGDATABASE=${BASH_REMATCH[7]}
  # How tools/db/migrate.ts safeTarget() prints this DSN: user@host:<port as written>/database.
  HS_SAFE_TARGET="$PGUSER@$PGHOST:${BASH_REMATCH[6]}/$PGDATABASE"
  [ -n "$pwenc" ] || stop "$key has no password (value not printed)" 2
  # "\%": an unescaped leading % would anchor the pattern at the end and leave escapes undecoded.
  PGPASSWORD=$(printf '%b' "${pwenc//\%/\\x}"); HS_DSN=$line; unset pwenc line BASH_REMATCH
  echo "dsn_identity key=$key user=$PGUSER host=$PGHOST port=$PGPORT database=$PGDATABASE"
  [ "$PGUSER" = "$role" ] && [ "$PGDATABASE" = "$EXPECT_DB" ] && [ "$PGHOST" = "$EXPECT_DSN_HOST" ] && [ "$PGPORT" = "$EXPECT_DSN_PORT" ] \
    || stop "$key is not $role@$EXPECT_DSN_HOST:$EXPECT_DSN_PORT/$EXPECT_DB" 2
}

RO='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000'
# Read-only query as the parsed principal; the libpq variables exist only in this child's environment.
q() {
  PGUSER=$PGUSER PGHOST=$PGHOST PGPORT=$PGPORT PGDATABASE=$PGDATABASE PGPASSWORD=$PGPASSWORD PGCONNECT_TIMEOUT=10 \
    PGOPTIONS="$RO" PGAPPNAME=afldb-v2-release-session "$PGBIN/psql" -X -q -At -F "$(printf '\t')" -P pager=off -v ON_ERROR_STOP=1 "$@"
}
ledger() { q -c "SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE \"C\""; }

# P4: identity, extensions and the ledger as afldb_backup in a read-only session. $1 = 110 | 117, $2 = 117 digest.
hs_identity() {
  local want=$1 digest117=${2:-} ident
  hs_parse_dsn AFLDB_BACKUP_DATABASE_URL afldb_backup
  ident=$(q -c "SELECT current_database(), current_user, (SELECT oid FROM pg_database WHERE datname=current_database()),
 (SELECT system_identifier::text FROM pg_control_system()), current_setting('server_version_num'), current_setting('transaction_read_only'),
 (SELECT rolsuper FROM pg_roles WHERE rolname=current_user), pg_has_role(current_user,'pg_read_all_data','member'),
 (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()), current_setting('server_version')") || stop "identity query failed" 5
  echo "identity $ident"
  IFS=$'\t' read -r I_DB I_USER I_OID I_SYSID I_VNUM I_RO I_SUPER I_READALL I_OWNER I_VER <<< "$ident"
  [ "$I_DB" = "$EXPECT_DB" ] && [ "$I_USER" = afldb_backup ] && [ "$I_OID" = "$EXPECT_OID" ] && [ "$I_SYSID" = "$EXPECT_SYSID" ] \
    && [ "$I_RO" = on ] && [ "$I_SUPER" = f ] && [ "$I_READALL" = t ] && [ "$I_OWNER" = afldb_owner ] \
    && [ "$I_VNUM" -ge 160000 ] && [ "$I_VNUM" -lt 170000 ] || stop "identity differs from the reviewed target" 5
  EXT=$(q -c "SELECT string_agg(extname||'='||extversion, ' ' ORDER BY extname) FROM pg_extension") || stop "extension query failed" 5
  echo "extensions $EXT"; [ "$EXT" = "$EXPECT_EXT" ] || stop "extension set/versions differ" 5
  hs_ledger_is "$want" "$digest117"
}

# The ledger is exactly 110 with the reviewed digest, or exactly 117 extending it with the rehearsed digest.
hs_ledger_is() {
  local want=$1 digest117=${2:-} rows last dig first110
  LEDGER=$(ledger) || stop "ledger query failed" 5
  rows=$(printf '%s\n' "$LEDGER" | wc -l); last=$(printf '%s\n' "$LEDGER" | tail -1 | cut -f1)
  dig=$(printf '%s\n' "$LEDGER" | sha256sum | cut -c1-64); first110=$(printf '%s\n' "$LEDGER" | head -110 | sha256sum | cut -c1-64)
  LEDGER_DIGEST=$dig
  echo "ledger rows=$rows last=$last digest=$dig"
  case "$want" in
    110) [ "$rows" = 110 ] && [ "$last" = "$LEDGER110_LAST" ] && [ "$dig" = "$LEDGER110_DIGEST" ] || stop "ledger is not the reviewed 110 baseline" 5 ;;
    117) [[ "$digest117" =~ ^[0-9a-f]{64}$ ]] || stop "the rehearsed 117 ledger digest is required" 2
         [ "$rows" = 117 ] && [ "$last" = "$LEDGER117_LAST" ] && [ "$first110" = "$LEDGER110_DIGEST" ] && [ "$dig" = "$digest117" ] \
           || stop "ledger is not the rehearsed 117 state" 5 ;;
    *) stop "ledger expectation must be 110 or 117" 2 ;;
  esac
}

hs_no_writer_running() {
  local u out x
  for u in $WRITER_UNITS; do
    case "$(systemctl is-active "$u" 2>/dev/null)" in active|activating|reloading) stop "writer $u is running" 4;; esac
  done
  # Match the script basename in the arguments, never `ps -o comm` (truncated; dev-ssh-access-quirks).
  # pgrep: 0 = a match, 1 = none, anything else = it could not tell, which is never "nothing running".
  out=$(pgrep -af 'settle-afltables|settle-afl-api|acquire-afl-api|tools/db/migrate\.ts|backup\.sh|restore-test\.sh|pg_dump|pg_restore'); x=$?
  [ "$x" -le 1 ] || stop "process check failed (pgrep exit $x)" 4
  if [ "$x" = 0 ]; then printf '%s\n' "$out"; stop "a settle, migration, dump or restore process is running" 4; fi
  echo "no settle/migrate/dump/restore process"
}

# After A-AFLT (Stage 1): no afldb writer timer, AFL API ones included, may be enabled or active for the window.
hs_writers_retired() {
  local u e a
  for u in $RETIRED_TIMERS; do
    e=$(systemctl is-enabled "$u" 2>/dev/null); a=$(systemctl is-active "$u" 2>/dev/null)
    echo "timer $u enabled=${e:-absent} active=${a:-absent}"
    case "$e" in enabled|enabled-runtime|linked|linked-runtime|alias) stop "writer timer $u is $e" 4;; esac
    case "$a" in active|activating|reloading) stop "writer timer $u is $a" 4;; esac
  done
}

# The owner DSN (the A-REL principal) reaches the same reviewed database; read-only session.
hs_owner_identity() {
  local ident o_db o_user o_oid o_sys
  hs_parse_dsn AFLDB_OWNER_DATABASE_URL afldb_owner
  ident=$(q -c "SELECT current_database(), current_user, (SELECT oid FROM pg_database WHERE datname=current_database()),
 (SELECT system_identifier::text FROM pg_control_system())") || stop "owner identity query failed" 5
  IFS=$'\t' read -r o_db o_user o_oid o_sys <<< "$ident"
  echo "owner_identity $o_db $o_user $o_oid $o_sys"
  [ "$o_db" = "$EXPECT_DB" ] && [ "$o_user" = afldb_owner ] && [ "$o_oid" = "$EXPECT_OID" ] && [ "$o_sys" = "$EXPECT_SYSID" ] \
    || stop "the owner DSN does not reach the reviewed target" 5
}

hs_writers() {
  local u
  for u in $ALL_UNITS; do printf 'unit %s active=%s enabled=%s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null)" "$(systemctl is-enabled "$u" 2>/dev/null)"; done
  systemctl list-timers --all --no-pager 2>/dev/null | grep -i afldb | sed 's/^/timer /' || echo "timer none matching afldb"
  hs_no_writer_running
  q -c "SELECT 'sessions', coalesce(usename::text,'?'), count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY 2 ORDER BY 2" \
    | sed 's/^/activity /' || stop "activity query failed" 5
  q -c "SELECT 'access_exclusive_relation_locks', count(*) FROM pg_locks l JOIN pg_database d ON d.oid=l.database WHERE d.datname=current_database() AND l.locktype='relation' AND l.mode='AccessExclusiveLock'" \
    | sed 's/^/activity /' || stop "lock query failed" 5
}

hs_dir() { D="$BACKUPS/release-v2-$STAMP"; [ -d "$D" ] || stop "release directory $D does not exist (run init)" 6; }

hs_checkout_reviewed() {
  local head dirty
  head=$(GIT_OPTIONAL_LOCKS=0 git -C "$R" rev-parse HEAD 2>/dev/null) || stop "checkout unreadable" 6
  dirty=$(GIT_OPTIONAL_LOCKS=0 git -C "$R" status --porcelain 2>/dev/null) || stop "git status failed" 6
  echo "checkout HEAD=$head porcelain_lines=$(printf '%s' "$dirty" | grep -c .)"
  [ "$head" = "$REVIEWED_COMMIT" ] && [ -z "$dirty" ] || stop "checkout is not the clean reviewed $REVIEWED_COMMIT" 6
}

hs_series_count() { find "$BACKUPS" -maxdepth 1 -type f -name "$EXPECT_DB-*.dump" | wc -l; }

hs_pinned_ok() {  # the copies the transfer placed in D/pinned equal the hashes pinned in this script
  [[ "$PIN_PERMISSION_READBACK$PIN_AREL_READBACK$PIN_ARTIFACT_MANIFEST" =~ ^[0-9a-f]{192}$ ]] || stop "the pinned hashes in this script are not filled in" 2
  [ "$(sha256sum < "$D/pinned/permission-readback.sql" | cut -c1-64)" = "$PIN_PERMISSION_READBACK" ] \
    && [ "$(sha256sum < "$D/pinned/arel-readback.sql" | cut -c1-64)" = "$PIN_AREL_READBACK" ] \
    && [ "$(sha256sum < "$D/pinned/artifact-manifest.mjs" | cut -c1-64)" = "$PIN_ARTIFACT_MANIFEST" ] || stop "a pinned copy in $D/pinned differs from its pinned hash" 6
}

hs_backup() {
  local label=$1 digest117=${2:-} before after n0 n1 new dump sha bytes toc base start end
  case "$label" in frozen) hs_identity 110;; postschema) hs_identity 117 "$digest117";; *) stop "backup label must be frozen or postschema" 2;; esac
  unset PGPASSWORD
  hs_no_writer_running; hs_writers_retired
  hs_dir
  [ ! -e "$D/$label.SHA256SUMS" ] || stop "a $label backup already exists in $D" 6
  n0=$(hs_series_count); before=$(cd "$D" && ls "$EXPECT_DB"-*.dump 2>/dev/null | sort)
  hs_parse_dsn AFLDB_BACKUP_DATABASE_URL afldb_backup
  L=$(ledger) || stop "ledger before failed" 7; printf '%s\n' "$L" > "$D/$label.ledger-before.tsv"
  unset PGPASSWORD
  start=$(date -u +%FT%T.%6NZ)
  # backup.sh reads AFLDB_BACKUP_DATABASE_URL from the checkout's .env itself (HC-3, the established procedure).
  ( for k in $(env | grep -oE '^(PG[A-Z_]*|[A-Z_]*DATABASE_URL[A-Z_]*)=' | tr -d =); do unset "$k"; done
    bash "$R/tools/maintenance/backup.sh" --dir "$D" --keep 999 ) > "$D/$label.backup.log" 2>&1
  local x=$?; end=$(date -u +%FT%T.%6NZ)
  cat "$D/$label.backup.log"
  [ "$x" = 0 ] || stop "backup.sh exited $x; log retained in $D" 7
  n1=$(hs_series_count); after=$(cd "$D" && ls "$EXPECT_DB"-*.dump 2>/dev/null | sort)
  new=$(comm -13 <(printf '%s\n' "$before" | sed '/^$/d') <(printf '%s\n' "$after"))
  echo "series_count before=$n0 after=$n1; new dumps in $D: [$new]"
  [ "$n0" = "$n1" ] || stop "the existing backup series changed ($n0 -> $n1)" 7
  [ "$(printf '%s\n' "$new" | grep -c .)" = 1 ] || stop "expected exactly one new dump in $D" 7
  dump=$new; base=${dump%.dump}
  ls "$D"/*.partial >/dev/null 2>&1 && stop "a .partial archive remains in $D" 7
  "$PGBIN/pg_restore" --list "$D/$dump" > "$D/$label.toc" || stop "pg_restore --list failed" 7
  toc=$(grep -cv '^;' "$D/$label.toc")
  hs_parse_dsn AFLDB_BACKUP_DATABASE_URL afldb_backup
  L=$(ledger) || stop "ledger after failed" 7; printf '%s\n' "$L" > "$D/$label.ledger-after.tsv"
  STAGED=$(q -c "SELECT coalesce(string_agg(season::text||':'||c::text, ' ' ORDER BY season), 'none') FROM (SELECT season, count(*) c FROM staging.afl_api_brownlow_vote GROUP BY season) s") || stop "staged query failed" 7
  unset PGPASSWORD
  cmp -s "$D/$label.ledger-before.tsv" "$D/$label.ledger-after.tsv" || stop "ledger changed during the backup; dump retained, not usable" 7
  sha=$(sha256sum "$D/$dump" | cut -c1-64); bytes=$(stat -c %s "$D/$dump")
  export HS_LABEL=$label HS_STAMP=$STAMP HS_DUMP=$dump HS_SHA=$sha HS_BYTES=$bytes HS_TOC=$toc HS_START=$start HS_END=$end \
    HS_DIGEST=$LEDGER_DIGEST HS_STAGED=$STAGED HS_N=$n0 HS_D=$D HS_HEAD="$(GIT_OPTIONAL_LOCKS=0 git -C "$R" rev-parse HEAD)" \
    HS_BACKUP_SH="$(sha256sum < "$R/tools/maintenance/backup.sh" | cut -c1-64)" HS_IDENT="$I_DB $I_OID $I_SYSID $I_OWNER $I_VER"
  "$NODE" -e '
const fs = require("node:fs"); const e = process.env;
const ledger = fs.readFileSync(`${e.HS_D}/${e.HS_LABEL}.ledger-before.tsv`, "utf8").trimEnd().split("\n").map((l) => { const [name, checksum] = l.split("\t"); return { name, checksum }; });
const s = { format: "afldb.v2.release-backup.1", decision: "D-V2-PROD-EXEC-1", label: e.HS_LABEL, stamp: e.HS_STAMP,
  source_identity: e.HS_IDENT, checkout_revision: e.HS_HEAD, backup_sh_sha256: e.HS_BACKUP_SH,
  procedure: "tools/maintenance/backup.sh --dir <release dir> --keep 999 (pg_dump -Fc --compress=6 --no-owner; owners and ACLs are in the archive)",
  dump_start_utc: e.HS_START, dump_end_utc: e.HS_END, archive: e.HS_DUMP, archive_bytes: Number(e.HS_BYTES), archive_sha256: e.HS_SHA,
  archive_toc_entries: Number(e.HS_TOC), observed_ledger: ledger, observed_ledger_digest: e.HS_DIGEST, ledger_unchanged_across_dump: true,
  staged_brownlow_seasons: e.HS_STAGED, existing_series_count: Number(e.HS_N), existing_series_unchanged: true };
fs.writeFileSync(`${e.HS_D}/${e.HS_DUMP.replace(/\.dump$/, "")}.release.json`, JSON.stringify(s, null, 2) + "\n", { flag: "wx", mode: 0o600 });
' || stop "sidecar write failed; dump retained" 8
  ( cd "$D" && sha256sum "$dump" "$base.release.json" "$label.toc" "$label.ledger-before.tsv" "$label.ledger-after.tsv" "$label.backup.log" > "$label.SHA256SUMS" && chmod 600 ./*.* ) \
    || stop "manifest failed" 8
  cat "$D/$label.SHA256SUMS"
  echo "RESULT PASS stage=backup label=$label archive=$dump sha256=$sha bytes=$bytes toc=$toc staged_brownlow=$STAGED"
}

hs_restore_test() {
  local dump x
  hs_identity 110; unset PGPASSWORD
  hs_dir
  dump=$(sed -n "s/^\([0-9a-f]\{64\}\)  \($EXPECT_DB-.*\.dump\)\$/\2/p" "$D/frozen.SHA256SUMS")
  [ -n "$dump" ] || stop "no frozen dump recorded in $D/frozen.SHA256SUMS" 6
  ( cd "$D" && grep " $dump\$" frozen.SHA256SUMS | sha256sum --check --strict - ) || stop "frozen dump hash differs" 6
  ( for k in $(env | grep -oE '^(PG[A-Z_]*|[A-Z_]*DATABASE_URL[A-Z_]*)=' | tr -d =); do unset "$k"; done
    bash "$R/tools/maintenance/restore-test.sh" "$D/$dump" ) > "$D/restore-test.log" 2>&1
  x=$?; cat "$D/restore-test.log"
  [ "$x" = 0 ] || stop "restore-test.sh exited $x" 7
  sha256sum "$D/restore-test.log" > "$D/restore-test.SHA256SUMS"
  echo "RESULT PASS stage=restore-test dump=$dump"
}

hs_manifest() {
  local which=$1 digest117=${2:-} x
  case "$which" in before) hs_identity 110;; after) hs_identity 117 "$digest117";; *) stop "manifest must be before or after" 2;; esac
  hs_dir; [ ! -e "$D/manifest-$which.json" ] || stop "manifest-$which.json exists" 6
  # The producer reads only the variable named by --dsn-env (rollback runbook §2 step 4); set for this child only.
  ( cd "$R" && AFLDB_V2_RELEASE_READONLY_URL=$HS_DSN "$NODE" --import tsx tools/v2/historical-manifest.ts produce \
      --dsn-env AFLDB_V2_RELEASE_READONLY_URL --out "$D/manifest-$which.json" --read-only-source --i-understand-this-reads-a-non-test-database )
  x=$?; unset PGPASSWORD HS_DSN
  [ "$x" = 0 ] && [ -s "$D/manifest-$which.json" ] || stop "manifest produce exited $x" 7
  sha256sum "$D/manifest-$which.json"
  if [ "$which" = after ]; then
    ( cd "$R" && "$NODE" --import tsx tools/v2/historical-manifest.ts compare "$D/manifest-before.json" "$D/manifest-after.json" --out "$D/manifest-compare.json" )
    x=$?; echo "gate M compare exit=$x"
    [ "$x" = 0 ] || stop "gate M: sealed scope is not identical (exit $x); report in $D/manifest-compare.json" 9
  fi
  echo "RESULT PASS stage=manifest which=$which"
}

hs_arel() {
  local digest117=$1 frozen_sha=${2:-} x pending prod_url want_target
  [[ "$digest117" =~ ^[0-9a-f]{64}$ ]] || stop "arel needs the rehearsed 117 ledger digest" 2
  [[ "$frozen_sha" =~ ^[0-9a-f]{64}$ ]] || stop "arel needs the sha256 of the frozen archive the rehearsal passed on" 2
  hs_identity 110; unset PGPASSWORD
  hs_owner_identity; unset PGPASSWORD
  hs_no_writer_running; hs_writers_retired; hs_checkout_reviewed; hs_dir; hs_pinned_ok
  [ -e "$D/frozen.SHA256SUMS" ] && [ -e "$D/restore-test.SHA256SUMS" ] || stop "the frozen backup and its restore proof must precede A-REL" 6
  grep -Eq "^$frozen_sha  [^ /]+\.dump\$" "$D/frozen.SHA256SUMS" || stop "the rehearsed archive is not this release directory's frozen dump" 6
  # No retry once migrate has reached the database; an attempt refused before connecting is kept and may rerun.
  if [ -e "$D/arel.migrate.log" ]; then
    grep -q '^AFLDB migrations -> prod ' "$D/arel.migrate.log" && stop "A-REL already reached the database in this release directory; no retry in the session" 6
    mv "$D/arel.migrate.log" "$D/arel.migrate.preconnect-$(date -u +%H%M%S).log" || stop "cannot set the pre-connect log aside" 6
  fi
  # AFLDB_PROD_DATABASE_URL is not kept in the host .env (docs/deployment.md). The migrate child alone receives the
  # identity-checked owner DSN in its environment (never argv), and its own target line must name that principal.
  hs_parse_dsn AFLDB_OWNER_DATABASE_URL afldb_owner; prod_url=$HS_DSN; want_target=$HS_SAFE_TARGET; unset PGPASSWORD HS_DSN
  mig() { ( cd "$R" && AFLDB_PROD_DATABASE_URL=$prod_url "$NODE" --import tsx tools/db/migrate.ts --target prod "$@" ); }
  mig --status > "$D/arel.status-before.txt" 2>&1 || { cat "$D/arel.status-before.txt"; stop "migrate --status failed" 7; }
  grep -qxF "AFLDB migrations -> prod ($want_target)" "$D/arel.status-before.txt" || { cat "$D/arel.status-before.txt"; stop "migrate did not resolve the identity-checked owner target" 7; }
  pending=$(grep -oE 'PENDING  [0-9]{3}_[A-Za-z0-9_]+\.sql' "$D/arel.status-before.txt" | awk '{print $2}' | paste -sd' ')
  echo "pending: $pending"
  [ "$pending" = "111_curated_award_proposals.sql 112_derived_award_results.sql 113_brownlow_eligibility_decisions.sql 114_award_projections_and_curated_revisions.sql 115_adjudication_supersession_fk_index.sql 116_brownlow_correction_receipts.sql 117_brownlow_provider_eligibility_unknown.sql" ] \
    || stop "pending set is not exactly 111..117; nothing applied" 7
  mig > "$D/arel.migrate.log" 2>&1
  x=$?; cat "$D/arel.migrate.log"
  [ "$x" = 0 ] || stop "migrate exited $x: STOP, keep the log, re-read the ledger; no retry (package §6 row 2)" 7
  mig --status > "$D/arel.status-after.txt" 2>&1 || stop "migrate --status after failed" 7
  unset prod_url
  grep -qxF "AFLDB migrations -> prod ($want_target)" "$D/arel.status-after.txt" && grep -qx '0 pending.' "$D/arel.status-after.txt" || stop "pending migrations remain" 7
  hs_parse_dsn AFLDB_BACKUP_DATABASE_URL afldb_backup; hs_ledger_is 117 "$digest117"; unset PGPASSWORD
  hs_parse_dsn AFLDB_OWNER_DATABASE_URL afldb_owner
  owner_psql() { ( cd "$R" && PGUSER=$PGUSER PGHOST=$PGHOST PGPORT=$PGPORT PGDATABASE=$PGDATABASE PGPASSWORD=$PGPASSWORD PGAPPNAME=afldb-v2-release-arel \
                   "$PGBIN/psql" -X -w -v ON_ERROR_STOP=1 "$@" ); }
  owner_psql -f tools/maintenance/privileges.sql > "$D/arel.privileges.log" 2>&1; x=$?
  [ "$x" = 0 ] || { unset PGPASSWORD; cat "$D/arel.privileges.log"; stop "privileges.sql exited $x: stop before A-GO, fix forward (package §6 row 3)" 7; }
  owner_psql -c "$DEFAULT_IMPORT" > "$D/arel.default-import.log" 2>&1 || { unset PGPASSWORD; stop "D-V2-STAGING-IMPORT-DEFAULT-1 failed" 7; }
  owner_psql -c "$DEFAULT_APP" > "$D/arel.default-app.log" 2>&1 || { unset PGPASSWORD; stop "D-V2-STAGING-APP-DEFAULT-1 failed" 7; }
  unset PGPASSWORD
  hs_parse_dsn AFLDB_BACKUP_DATABASE_URL afldb_backup
  hs_pinned_ok; q -f "$D/pinned/arel-readback.sql" > "$D/arel.readback.txt" || stop "A-REL read-back failed" 7
  unset PGPASSWORD; cat "$D/arel.readback.txt"
  [ "$(grep -c '|ok$' "$D/arel.readback.txt")" = 12 ] && [ "$(wc -l < "$D/arel.readback.txt")" = 12 ] || stop "A-REL read-back is not 12/12 ok" 7
  ( cd "$D" && sha256sum arel.* > arel.SHA256SUMS )
  echo "RESULT PASS stage=arel ledger_digest=$digest117"
}

hs_readback() {
  hs_identity 117 "$1"
  hs_dir; [ ! -e "$D/P.permissions.txt" ] || stop "P.permissions.txt exists" 6
  hs_pinned_ok; q -f "$D/pinned/permission-readback.sql" > "$D/P.permissions.txt"; local x=$?; unset PGPASSWORD
  [ "$x" = 0 ] && [ -s "$D/P.permissions.txt" ] || stop "read-back exited $x" 7
  grep -q '^I|transaction_read_only|on$' "$D/P.permissions.txt" || stop "read-back did not run read only" 7
  sha256sum "$D/P.permissions.txt" | tee "$D/readback.SHA256SUMS"
  echo "RESULT PASS stage=readback lines=$(wc -l < "$D/P.permissions.txt")"
}

if [[ "${BASH_SOURCE[0]:-$0}" != "$0" ]]; then return 0 2>/dev/null; fi

hs_config
STAGE_NAME=${1:-}; STAMP=${2:-}; HS_ARG1=${3:-}; HS_ARG2=${4:-}
[[ "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || stop "usage: <stage> <STAMP YYYYmmddTHHMMSSZ> [args]" 2
step "D-V2-PROD-EXEC-1 host session stage=$STAGE_NAME stamp=$STAMP"
hs_host
echo "host=$(hostname) user=$(id -un) boot_id=$(cat /proc/sys/kernel/random/boot_id) checkout=$(GIT_OPTIONAL_LOCKS=0 git -C "$R" rev-parse HEAD 2>/dev/null) build=$(cat "$R/.next/BUILD_ID" 2>/dev/null)"
case "$STAGE_NAME" in
  identity) hs_identity "$HS_ARG1" "$HS_ARG2"; unset PGPASSWORD; hs_owner_identity; unset PGPASSWORD; hs_no_writer_running
            echo "RESULT PASS stage=identity ledger=$HS_ARG1" ;;
  retired) hs_writers_retired; hs_no_writer_running; echo "RESULT PASS stage=retired" ;;
  writers) hs_parse_dsn AFLDB_BACKUP_DATABASE_URL afldb_backup; hs_ledger_is "${HS_ARG1:-110}" "$HS_ARG2"; hs_writers; unset PGPASSWORD; echo "RESULT PASS stage=writers" ;;
  init) hs_identity 110; unset PGPASSWORD; D="$BACKUPS/release-v2-$STAMP"; [ ! -e "$D" ] || stop "$D already exists" 6
        AV=$(df --output=avail -B1 /home/arm | tail -1 | tr -d ' '); echo "home_avail_bytes=$AV"; [ "$AV" -ge 2147483648 ] || stop "less than 2 GiB free under /home/arm" 4
        mkdir -p -m 700 "$BACKUPS" && mkdir -m 700 "$D" "$D/pinned" || stop "cannot create $D" 6; echo "RESULT PASS stage=init dir=$D" ;;
  pinned) hs_dir; hs_pinned_ok; echo "RESULT PASS stage=pinned" ;;
  backup) hs_backup "$HS_ARG1" "$HS_ARG2" ;;
  restore-test) hs_restore_test ;;
  manifest) hs_manifest "$HS_ARG1" "$HS_ARG2" ;;
  arel) hs_arel "$HS_ARG1" "$HS_ARG2" ;;
  readback) hs_readback "$HS_ARG1" ;;
  *) stop "unknown stage $STAGE_NAME" 2 ;;
esac
}
