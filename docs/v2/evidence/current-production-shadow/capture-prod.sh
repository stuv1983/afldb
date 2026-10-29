{
# AFLDB V2 current-production shadow capture (decision D-V2-CURRENT-SHADOW-CAPTURE-1).
# READ-ONLY database access as afldb_backup through the existing protected credential channel:
# AFLDB_BACKUP_DATABASE_URL in /home/arm/projects/afldb/.env, parsed into PG* variables only
# (never argv, never printed). Streamed from Windows, nothing is copied to the host first:
#   cmd /c "ssh -o BatchMode=yes afldb bash -s < capture-prod.sh > capture.log 2>&1"
# The only production-host write is ONE new mode-700 directory holding the archive, its TOC, the
# sidecar, two ledger listings, pg_dump stderr and SHA256SUMS. It is created only after every
# pre-check passes, so a stop before P5 leaves the host unchanged. No retention script, no pruning,
# no migration, no privilege, service, timer, Brownlow or application action.
set -u -o pipefail
export LC_ALL=C
umask 077
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD; echo "STOP: $1"; exit "${2:-1}"; }

DECISION=D-V2-CURRENT-SHADOW-CAPTURE-1
R=/home/arm/projects/afldb
PGBIN=/usr/lib/postgresql/16/bin
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
EXPECT_SYSID=7674454702926115004
EXPECT_OID=66668
EXPECT_LEDGER_ROWS=110
EXPECT_LAST=110_match_sheet_player_match_stats_authority.sql
# sha256 of "name<TAB>checksum<LF>" for the 110 ledger rows (ORDER BY name COLLATE "C"), derived from
# the 2026-10-20 sidecar of archive 7fefcd9b...; the 2026-10-27 census also read 110 / this last name.
EXPECT_LEDGER_DIGEST=789946fe734b23c32ec87e59e3b860877d31a4b32b561624bf1d88fb8f055153
EXPECT_EXT='pg_trgm=1.6 plpgsql=1.0 unaccent=1.1'
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
D=/home/arm/backups/afldb/current-shadow-$STAMP
NAME=afldb_prod-$STAMP.dump
T0=$(date +%s)

step "P0 host, tools, target directory"
[ "$(hostname)" = afldb-prod ] || stop "unexpected host $(hostname)" 3
[ "$(id -un)" = arm ] || stop "unexpected user $(id -un)" 3
[ ! -e "$D" ] || stop "capture directory already exists" 3
for x in pg_dump pg_restore psql; do [ -x "$PGBIN/$x" ] || stop "missing $PGBIN/$x" 3; done
command -v sha256sum >/dev/null && command -v timeout >/dev/null && [ -x "$NODE" ] || stop "missing sha256sum/timeout/node" 3
echo "host=$(hostname) user=$(id -un) kernel=$(uname -r) boot_id=$(cat /proc/sys/kernel/random/boot_id)"
DUMP_VERSION=$("$PGBIN/pg_dump" --version); echo "$DUMP_VERSION"; "$PGBIN/pg_restore" --version

step "P1 writer and service state (read-only systemctl queries)"
for u in afldb.service afldb-settle-afltables.service afldb-settle-afltables.timer afldb-settle-afl-api.service \
  afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer \
  afldb-email-intake.service afldb-email-intake.timer; do
  printf '%s active=%s enabled=%s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null)" "$(systemctl is-enabled "$u" 2>/dev/null)"
done
for u in afldb-settle-afltables.service afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service afldb-email-intake.service; do
  case "$(systemctl is-active "$u" 2>/dev/null)" in active|activating|reloading) stop "writer $u is running; retry after it finishes" 4;; esac
done
NEXT=$(systemctl show --timestamp=unix -p NextElapseUSecRealtime --value afldb-settle-afltables.timer 2>/dev/null)
echo "afldb-settle-afltables.timer next=$NEXT"
if [[ "$NEXT" =~ ^@([0-9]+)$ ]]; then
  [ $(( BASH_REMATCH[1] - $(date +%s) )) -ge 1800 ] || stop "AFL Tables settle timer fires within 30 minutes" 4
else
  # Fallback when the next run cannot be read: OnCalendar 04:30 host time + RandomizedDelaySec 15min.
  H=$(date +%H%M); [ "$H" \< 0400 ] || [ "$H" \> 0530 ] || stop "host time $H is inside the 04:00-05:30 settle band" 4
fi
pgrep -af 'settle-|afl-api-|migrate\.ts|pg_dump|pg_restore' | grep -v pgrep || echo "no settle/migrate/dump process"
pgrep -f 'settle-|migrate\.ts' >/dev/null && stop "a settle or migration process is running" 4
DEPLOYED_REV=$(GIT_OPTIONAL_LOCKS=0 git -C "$R" rev-parse HEAD 2>/dev/null || echo unknown)
DEPLOYED_BUILD=$(cat "$R/.next/BUILD_ID" 2>/dev/null || echo unknown)
echo "deployed_checkout=$DEPLOYED_REV build_id=$DEPLOYED_BUILD"
WRITERS_BEFORE="afltables_service=$(systemctl is-active afldb-settle-afltables.service 2>/dev/null) timer=$(systemctl is-enabled afldb-settle-afltables.timer 2>/dev/null)/$(systemctl is-active afldb-settle-afltables.timer 2>/dev/null) app=$(systemctl is-active afldb.service 2>/dev/null)"

step "P2 disk"
AVAIL=$(df --output=avail -B1 /home/arm | tail -1 | tr -d ' ')
echo "home_avail_bytes=$AVAIL"
[ "$AVAIL" -ge 2147483648 ] || stop "less than 2 GiB free under /home/arm" 4

step "P3 credential channel (values never printed)"
ENVF="$R/.env"
[ -r "$ENVF" ] || stop "env file unreadable" 2
echo "env_file_mode=$(stat -c '%a %U:%G' "$ENVF")"
DSN=$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' "$ENVF" | tail -1 | sed 's/^"\(.*\)"$/\1/')
[ -n "$DSN" ] || stop "AFLDB_BACKUP_DATABASE_URL empty" 2
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
# Match first: an unparseable value must never reach a variable that is printed (review LOW-1).
[[ "$DSN" =~ $RE ]] || { unset DSN; stop "AFLDB_BACKUP_DATABASE_URL has an unexpected form (value not printed)" 2; }
PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}
PWENC=${BASH_REMATCH[4]}
# "\%": an unescaped leading % would anchor the pattern at the end and leave escapes undecoded.
PGPASSWORD=$(printf '%b' "${PWENC//\%/\\x}"); unset PWENC DSN BASH_REMATCH
echo "dsn_identity user=$PGUSER host=$PGHOST port=$PGPORT database=$PGDATABASE"
[ "$PGUSER" = afldb_backup ] && [ "$PGDATABASE" = afldb_prod ] && [ "$PGHOST" = localhost ] && [ "$PGPORT" = 5432 ] \
  || stop "credential is not afldb_backup@localhost:5432/afldb_prod" 2
export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
RO='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000'
q() { PGOPTIONS="$RO" PGAPPNAME=afldb-v2-current-shadow-inspect "$PGBIN/psql" -X -q -At -F "$(printf '\t')" -P pager=off -v ON_ERROR_STOP=1 "$@"; }

step "P4 identity, ledger and inspection (each a single statement, so one snapshot, in a read-only session)"
IDENT=$(q -c "SELECT current_database(), current_user, (SELECT oid FROM pg_database WHERE datname=current_database()),
 (SELECT system_identifier::text FROM pg_control_system()), current_setting('server_version_num'),
 coalesce(host(inet_server_addr()),'socket'), inet_server_port(), current_setting('transaction_read_only'),
 (SELECT rolsuper FROM pg_roles WHERE rolname=current_user), pg_has_role(current_user,'pg_read_all_data','member'),
 (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()), current_setting('server_version')") \
  || stop "identity query failed" 5
echo "identity $IDENT"
IFS=$'\t' read -r I_DB I_USER I_OID I_SYSID I_VNUM I_ADDR I_PORT I_RO I_SUPER I_READALL I_OWNER I_VER <<< "$IDENT"
[ "$I_DB" = afldb_prod ] && [ "$I_USER" = afldb_backup ] && [ "$I_OID" = "$EXPECT_OID" ] && [ "$I_SYSID" = "$EXPECT_SYSID" ] \
  && [ "$I_RO" = on ] && [ "$I_SUPER" = f ] && [ "$I_READALL" = t ] && [ "$I_OWNER" = afldb_owner ] \
  && [ "$I_VNUM" -ge 160000 ] && [ "$I_VNUM" -lt 170000 ] || stop "identity differs from the reviewed target" 5
EXT=$(q -c "SELECT string_agg(extname||'='||extversion, ' ' ORDER BY extname) FROM pg_extension") || stop "extension query failed" 5
echo "extensions $EXT"; [ "$EXT" = "$EXPECT_EXT" ] || stop "extension set/versions differ" 5
ledger() { q -c "SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE \"C\""; }
LEDGER_BEFORE_AT=$(date -u +%FT%T.%3NZ); LEDGER_BEFORE=$(ledger) || stop "ledger query failed" 5
L_ROWS=$(printf '%s\n' "$LEDGER_BEFORE" | wc -l); L_LAST=$(printf '%s\n' "$LEDGER_BEFORE" | tail -1 | cut -f1)
L_DIG=$(printf '%s\n' "$LEDGER_BEFORE" | sha256sum | cut -c1-64)
echo "ledger rows=$L_ROWS last=$L_LAST digest=$L_DIG"
[ "$L_ROWS" = "$EXPECT_LEDGER_ROWS" ] && [ "$L_LAST" = "$EXPECT_LAST" ] && [ "$L_DIG" = "$EXPECT_LEDGER_DIGEST" ] \
  || stop "ledger differs from the reviewed 110 baseline: review before any capture" 5
INSPECT=$(q -c "SELECT 'access_exclusive_relation_locks', count(*)::text FROM pg_locks l JOIN pg_database d ON d.oid=l.database
 WHERE d.datname=current_database() AND l.locktype='relation' AND l.mode='AccessExclusiveLock'
UNION ALL SELECT 'visible_nonidle_sessions', count(*)::text FROM pg_stat_activity
 WHERE datname=current_database() AND pid<>pg_backend_pid() AND state IS NOT NULL AND state<>'idle'
UNION ALL SELECT 'staging_default_acl_entries', count(*)::text FROM pg_default_acl a JOIN pg_namespace n ON n.oid=a.defaclnamespace WHERE n.nspname='staging'
UNION ALL SELECT 'staged_brownlow_seasons', coalesce(string_agg(season::text||':'||c::text, ' ' ORDER BY season), 'none')
 FROM (SELECT season, count(*) c FROM staging.afl_api_brownlow_vote GROUP BY season) s
UNION ALL SELECT 'public_base_tables', count(*)::text FROM pg_tables WHERE schemaname='public'") \
  || stop "inspection query failed" 5
printf '%s\n' "$INSPECT" | sed 's/^/inspect /'
LOCKS=$(printf '%s\n' "$INSPECT" | awk -F'\t' '$1=="access_exclusive_relation_locks"{print $2}')
STAGED=$(printf '%s\n' "$INSPECT" | awk -F'\t' '$1=="staged_brownlow_seasons"{print $2}')
STAGING_DACL=$(printf '%s\n' "$INSPECT" | awk -F'\t' '$1=="staging_default_acl_entries"{print $2}')
[ "$LOCKS" = 0 ] || stop "an AccessExclusiveLock is held in afldb_prod (DDL/maintenance in progress)" 4

step "P5 capture: one full custom-format pg_dump (single MVCC snapshot; writers stay enabled)"
mkdir -p -m 700 /home/arm/backups/afldb
mkdir -m 700 "$D" || stop "cannot create $D" 6
echo "CAPTURE_DIR=$D"
printf '%s\n' "$LEDGER_BEFORE" > "$D/ledger-before.tsv"
START_UTC=$(date -u +%FT%T.%6NZ)
PGOPTIONS='-c default_transaction_read_only=on' PGAPPNAME=afldb-v2-current-shadow-dump \
  timeout --signal=TERM --kill-after=30 900 "$PGBIN/pg_dump" --format=custom --compress=6 --no-owner \
  --lock-wait-timeout=5s --file="$D/$NAME.partial" 2> "$D/pg-dump.stderr"
X=$?
END_UTC=$(date -u +%FT%T.%6NZ)
echo "pg_dump exit=$X start=$START_UTC end=$END_UTC stderr_bytes=$(stat -c %s "$D/pg-dump.stderr")"
[ "$X" = 0 ] || stop "pg_dump failed (124 = 15-minute limit); partial and stderr retained in $D, no retry" 7
[ -s "$D/pg-dump.stderr" ] && stop "pg_dump wrote to stderr; archive retained as .partial for review" 7
chmod 600 "$D/$NAME.partial"
"$PGBIN/pg_restore" --list "$D/$NAME.partial" > "$D/archive.toc" || stop "archive TOC unreadable; retained as .partial" 7
TOC_ENTRIES=$(grep -cv '^;' "$D/archive.toc")
mv "$D/$NAME.partial" "$D/$NAME"
SHA=$(sha256sum "$D/$NAME" | cut -c1-64); BYTES=$(stat -c %s "$D/$NAME")
echo "archive $NAME bytes=$BYTES sha256=$SHA toc_entries=$TOC_ENTRIES"

step "P6 post-capture drift checks"
LEDGER_AFTER_AT=$(date -u +%FT%T.%3NZ); LEDGER_AFTER=$(ledger) || stop "post ledger query failed" 8
printf '%s\n' "$LEDGER_AFTER" > "$D/ledger-after.tsv"
[ "$(printf '%s\n' "$LEDGER_AFTER" | sha256sum | cut -c1-64)" = "$L_DIG" ] || stop "ledger changed during capture; archive retained, not usable" 8
WRITERS_AFTER="afltables_service=$(systemctl is-active afldb-settle-afltables.service 2>/dev/null) timer=$(systemctl is-enabled afldb-settle-afltables.timer 2>/dev/null)/$(systemctl is-active afldb-settle-afltables.timer 2>/dev/null) app=$(systemctl is-active afldb.service 2>/dev/null)"
echo "writers_before: $WRITERS_BEFORE"; echo "writers_after:  $WRITERS_AFTER"
unset PGPASSWORD

step "P7 sidecar (exclusive create; no credential)"
export DECISION STAMP NAME SHA BYTES TOC_ENTRIES START_UTC END_UTC LEDGER_BEFORE_AT LEDGER_AFTER_AT L_DIG I_VER I_ADDR I_PORT \
  I_OID I_SYSID I_OWNER DUMP_VERSION EXT STAGED STAGING_DACL DEPLOYED_REV DEPLOYED_BUILD WRITERS_BEFORE WRITERS_AFTER D
"$NODE" -e '
const fs = require("node:fs"); const e = process.env;
const ledger = fs.readFileSync(e.D + "/ledger-before.tsv", "utf8").trimEnd().split("\n").map((l) => { const [name, checksum] = l.split("\t"); return { name, checksum }; });
const sidecar = {
  format: "afldb.v2.capture-provenance.2", decision: e.DECISION,
  operator: "arm on afldb-prod, run by the owner-approved Claude Code session (D-V2-CURRENT-SHADOW-CAPTURE-1)",
  approval_reference: "D-V2-CURRENT-SHADOW-CAPTURE-1: one read-only capture; secure local export; isolated restore on streamanator only. Auth/audit data stays in mode-700/600 restricted locations outside Git.",
  seal: 2025,
  source_identity: { host: "afldb-prod", database: "afldb_prod", role: "afldb_backup", address: e.I_ADDR, port: Number(e.I_PORT),
    cluster: "16/main", version: e.I_VER, database_oid: e.I_OID, system_identifier: e.I_SYSID, owner: e.I_OWNER },
  captured_start_utc: e.START_UTC, captured_end_utc: e.END_UTC, dump_version: e.DUMP_VERSION,
  ledger_measured_before_utc: e.LEDGER_BEFORE_AT, ledger_measured_after_utc: e.LEDGER_AFTER_AT,
  observed_ledger: ledger, observed_ledger_digest: e.L_DIG, ledger_unchanged_across_capture: true,
  extensions: e.EXT, staged_brownlow_seasons: e.STAGED, staging_default_acl_entries: Number(e.STAGING_DACL),
  dump_options: ["--format=custom", "--compress=6", "--no-owner", "--lock-wait-timeout=5s", "--file=<unique archive>"],
  coverage: "Full database schema and data; all schemas, auth/audit and staging; no exclusions. ACLs retained in the archive. --no-owner affects ownership restoration only.",
  consistency: "Single pg_dump MVCC snapshot; writers enabled (no pause authority). Ledger read before and after outside the snapshot and unchanged; the restored ledger is the in-snapshot value.",
  writers_before: e.WRITERS_BEFORE, writers_after: e.WRITERS_AFTER,
  deployed_checkout_revision: e.DEPLOYED_REV, deployed_build_id: e.DEPLOYED_BUILD,
  archive: e.NAME, archive_bytes: Number(e.BYTES), archive_sha256: e.SHA, archive_toc_entries: Number(e.TOC_ENTRIES), toc_readable: true,
  restore_status: "Unverified at capture; the isolated restore report is separate.",
  not_a_rollback_baseline: "Writers-active point-in-time shadow input. Not the frozen release rollback backup (release plan step 5).",
};
fs.writeFileSync(e.D + "/afldb_prod-" + e.STAMP + ".provenance.json", JSON.stringify(sidecar, null, 2) + "\n", { flag: "wx", mode: 0o600 });
' || stop "sidecar write failed; archive retained" 9

step "P8 manifest and result"
( cd "$D" && sha256sum "$NAME" "afldb_prod-$STAMP.provenance.json" archive.toc ledger-before.tsv ledger-after.tsv pg-dump.stderr > SHA256SUMS && chmod 600 ./* ) \
  || stop "manifest failed; everything retained in $D" 10
cat "$D/SHA256SUMS"
ls -la "$D"
ELAPSED=$(( $(date +%s) - T0 ))
echo "elapsed_seconds=$ELAPSED"
[ "$ELAPSED" -le 1200 ] || echo "REVIEW: production phase exceeded 20 minutes"
echo "RESULT PASS stamp=$STAMP archive_sha256=$SHA bytes=$BYTES toc=$TOC_ENTRIES staged_brownlow=$STAGED"
}
