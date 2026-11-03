#!/usr/bin/env bash
{
# GAP-029 FINAL verification: ONE fresh post-S4 production backup. Streamed over one SSH connection (bash -s) and run on the production host as the deploy user.
# DERIVED from the reviewed tools/v2/gap029-ops/prod-stage.sh `capture` phase (same profile validation, identity/exclusivity gates, the reviewed
# capture-prod-stage.sh run from the PINNED checkout at R, check-capture, target.json query and check-target). The substitutions ONLY are:
#   1. the order gate / not_accepted gate are replaced by the POSITIVE gate that S4 IS accepted ($OPS/accepted/S4.json exists) -- the stage wrapper refuses a
#      capture for an accepted stage by design, and this capture is not a stage;
#   2. the run directory is $OPS/final/FINAL-<stamp> (the stage "S4" label is only the capture script's naming argument: its directory is gap029-S4-<stamp>);
#   3. no actor check (no stage is applied), no plan.
# READ-ONLY database access as afldb_backup; the only host writes are the capture directory (mode 700) and the run directory (mode 700). No service, timer,
# privilege, application or database write. Connection strings are never in argv and never printed.
set -u -o pipefail
export LC_ALL=C
umask 077
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD; echo "STOP: $1"; exit "${2:-20}"; }
R=f05a2e78fdd0d90824789ab81ee2d2e4ffe3ab8f
OPS=/home/arm/ops/gap029-stages/${R:0:8}; CAND=$OPS/cand
HERE=$CAND/tools/v2/gap029-ops
PROFILE=$HERE/profile.production.env
[ -r "$PROFILE" ] || stop "profile unreadable"
if grep -qvE '^(#.*|[A-Z_]+="[^"$`\]*"|)$' "$PROFILE"; then stop "profile contains a line that is not KEY=\"plain value\""; fi
if grep -E '^[A-Z_]+=' "$PROFILE" | cut -d= -f1 | grep -qvxE 'PROFILE_NAME|EVIDENCE_CLASS|EXPECT_HOST|EXPECT_USER|PROD_CHECKOUT|OPS_ROOT|BACKUP_ROOT|PGBIN|NODE|PYTHON|EXPECT_SYSID|EXPECT_OID|EXPECT_CLUSTER|EXPECT_DB|EXPECT_DB_HOST|EXPECT_DB_PORT|EXPECT_LEDGER_ROWS|EXPECT_LEDGER_LAST|EXPECT_EXT|EXPECT_DB_OWNER|WRITER_UNITS|ALL_UNITS|TIMER_UNIT|SSH_HOST'; then
  stop "profile sets a key that is not in the profile grammar"; fi
# shellcheck disable=SC1090
. "$PROFILE"
[ "$(hostname)" = afldb-prod ] && [ "$PROFILE_NAME" = production ] && [ "$EVIDENCE_CLASS" = GENUINE_PRODUCTION ] || stop "only the production profile may run on the production host" 3
export PATH="$(dirname "$NODE"):$PATH"
[ "$(hostname)" = "$EXPECT_HOST" ] && [ "$(id -un)" = "$EXPECT_USER" ] || stop "unexpected host/user ($(hostname)/$(id -un))" 3
envval() { sed -n "s/^$1=//p" "$PROD_CHECKOUT/.env" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
creds() {
  local v; v=$(envval "$1"); [ -n "$v" ] || return 2
  [[ "$v" =~ $RE ]] || { unset v; return 3; }
  PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}
  PGPASSWORD=$(printf '%b' "${BASH_REMATCH[4]//\%/\x}"); unset v BASH_REMATCH
  [ "$PGUSER" = "$2" ] && [ "$PGDATABASE" = "$EXPECT_DB" ] && [ "$PGHOST" = "$EXPECT_DB_HOST" ] && [ "$PGPORT" = "$EXPECT_DB_PORT" ] || return 4
  export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
}
RO='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000'
q() { PGOPTIONS="$RO" PGAPPNAME=afldb-gap029-final "$PGBIN/psql" -X -q -At -F "$(printf '\t')" -P pager=off -v ON_ERROR_STOP=1 "$@"; }
OPSCLI() { (cd "$CAND" && node --import tsx tools/v2/gap029-ops.ts "$@"); }
no_conflicts() {
  local u
  for u in $WRITER_UNITS; do case "$(systemctl is-active "$u" 2>/dev/null)" in active|activating|reloading) stop "writer $u is running" 4;; esac; done
  if pgrep -af 'settle-|afl-api-|migrate\.ts|pg_dump|pg_restore|brownlow-production-correction|afl-api-fixture-window' | grep -v -E 'pgrep|capture-prod-stage\.sh|final-capture'; then
    stop "a writer, migration, dump or correction process is running" 4
  fi
  echo "no conflicting writer, migration or dump process"
}

step "F0 pinned checkout, positive gate"
cd "$CAND" 2>/dev/null || stop "no pinned checkout at $CAND"
[ "$(git rev-parse HEAD)" = "$R" ] || stop "pinned checkout is not at $R"
[ "$(git status --porcelain | wc -l)" = 0 ] || stop "pinned checkout is not clean"
[ -f "$OPS/accepted/S4.json" ] || stop "S4 is not accepted ($OPS/accepted/S4.json missing): a final backup is taken only after all four stages are accepted" 21
for s in S1 S2 S3; do [ -f "$OPS/accepted/$s.json" ] || stop "$s is not accepted" 21; done
echo "S1 S2 S3 S4 accepted: $(sha256sum "$OPS"/accepted/S4.json | cut -c1-16)"
step "F1 exclusivity (read-only)"
no_conflicts
step "F2 ONE fresh backup (reviewed capture-prod-stage.sh, stage label S4)"
mkdir -p -m 700 "$OPS/final"
CAPLOG=$(mktemp "$OPS/final/capture-XXXXXX.log"); chmod 600 "$CAPLOG"
bash "$HERE/capture-prod-stage.sh" S4 2>&1 | tee "$CAPLOG"; RC=${PIPESTATUS[0]}
[ "$RC" = 0 ] || stop "capture failed with exit $RC; nothing else was changed" "$((RC > 0 ? RC : 1))"
CAPDIR=$(sed -n 's/^CAPTURE_DIR=//p' "$CAPLOG" | tail -1); [ -d "$CAPDIR" ] || stop "capture did not report a directory" 6
STAMP=${CAPDIR##*-}; RUN=FINAL-$STAMP; RUNDIR=$OPS/final/$RUN
mkdir -m 700 "$RUNDIR" || stop "cannot create $RUNDIR" 6
mv "$CAPLOG" "$RUNDIR/capture.log"
step "F3 independent check of the capture directory and target identity"
OPSCLI check-capture --stage S4 --dir "$CAPDIR" --profile "$PROFILE" || stop "the capture directory failed its independent check" 6
creds AFLDB_BACKUP_DATABASE_URL afldb_backup || stop "afldb_backup credential not usable" 2
q -c "SELECT json_build_object('host', '$EXPECT_DB_HOST', 'port', inet_server_port(), 'database', current_database(), 'user', current_user,
  'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()), 'databaseOid', (SELECT oid::text FROM pg_database WHERE datname=current_database()),
  'clusterName', current_setting('cluster_name'), 'databaseComment', shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database'))" > "$RUNDIR/target.json" || stop "target query failed" 5
unset PGPASSWORD PGUSER PGHOST PGPORT PGDATABASE
OPSCLI check-target --target "$RUNDIR/target.json" --profile "$PROFILE" --dir "$CAPDIR" || stop "target identity differs from the expected production identity" 5
chmod 600 "$RUNDIR/target.json"
echo "RUN=$RUN"; echo "RUN_DIR=$RUNDIR"; echo "CAPTURE_DIR=$CAPDIR"
echo "TARGET_SHA256=$(sha256sum "$RUNDIR/target.json" | cut -d' ' -f1)"
echo "CAPTURE_COMPLETE final run=$RUN class=$EVIDENCE_CLASS"
exit 0
}
