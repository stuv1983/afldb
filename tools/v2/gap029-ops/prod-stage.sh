#!/usr/bin/env bash
{
# V2-GAP-029 production-host wrapper: one script, one phase per call, run on the production host as the deploy user from the PINNED checkout
# (<OPS>/cand, a clean checkout at the frozen execution revision R). The stage tools (tools/v2/gap029-*-production.*) keep every database guard, plan
# digest, approval binding and outcome; this wrapper adds only the ceremony around them: identity and exclusivity gates, per-stage ordering, exact input
# binding (manifest), the owner approval file, a single non-retryable apply, and honest outcome reporting.
#
#   bash prod-stage.sh prep      R TAR_SHA256                 verify the uploaded checkout tarball, extract, pin, link node_modules (idempotent)
#   bash prod-stage.sh preflight R S                          read-only: order gate, exclusivity, actor 1, live identity/ledger/extensions
#   bash prod-stage.sh capture   R S                          preflight + ONE fresh backup + target identity -> run directory
#   bash prod-stage.sh plan      R S RUN                      check capture + uploaded evidence, read-only plan, manifest, summary
#   bash prod-stage.sh approve   R S RUN DIGEST STMT_FILE EXPIRES [NOT_BEFORE]   owner act: writes approval.json only if DIGEST is this plan's digest
#   bash prod-stage.sh apply     R S RUN                      gates, approval, ONE detached apply, post-run state probe, outcome report
#   bash prod-stage.sh report    R S RUN                      print (or, for an unrecorded apply, derive) the outcome
#   bash prod-stage.sh state     R S RUN                      read-only classification of the live database against the plan
#   bash prod-stage.sh accept    R S RUN                      read-only acceptance: outcome + state (+ S3 verify) -> accepted/S.json
#
# There is NO retry, NO rollback claim after a commit and NO restore in this script. Connection strings are read from <checkout>/.env into environment
# variables of the child process only; they are never in argv and never printed. GAP029_PROFILE overrides the production profile (a simulation passes its own).
set -u -o pipefail
export LC_ALL=C
umask 077
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD AFLDB_GAP029_DSN AFLDB_GAP029_WRITE_DSN; echo "STOP: $1"; exit "${2:-20}"; }

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROFILE=${GAP029_PROFILE:-$HERE/profile.production.env}
[ -r "$PROFILE" ] || stop "profile unreadable"
if grep -qvE '^(#.*|[A-Z_]+="[^"$`\\]*"|)$' "$PROFILE"; then stop "profile contains a line that is not KEY=\"plain value\""; fi
if grep -E '^[A-Z_]+=' "$PROFILE" | cut -d= -f1 | grep -qvxE 'PROFILE_NAME|EVIDENCE_CLASS|EXPECT_HOST|EXPECT_USER|PROD_CHECKOUT|OPS_ROOT|BACKUP_ROOT|PGBIN|NODE|PYTHON|EXPECT_SYSID|EXPECT_OID|EXPECT_CLUSTER|EXPECT_DB|EXPECT_DB_HOST|EXPECT_DB_PORT|EXPECT_LEDGER_ROWS|EXPECT_LEDGER_LAST|EXPECT_EXT|EXPECT_DB_OWNER|WRITER_UNITS|ALL_UNITS|TIMER_UNIT|SSH_HOST'; then
  stop "profile sets a key that is not in the profile grammar"; fi
# shellcheck disable=SC1090
. "$PROFILE"
# On the production host only the production profile is acceptable, whatever GAP029_PROFILE says (a simulation profile can never drive a production host).
if [ "$(hostname)" = afldb-prod ]; then [ "$PROFILE_NAME" = production ] && [ "$EVIDENCE_CLASS" = GENUINE_PRODUCTION ] || stop "only the production profile may run on the production host"; fi

PHASE=${1:?phase}; R=${2:?execution revision (40 hex)}
[[ "$R" =~ ^[0-9a-f]{40}$ ]] || stop "revision must be 40 hex" 2
export PATH="$(dirname "$NODE"):$PATH"
OPS=$OPS_ROOT/${R:0:8}; CAND=$OPS/cand
[ "$(hostname)" = "$EXPECT_HOST" ] && [ "$(id -un)" = "$EXPECT_USER" ] || stop "unexpected host/user ($(hostname)/$(id -un))" 3

envval() { sed -n "s/^$1=//p" "$PROD_CHECKOUT/.env" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
# creds VAR USER: sets PG* for psql (read-only helpers); the value is never printed
creds() {
  local v; v=$(envval "$1"); [ -n "$v" ] || return 2
  [[ "$v" =~ $RE ]] || { unset v; return 3; }
  PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}
  PGPASSWORD=$(printf '%b' "${BASH_REMATCH[4]//\%/\\x}"); unset v BASH_REMATCH
  [ "$PGUSER" = "$2" ] && [ "$PGDATABASE" = "$EXPECT_DB" ] && [ "$PGHOST" = "$EXPECT_DB_HOST" ] && [ "$PGPORT" = "$EXPECT_DB_PORT" ] || return 4
  export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
}
RO='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000'
q() { PGOPTIONS="$RO" PGAPPNAME=afldb-gap029-wrapper "$PGBIN/psql" -X -q -At -F "$(printf '\t')" -P pager=off -v ON_ERROR_STOP=1 "$@"; }
OPSCLI() { (cd "$CAND" && node --import tsx tools/v2/gap029-ops.ts "$@"); }

need_checkout() {
  cd "$CAND" 2>/dev/null || stop "no pinned checkout at $CAND: run prep first"
  [ "$(git rev-parse HEAD)" = "$R" ] || stop "pinned checkout is not at $R"
  [ "$(git status --porcelain | wc -l)" = 0 ] || stop "pinned checkout is not clean"
}
stage_arg() { S=${1:?stage S1..S4}; case "$S" in S1|S2|S3|S4) ;; *) stop "stage must be S1, S2, S3 or S4" 2;; esac; }
run_arg() {
  RUN=${1:?run name (e.g. S1-20261103T000000Z)}; [[ "$RUN" =~ ^S[1-4]-[0-9]{8}T[0-9]{6}Z$ ]] || stop "bad run name" 2; [ "${RUN%%-*}" = "$S" ] || stop "run $RUN is not a $S run" 2
  RUNDIR=$OPS/runs/$RUN; CAPDIR=$BACKUP_ROOT/gap029-$S-${RUN#*-}; [ -d "$RUNDIR" ] || stop "no run directory $RUNDIR"; [ -d "$CAPDIR" ] || stop "no capture directory $CAPDIR"
}
no_conflicts() {
  local u
  for u in $WRITER_UNITS; do case "$(systemctl is-active "$u" 2>/dev/null)" in active|activating|reloading) stop "writer $u is running" 4;; esac; done
  if pgrep -af 'settle-|afl-api-|migrate\.ts|pg_dump|pg_restore|brownlow-production-correction|afl-api-fixture-window' | grep -v -E 'pgrep|prod-stage\.sh|capture-prod-stage\.sh'; then
    stop "a writer, migration, dump or correction process is running" 4
  fi
  echo "no conflicting writer, migration or dump process"
}
load_dsns() {
  AFLDB_GAP029_DSN=$(envval AFLDB_BACKUP_DATABASE_URL); AFLDB_GAP029_WRITE_DSN=$(envval AFLDB_IMPORT_DATABASE_URL)
  [ -n "$AFLDB_GAP029_DSN" ] && [ -n "$AFLDB_GAP029_WRITE_DSN" ] || stop "a database credential is missing from the credential channel" 2
  export AFLDB_GAP029_DSN AFLDB_GAP029_WRITE_DSN
}
drop_dsns() { unset AFLDB_GAP029_DSN AFLDB_GAP029_WRITE_DSN PGPASSWORD PGUSER PGHOST PGPORT PGDATABASE; }
prev_stage() { case "$1" in S2) echo S1;; S3) echo S2;; S4) echo S3;; *) echo "";; esac; }
# The recorded outcome's exit code, or 25 when outcome.json is unreadable: a bare `exit ""` would be status 2, which is ROLLED_BACK's code.
exit_of() {
  local c; c=$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).exitCode))' "$1" 2>/dev/null)
  if [[ "$c" =~ ^[0-5]$ ]]; then echo "$c"; else echo "WARN: outcome.json is unreadable; run report/state before deciding anything" >&2; echo 25; fi
}
class_of() { node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).classification))' "$1" 2>/dev/null; }
# A stage is applied once. Refuse any plan/approval/apply for a stage that is already accepted.
not_accepted() { [ ! -e "$OPS/accepted/$S.json" ] || stop "$S is already accepted; no further plan, approval or apply for it" 21; }
# One apply per stage across ALL runs of that stage: another run that started an apply blocks this one unless its recorded outcome proves nothing was written
# (REFUSED_BEFORE_MUTATION or ROLLED_BACK). Argument: this run's directory ("" when none yet).
stage_run_gate() {
  local own="$1" L d c
  for L in "$OPS"/runs/"$S"-*/apply.lock; do
    [ -e "$L" ] || continue; d=$(dirname "$L"); [ "$d" = "$own" ] && continue
    c=$(class_of "$d/outcome.json")
    case "$c" in REFUSED_BEFORE_MUTATION|ROLLED_BACK) ;; *) stop "another $S run ($(basename "$d")) has started an apply (outcome: ${c:-unrecorded}); one apply per stage: report on it and get an owner decision" 22;; esac
  done
}

# Everything that must hold before a backup is worth taking. Read-only. Uses $S.
preflight_checks() {
  step "preflight $S: order gate"
  local P; P=$(prev_stage "$S")
  if [ -n "$P" ]; then
    [ -f "$OPS/accepted/$P.json" ] || stop "$P has not been accepted ($OPS/accepted/$P.json missing): $S needs a fresh backup AFTER $P is applied and accepted" 21
    echo "$P accepted: $(sha256sum "$OPS/accepted/$P.json" | cut -c1-16)"
  fi
  not_accepted
  stage_run_gate ""
  step "preflight $S: exclusivity (read-only)"
  no_conflicts
  step "preflight $S: live identity, ledger and extensions (read-only session)"
  creds AFLDB_BACKUP_DATABASE_URL afldb_backup || stop "afldb_backup credential not usable (value not printed)" 2
  local IDV
  IDV=$(q -c "SELECT current_database(), current_user, (SELECT oid::text FROM pg_database WHERE datname=current_database()), (SELECT system_identifier::text FROM pg_control_system()),
     (SELECT count(*)::text FROM afldb_meta.schema_migrations), (SELECT max(name COLLATE \"C\") FROM afldb_meta.schema_migrations),
     (SELECT string_agg(extname||'='||extversion, ' ' ORDER BY extname) FROM pg_extension)") || stop "identity query failed" 5
  local V_DB V_USER V_OID V_SYSID V_LROWS V_LLAST V_EXT
  IFS=$'\t' read -r V_DB V_USER V_OID V_SYSID V_LROWS V_LLAST V_EXT <<< "$IDV"
  echo "live identity: db=$V_DB user=$V_USER oid=$V_OID system=$V_SYSID ledger=$V_LROWS/$V_LLAST"
  [ "$V_DB" = "$EXPECT_DB" ] && [ "$V_USER" = afldb_backup ] && [ "$V_OID" = "$EXPECT_OID" ] && [ "$V_SYSID" = "$EXPECT_SYSID" ] && [ "$V_LROWS" = "$EXPECT_LEDGER_ROWS" ] \
    && [ "$V_LLAST" = "$EXPECT_LEDGER_LAST" ] && [ "$V_EXT" = "$EXPECT_EXT" ] || stop "live identity, ledger or extensions differ from the expected production state" 5
  step "preflight $S: actor auth_users.id 1 (migration-105 predicate by plain SELECTs; no function call)"
  local OWN="${GAP029_OWNER_EMAIL:-}"
  if [ -n "$OWN" ] && ! [[ "$OWN" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]]; then stop "GAP029_OWNER_EMAIL is not a plain e-mail address" 2; fi
  ACTOR=$(q -c "SELECT u.id::text, u.role::text, (u.disabled_at IS NULL)::text, (u.password_hash IS NOT NULL AND u.totp_secret IS NOT NULL)::text,
     (NOT ( position('@' in u.email) <= 1 OR position('@' in u.email) = length(u.email) OR rtrim(lower(split_part(u.email,'@',2)),'.') = ''
        OR rtrim(lower(split_part(u.email,'@',2)),'.') ~ '(^|\.)(test|example|invalid|localhost)\$'
        OR rtrim(lower(split_part(u.email,'@',2)),'.') ~ '(^|\.)(example\.com|example\.net|example\.org)\$' ))::text,
     CASE WHEN '$OWN' = '' THEN 'unchecked' ELSE (lower(u.email)=lower('$OWN'))::text END
     FROM auth_users u WHERE u.id = 1") || stop "actor query failed" 5
  SUPERS=$(q -c "SELECT count(*)::text FROM auth_users WHERE role::text='super_admin' AND disabled_at IS NULL")
  echo "actor1 (id, role, enabled, enrolled, non_fixture_email, owner_email_match): $ACTOR; enabled super_admin count: $SUPERS"
  local A_ID A_ROLE A_EN A_ENR A_NF A_OWN
  IFS=$'\t' read -r A_ID A_ROLE A_EN A_ENR A_NF A_OWN <<< "$ACTOR"
  [ "$A_ID" = 1 ] && [ "$A_ROLE" = super_admin ] && [ "$A_EN" = true ] && [ "$A_ENR" = true ] && [ "$A_NF" = true ] || stop "actor id 1 is not an enabled, fully enrolled, non-fixture Super Admin" 5
  [ "$A_OWN" != false ] || stop "actor id 1 does not match the owner e-mail" 5
  [ "$SUPERS" = 1 ] || stop "the enabled Super Admin count is $SUPERS, not the 1 recorded by the reviewed role probe: the actor set changed, review before any backup" 5
  drop_dsns
}

case "$PHASE" in
prep)
  TAR_SHA=${3:?tar sha256}
  step "prep: verify upload, extract, pin (idempotent)"
  # The caller (the workstation runner) has verified and extracted the upload with three inline commands, because this script lives INSIDE that tarball.
  # Re-verify here regardless: the tarball hash, then the extracted checkout.
  [ -f "$OPS/in/cand.tar.gz" ] || stop "upload $OPS/in/cand.tar.gz missing" 3
  [ "$(sha256sum "$OPS/in/cand.tar.gz" | cut -d' ' -f1)" = "$TAR_SHA" ] || stop "cand.tar.gz sha256 mismatch" 3
  [ -d "$CAND" ] || tar xzf "$OPS/in/cand.tar.gz" -C "$OPS" || stop "extract failed" 3
  cd "$CAND" || stop "no checkout after extract" 3
  [ "$(git rev-parse HEAD)" = "$R" ] || stop "HEAD is not $R" 3
  [ "$(git status --porcelain | wc -l)" = 0 ] || stop "pinned checkout dirty" 3
  [ "$(sha256sum package-lock.json | cut -d' ' -f1)" = "$(sha256sum "$PROD_CHECKOUT/package-lock.json" | cut -d' ' -f1)" ] || stop "package-lock differs from the production checkout (node_modules not reusable)" 3
  [ "$(sha256sum package.json | cut -d' ' -f1)" = "$(sha256sum "$PROD_CHECKOUT/package.json" | cut -d' ' -f1)" ] || stop "package.json differs from the production checkout" 3
  if [ ! -e "$CAND/node_modules" ]; then ln -s "$PROD_CHECKOUT/node_modules" "$CAND/node_modules"; echo node_modules >> "$CAND/.git/info/exclude"; fi
  [ "$(git status --porcelain | wc -l)" = 0 ] || stop "node_modules link dirtied the tree" 3
  mkdir -p -m 700 "$OPS/runs" "$OPS/accepted" "$OPS/in"
  cd "$CAND" || stop "no checkout" 3
  echo "pinned_checkout=$CAND HEAD=$(git rev-parse HEAD) tracked=$(git ls-files | wc -l) dirty=0 node=$(node -v)"
  echo "prod_checkout_unchanged: head=$(GIT_OPTIONAL_LOCKS=0 git -C "$PROD_CHECKOUT" rev-parse HEAD) status_lines=$(GIT_OPTIONAL_LOCKS=0 git -C "$PROD_CHECKOUT" status --porcelain | wc -l)"
  node --import tsx --conditions=react-server -e "import('./tools/v2/gap029-ops-lib.ts').then(m=>console.log('wrapper library loads; stages', Object.keys(m.STAGES).join(',')))" || stop "tsx cannot load the wrapper library" 3
  PYTHONDONTWRITEBYTECODE=1 "$PYTHON" -c 'import psycopg,sys;print("python", sys.version.split()[0], "psycopg", psycopg.__version__)' || stop "the stage python has no psycopg" 3
  echo "profile=$PROFILE_NAME class=$EVIDENCE_CLASS profile_sha256=$(sha256sum "$PROFILE" | cut -d' ' -f1)"
  ;;

preflight)
  stage_arg "${3:-}"; need_checkout
  preflight_checks
  echo "PREFLIGHT_OK stage=$S class=$EVIDENCE_CLASS"
  ;;

capture)
  stage_arg "${3:-}"; need_checkout
  preflight_checks
  step "capture $S: ONE fresh backup (capture-prod-stage.sh)"
  CAPLOG=$(mktemp "$OPS/in/capture-XXXXXX.log"); chmod 600 "$CAPLOG"
  bash "$HERE/capture-prod-stage.sh" "$S" 2>&1 | tee "$CAPLOG"; RC=${PIPESTATUS[0]}
  [ "$RC" = 0 ] || stop "capture failed with exit $RC; see the output above. Nothing else was changed" "$((RC > 0 ? RC : 1))"
  CAPDIR=$(sed -n 's/^CAPTURE_DIR=//p' "$CAPLOG" | tail -1); [ -d "$CAPDIR" ] || stop "capture did not report a directory" 6
  STAMP=${CAPDIR##*-}; RUN=$S-$STAMP; RUNDIR=$OPS/runs/$RUN
  mkdir -m 700 "$RUNDIR" "$RUNDIR/logs" || stop "cannot create the run directory $RUNDIR" 6
  mv "$CAPLOG" "$RUNDIR/logs/capture.log"
  echo "actor1 $ACTOR enabled_super_admins=$SUPERS" > "$RUNDIR/actor.txt"
  step "capture $S: independent check of the capture directory and target identity"
  OPSCLI check-capture --stage "$S" --dir "$CAPDIR" --profile "$PROFILE" || stop "the capture directory failed its independent check" 6
  creds AFLDB_BACKUP_DATABASE_URL afldb_backup || stop "afldb_backup credential not usable" 2
  q -c "SELECT json_build_object('host', '$EXPECT_DB_HOST', 'port', inet_server_port(), 'database', current_database(), 'user', current_user,
    'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()), 'databaseOid', (SELECT oid::text FROM pg_database WHERE datname=current_database()),
    'clusterName', current_setting('cluster_name'), 'databaseComment', shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database'))" > "$RUNDIR/target.json" || stop "target query failed" 5
  drop_dsns
  OPSCLI check-target --target "$RUNDIR/target.json" --profile "$PROFILE" --dir "$CAPDIR" || stop "target identity differs from the expected production identity" 5
  chmod 600 "$RUNDIR/target.json"
  echo "RUN=$RUN"; echo "RUN_DIR=$RUNDIR"; echo "CAPTURE_DIR=$CAPDIR"
  echo "TARGET_SHA256=$(sha256sum "$RUNDIR/target.json" | cut -d' ' -f1)"
  echo "CAPTURE_COMPLETE stage=$S run=$RUN class=$EVIDENCE_CLASS"
  ;;

plan)
  stage_arg "${3:-}"; run_arg "${4:-}"; need_checkout
  not_accepted
  step "plan $S ($RUN): inputs"
  for f in target.json backup.json restore-evidence.json; do [ -f "$RUNDIR/$f" ] || stop "$RUNDIR/$f is missing (upload the assembled evidence first)" 3; done
  [ "$S" != S2 ] || [ -f "$RUNDIR/child.json" ] || stop "S2 needs child.json from the restore" 3
  chmod 600 "$RUNDIR"/*.json 2>/dev/null; true
  [ ! -e "$RUNDIR/plan.json" ] || stop "a plan already exists for this run; a re-plan needs a new capture (never overwritten)" 3
  OPSCLI check-capture --stage "$S" --dir "$CAPDIR" --profile "$PROFILE" || stop "capture check failed" 6
  OPSCLI check-target --target "$RUNDIR/target.json" --profile "$PROFILE" --dir "$CAPDIR" || stop "target check failed" 5
  no_conflicts
  step "plan $S ($RUN): tool plan (read-only; writes only the plan file)"
  load_dsns
  OPSCLI run-tool --stage "$S" --phase plan --run-dir "$RUNDIR" --capture-dir "$CAPDIR" --profile "$PROFILE"; RC=$?
  drop_dsns
  [ "$RC" = 0 ] || stop "the stage plan refused (exit $RC); nothing was written to the database" 6
  PLANOUT=$(ls -t "$RUNDIR"/plan-out-*.json | head -1); [ -f "$PLANOUT" ] || stop "no plan output" 6
  cp -n "$PLANOUT" "$RUNDIR/plan.json"; chmod 600 "$RUNDIR/plan.json"
  step "plan $S ($RUN): manifest"
  OPSCLI manifest-write --stage "$S" --run-dir "$RUNDIR" --capture-dir "$CAPDIR" --profile "$PROFILE" || stop "the manifest was refused" 6
  step "plan $S ($RUN): read-only state against the new plan (also re-verifies the plan digest)"
  load_dsns; OPSCLI run-tool --stage "$S" --phase state --run-dir "$RUNDIR" --capture-dir "$CAPDIR" --profile "$PROFILE" > "$RUNDIR/logs/post-plan-state.txt" 2>&1; cat "$RUNDIR/logs/post-plan-state.txt"; drop_dsns
  grep -q '^STATE BASELINE' "$RUNDIR/logs/post-plan-state.txt" || stop "the live database is not at the plan's baseline right after planning" 6
  OPSCLI plan-summary --stage "$S" --run-dir "$RUNDIR"
  echo "PLAN_COMPLETE stage=$S run=$RUN"
  ;;

approve)
  stage_arg "${3:-}"; run_arg "${4:-}"; DIGEST=${5:?plan digest}; STMT=${6:?statement file}; EXPIRES=${7:?expiry ISO}; NB=${8:-}
  need_checkout; not_accepted
  [ ! -e "$RUNDIR/approval.json" ] || stop "an approval already exists for this run" 3
  OPSCLI manifest-verify --stage "$S" --run-dir "$RUNDIR" --profile "$PROFILE" || stop "the prepared run no longer verifies; no approval written" 6
  if [ -n "$NB" ]; then OPSCLI approval-make --stage "$S" --run-dir "$RUNDIR" --digest "$DIGEST" --statement-file "$STMT" --expires "$EXPIRES" --not-before "$NB" || stop "approval refused" 6
  else OPSCLI approval-make --stage "$S" --run-dir "$RUNDIR" --digest "$DIGEST" --statement-file "$STMT" --expires "$EXPIRES" || stop "approval refused" 6; fi
  ;;

apply)
  stage_arg "${3:-}"; run_arg "${4:-}"; need_checkout
  step "apply $S ($RUN): wrapper gates (nothing is written by them)"
  not_accepted
  [ -f "$RUNDIR/approval.json" ] || stop "no owner approval: the owner has not approved this plan" 3
  [ ! -e "$RUNDIR/apply.lock" ] || stop "an apply was already started for this run ($(cat "$RUNDIR/apply.lock" 2>/dev/null)); the wrapper never retries. Use report/state" 22
  P=$(prev_stage "$S"); if [ -n "$P" ]; then [ -f "$OPS/accepted/$P.json" ] || stop "$P has not been accepted" 21; fi
  OPSCLI manifest-verify --stage "$S" --run-dir "$RUNDIR" --profile "$PROFILE" || stop "manifest verification failed" 6
  OPSCLI check-capture --stage "$S" --dir "$CAPDIR" --profile "$PROFILE" || stop "capture check failed" 6
  OPSCLI approval-check --stage "$S" --run-dir "$RUNDIR" || stop "approval check failed" 6
  no_conflicts
  stage_run_gate "$RUNDIR"
  echo "app: $(systemctl is-active afldb.service 2>/dev/null) MainPID=$(systemctl show afldb.service -p MainPID --value 2>/dev/null)" | tee "$RUNDIR/logs/app-before.txt"
  # one apply, ever: the lock is created exclusively BEFORE the detached run starts
  ( set -o noclobber; echo "started $(date -u +%FT%TZ) pid $$ by $(id -un)@$(hostname)" > "$RUNDIR/apply.lock" ) 2>/dev/null || stop "could not take the apply lock" 22
  export GAP029_APPLY_TOKEN="$RUN:$$"
  setsid nohup bash "$HERE/prod-stage.sh" __apply "$R" "$S" "$RUN" > "$RUNDIR/logs/apply-wrapper.log" 2>&1 < /dev/null &
  echo "apply launched detached (a dropped session does not stop it); waiting up to ${APPLY_WAIT_SECONDS:-1800} s for the recorded outcome"
  W=0; while [ ! -f "$RUNDIR/outcome.json" ] && [ "$W" -lt "${APPLY_WAIT_SECONDS:-1800}" ]; do sleep 2; W=$((W + 2)); done
  [ -f "$RUNDIR/outcome.json" ] || { echo "STILL RUNNING or unrecorded after ${W} s: run 'report' later; do NOT start another apply"; exit 23; }
  sleep 1; cat "$RUNDIR/logs/apply-wrapper.log"
  exit "$(exit_of "$RUNDIR/outcome.json")"
  ;;

__apply)   # internal: the detached run
  stage_arg "${3:-}"; run_arg "${4:-}"; need_checkout
  # Internal phase: only the `apply` phase of THIS run may start it, once. It runs none of the apply gates, so it refuses to start on its own.
  LOCKPID=$(sed -n 's/^.* pid \([0-9][0-9]*\) by .*$/\1/p' "$RUNDIR/apply.lock" 2>/dev/null)
  [ -n "$LOCKPID" ] && [ "${GAP029_APPLY_TOKEN:-}" = "$RUN:$LOCKPID" ] || stop "__apply is internal to the apply phase and cannot be started directly" 2
  [ ! -e "$RUNDIR/outcome.json" ] && ! ls "$RUNDIR"/logs/apply-[0-9]*.log >/dev/null 2>&1 || stop "this run already has an apply record; the wrapper never retries" 22
  step "apply $S ($RUN): tool apply (single attempt)"
  load_dsns
  OPSCLI run-tool --stage "$S" --phase apply --run-dir "$RUNDIR" --capture-dir "$CAPDIR" --profile "$PROFILE"; TOOLRC=$?
  APPLYLOG=$(ls -t "$RUNDIR"/logs/apply-[0-9]*.log 2>/dev/null | head -1)
  if [ -z "$APPLYLOG" ] || [ ! -f "$APPLYLOG" ]; then APPLYLOG="$RUNDIR/logs/apply-missing.log"; echo "the tool left no apply log (it refused before starting)" > "$APPLYLOG"; fi
  step "apply $S ($RUN): read-only post-run state probe"
  OPSCLI run-tool --stage "$S" --phase state --run-dir "$RUNDIR" --capture-dir "$CAPDIR" --profile "$PROFILE" > "$RUNDIR/logs/post-apply-state.txt" 2>&1; STRC=$?
  drop_dsns
  echo "tool exit $TOOLRC; state probe exit $STRC"
  step "apply $S ($RUN): outcome"
  OPSCLI outcome --stage "$S" --run-dir "$RUNDIR" --tool-log "$APPLYLOG" --tool-exit "$TOOLRC" --state-log "$RUNDIR/logs/post-apply-state.txt"
  exit $?
  ;;

report)
  stage_arg "${3:-}"; run_arg "${4:-}"; need_checkout
  if [ -f "$RUNDIR/outcome.json" ]; then
    echo "RECORDED OUTCOME:"; cat "$RUNDIR/outcome.json"; echo
    [ ! -f "$RUNDIR/logs/apply-wrapper.log" ] || tail -12 "$RUNDIR/logs/apply-wrapper.log"
    exit "$(exit_of "$RUNDIR/outcome.json")"
  fi
  if [ ! -f "$RUNDIR/apply.lock" ]; then echo "NO APPLY HAS BEEN STARTED for $RUN (no apply.lock)."; exit 0; fi
  if pgrep -f "prod-stage.sh __apply $R $S $RUN" >/dev/null; then echo "The detached apply is STILL RUNNING; poll 'report' again. Do not start another."; exit 23; fi
  echo "An apply was started ($(cat "$RUNDIR/apply.lock")), no outcome was recorded and the process is gone: treating as OUTCOME_UNDETERMINED."
  load_dsns; OPSCLI run-tool --stage "$S" --phase state --run-dir "$RUNDIR" --capture-dir "$CAPDIR" --profile "$PROFILE" > "$RUNDIR/logs/report-state.txt" 2>&1; drop_dsns
  : > "$RUNDIR/logs/report-empty.log"
  OPSCLI outcome --stage "$S" --run-dir "$RUNDIR" --tool-log "$RUNDIR/logs/report-empty.log" --tool-exit none --state-log "$RUNDIR/logs/report-state.txt"
  exit $?
  ;;

state)
  stage_arg "${3:-}"; run_arg "${4:-}"; need_checkout
  load_dsns; OPSCLI run-tool --stage "$S" --phase state --run-dir "$RUNDIR" --capture-dir "$CAPDIR" --profile "$PROFILE"; RC=$?; drop_dsns; exit $RC
  ;;

accept)
  stage_arg "${3:-}"; run_arg "${4:-}"; need_checkout
  [ -f "$RUNDIR/outcome.json" ] || stop "no recorded outcome for $RUN" 3
  OPSCLI manifest-verify --stage "$S" --run-dir "$RUNDIR" --profile "$PROFILE" || stop "the prepared run no longer verifies; nothing is accepted" 24
  CLASS=$(class_of "$RUNDIR/outcome.json"); [ -n "$CLASS" ] || stop "outcome.json is unreadable" 24
  case "$CLASS" in COMMITTED_VERIFIED|NOTHING_WRITTEN) ;; *) stop "outcome is $CLASS: acceptance requires COMMITTED_VERIFIED or NOTHING_WRITTEN" 24;; esac
  [ ! -e "$OPS/accepted/$S.json" ] || stop "$S is already accepted" 21
  load_dsns
  OPSCLI run-tool --stage "$S" --phase state --run-dir "$RUNDIR" --capture-dir "$CAPDIR" --profile "$PROFILE" > "$RUNDIR/logs/accept-state.txt" 2>&1; cat "$RUNDIR/logs/accept-state.txt"
  grep -q '^STATE PLANNED RESULT PRESENT' "$RUNDIR/logs/accept-state.txt" || { drop_dsns; stop "the live state is not the planned result" 24; }
  if [ "$S" = S3 ]; then
    OPSCLI run-tool --stage S3 --phase verify --run-dir "$RUNDIR" --capture-dir "$CAPDIR" --profile "$PROFILE" > "$RUNDIR/logs/accept-verify.txt" 2>&1 \
      || { cat "$RUNDIR/logs/accept-verify.txt"; drop_dsns; stop "S3 read-only verify failed" 24; }
    cat "$RUNDIR/logs/accept-verify.txt"
  fi
  drop_dsns
  OPSCLI accept-write --stage "$S" --run-dir "$RUNDIR" --accepted-dir "$OPS/accepted" || stop "could not record the acceptance" 24
  echo "ACCEPTED stage=$S run=$RUN"
  echo "ANALYZE is not run by this wrapper (no privilege grant is authorised); the stage tools and autovacuum own statistics."
  ;;

*) stop "unknown phase $PHASE" 2 ;;
esac
echo "== DONE $PHASE $(date -u +%FT%TZ)"
}
