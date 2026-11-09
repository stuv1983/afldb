#!/usr/bin/env bash
# AFLDB-ISSUE-341 / AFLDB-ISSUE-342: entry-point harness for
# tools/maintenance/restore-test.sh.
#
# The real script runs against a copy of itself in a disposable fake checkout,
# with psql and pg_restore replaced by stubs on PATH. No database is touched:
# the stubs model only what this harness needs -- which database a DSN would
# land in under libpq's rules (a `?dbname=` query overrides the URL path), the
# environment each child inherits, the statements each psql session receives,
# and pg_restore's exit status/log -- and record every invocation, so each case
# can assert what did and did NOT run.
#
#   bash tests/restore-test.test.sh
#
# Real-database qualification (two disposable databases with sentinels, and a
# fault-injected interrupted restore) is a separate, later step; see
# issues/open/AFLDB-ISSUE-341.md and AFLDB-ISSUE-342.md.
set -uo pipefail

TEST_DIR="${BASH_SOURCE[0]%/*}"
ROOT="$(cd "$TEST_DIR/.." && pwd -P)"
SCRIPT_SRC="$ROOT/tools/maintenance/restore-test.sh"

passed=0
failed=0
run_test() {
  local name="$1"; shift
  if "$@"; then echo "PASS: $name"; passed=$((passed + 1))
  else echo "FAIL: $name" >&2; failed=$((failed + 1)); fi
}
contains() { [[ "$1" == *"$2"* ]]; }

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

FAKE_SECRET='fake-s3cret'
GOOD_DSN="postgresql://afldb_owner:${FAKE_SECRET}%40x@localhost:5432/afldb_dev"

# One fresh fake checkout + stub bin per case.
setup_case() {
  CASE_DIR="$(mktemp -d "$SANDBOX/case.XXXXXX")"
  mkdir -p "$CASE_DIR/repo/tools/maintenance" "$CASE_DIR/bin" "$CASE_DIR/backups"
  cp "$SCRIPT_SRC" "$CASE_DIR/repo/tools/maintenance/restore-test.sh"
  printf 'dump bytes\n' > "$CASE_DIR/backups/afldb_dev-20261108-000000.dump"
  CALLS="$CASE_DIR/calls.log"
  : > "$CALLS"

  cat > "$CASE_DIR/bin/psql" <<'STUB'
#!/usr/bin/env bash
# Which database would libpq connect to? A query dbname overrides the path.
dsn=''
for a in "$@"; do case "$a" in postgres://*|postgresql://*) dsn="$a" ;; esac; done
q=''; [[ "$dsn" == *\?* ]] && q="${dsn#*\?}"
path="${dsn%%\?*}"; db="${path##*/}"
if [[ "$q" =~ (^|&)dbname=([^&]*) ]]; then db="${BASH_REMATCH[2]}"; fi
[[ -n "${STUB_FORCE_DB:-}" ]] && db="$STUB_FORCE_DB"
auth="${dsn#*://}"; auth="${auth%%@*}"; user="${auth%%:*}"
printf 'ARGV psql %s\n' "$*" >> "$STUB_CALLS"
printf 'ENV psql PGDATABASE=%s PGSERVICE=%s PGOPTIONS=%s PGHOST=%s PGHOSTADDR=%s pwmatch=%s\n' \
  "${PGDATABASE-<unset>}" "${PGSERVICE-<unset>}" "${PGOPTIONS-<unset>}" "${PGHOST-<unset>}" \
  "${PGHOSTADDR-<unset>}" "$([[ "${PGPASSWORD-}" == "${STUB_EXPECT_PASSWORD:-}" ]] && echo yes || echo no)" >> "$STUB_CALLS"
for a in "$@"; do
  if [[ "$a" == -tAc ]]; then echo "${STUB_PARITY:-42}"; printf 'PARITY db=%s\n' "$db" >> "$STUB_CALLS"; exit 0; fi
done
input="$(cat)"
if [[ "$input" =~ expected\ ([A-Za-z0-9_]+)\ as\ ([A-Za-z0-9_]+) ]]; then
  if [[ "$db" != "${BASH_REMATCH[1]}" || "$user" != "${BASH_REMATCH[2]}" ]]; then
    printf 'REFUSED identity db=%s user=%s\n' "$db" "$user" >> "$STUB_CALLS"
    echo "ERROR:  AFLDB restore target identity mismatch" >&2
    exit 3
  fi
  printf 'IDENTITY ok db=%s\n' "$db" >> "$STUB_CALLS"
fi
[[ "$input" == *"IS NULL"* ]] && printf 'WRITE comment-clear db=%s\n' "$db" >> "$STUB_CALLS"
[[ "$input" == *"DROP TABLE"* ]] && printf 'WRITE drop db=%s\n' "$db" >> "$STUB_CALLS"
[[ "$input" == *"afldb.restore_test.v1"* ]] && printf 'WRITE marker db=%s\n' "$db" >> "$STUB_CALLS"
exit 0
STUB

  cat > "$CASE_DIR/bin/pg_restore" <<'STUB'
#!/usr/bin/env bash
printf 'ARGV pg_restore %s\n' "$*" >> "$STUB_CALLS"
printf 'ENV pg_restore PGDATABASE=%s PGSERVICE=%s PGOPTIONS=%s\n' \
  "${PGDATABASE-<unset>}" "${PGSERVICE-<unset>}" "${PGOPTIONS-<unset>}" >> "$STUB_CALLS"
ext() {
  echo 'pg_restore: error: could not execute query: ERROR:  must be owner of extension pg_trgm'
  echo 'Command was: DROP EXTENSION IF EXISTS pg_trgm;'
  echo 'pg_restore: error: could not execute query: ERROR:  must be owner of extension unaccent'
  echo 'Command was: DROP EXTENSION IF EXISTS unaccent;'
}
case "${STUB_RESTORE:-ok}" in
  ok)               exit 0 ;;
  ext)              ext; echo 'pg_restore: warning: errors ignored on restore: 2'; exit 1 ;;
  kill)             exit 137 ;;
  ext_kill)         ext; exit 137 ;;
  empty1)           exit 1 ;;
  ext_no_summary)   ext; exit 1 ;;
  summary_mismatch) ext; echo 'pg_restore: warning: errors ignored on restore: 3'; exit 1 ;;
  missing)          exit 127 ;;
  unknown)          echo 'pg_restore: error: could not create index ix_x'; echo 'pg_restore: warning: errors ignored on restore: 1'; exit 1 ;;
  ok_with_errors)   ext; exit 0 ;;
esac
exit 99
STUB
  chmod +x "$CASE_DIR/bin/psql" "$CASE_DIR/bin/pg_restore"
}

# run_restore DSN [extra env assignments...] -- runs the copied script.
run_restore() {
  local dsn="$1"; shift
  OUTPUT="$(cd "$CASE_DIR" && env -i PATH="$CASE_DIR/bin:/usr/bin:/bin" HOME="$CASE_DIR" \
    STUB_CALLS="$CALLS" STUB_EXPECT_PASSWORD="${FAKE_SECRET}@x" \
    AFLDB_BACKUP_DIR="$CASE_DIR/backups" AFLDB_OWNER_DATABASE_URL="$dsn" "$@" \
    bash "$CASE_DIR/repo/tools/maintenance/restore-test.sh" 2>&1)"
  RC=$?
}

calls() { cat "$CALLS"; }
no_writes() { ! grep -q '^WRITE' "$CALLS" && ! grep -q '^ARGV pg_restore' "$CALLS"; }
no_marker() { ! grep -q '^WRITE marker' "$CALLS"; }
no_secret_in_argv_or_output() {
  ! grep '^ARGV' "$CALLS" | grep -q "$FAKE_SECRET" && ! contains "$OUTPUT" "$FAKE_SECRET"
}

# --- ISSUE-341: target identity ----------------------------------------------

test_standard_url_restores_only_the_disposable_target() {
  setup_case; run_restore "$GOOD_DSN"
  (( RC == 0 )) && contains "$OUTPUT" 'Restore verified' \
    && grep -q '^WRITE drop db=afldb_restore_test$' "$CALLS" \
    && grep -q '^WRITE marker db=afldb_restore_test$' "$CALLS" \
    && ! grep -q '^WRITE.*db=afldb_dev' "$CALLS" \
    && grep -q 'pwmatch=yes' "$CALLS" && ! grep -q 'pwmatch=no' "$CALLS" \
    && no_secret_in_argv_or_output
}

refusal_case() {
  local dsn="$1"
  setup_case; run_restore "$dsn"
  (( RC != 0 )) && contains "$OUTPUT" 'outside the restore connection contract' \
    && [[ ! -s "$CALLS" ]] && no_secret_in_argv_or_output
}
test_query_dbname_refused_before_any_child() {
  refusal_case "postgresql://afldb_owner:${FAKE_SECRET}@localhost:5432/afldb_dev?dbname=afldb_dev"
}
test_encoded_query_keyword_refused() {
  refusal_case "postgresql://afldb_owner:${FAKE_SECRET}@localhost:5432/afldb_dev?db%6Eame=afldb_dev"
}
test_service_query_refused() {
  refusal_case "postgresql://afldb_owner:${FAKE_SECRET}@localhost/afldb_dev?service=prod"
}
test_host_list_refused() {
  refusal_case "postgresql://afldb_owner:${FAKE_SECRET}@a:5432,b:5432/afldb_dev"
}
test_query_password_refused() {
  refusal_case "postgresql://afldb_owner@localhost/afldb_dev?password=${FAKE_SECRET}"
}
test_keyword_value_string_refused() {
  refusal_case "host=localhost dbname=afldb_dev user=afldb_owner password=${FAKE_SECRET}"
}
test_bad_percent_encoding_refused() {
  refusal_case "postgresql://afldb_owner:${FAKE_SECRET}%4@localhost/afldb_dev"
}

test_transport_option_still_accepted() {
  setup_case; run_restore "${GOOD_DSN}?sslmode=require&connect_timeout=5"
  (( RC == 0 )) && grep -q '^WRITE marker db=afldb_restore_test$' "$CALLS"
}

test_inherited_routing_env_neutralised() {
  setup_case
  run_restore "$GOOD_DSN" PGDATABASE=afldb_dev PGSERVICE=prod PGOPTIONS='-c search_path=x' \
    PGHOST=elsewhere PGHOSTADDR=10.0.0.9
  (( RC == 0 )) \
    && ! grep '^ENV' "$CALLS" | grep -vq 'PGDATABASE=<unset> PGSERVICE=<unset> PGOPTIONS=<unset>' \
    && ! grep '^ENV psql' "$CALLS" | grep -vq 'PGHOST=<unset> PGHOSTADDR=<unset>'
}

test_routing_env_from_dotenv_neutralised() {
  setup_case
  printf 'PGDATABASE=afldb_dev\nPGSERVICE=prod\n' > "$CASE_DIR/repo/.env"
  run_restore "$GOOD_DSN"
  (( RC == 0 )) && ! grep '^ENV' "$CALLS" | grep -vq 'PGDATABASE=<unset> PGSERVICE=<unset>'
}

test_connection_landing_elsewhere_refuses_before_writes() {
  # Whatever routes it (DNS, a pooler, a future libpq rule), a session that is
  # not afldb_restore_test as the expected role is refused before any write.
  setup_case; run_restore "$GOOD_DSN" STUB_FORCE_DB=afldb_dev
  (( RC != 0 )) && grep -q '^REFUSED identity db=afldb_dev' "$CALLS" && no_writes \
    && contains "$OUTPUT" 'Nothing has been changed'
}

test_same_source_and_target_refused() {
  setup_case; run_restore "postgresql://afldb_owner:${FAKE_SECRET}@localhost/afldb_restore_test"
  (( RC != 0 )) && contains "$OUTPUT" 'same database' && [[ ! -s "$CALLS" ]]
}

test_marker_and_drop_share_the_identity_session() {
  setup_case; run_restore "$GOOD_DSN"
  # Every WRITE line is preceded, within its own psql call, by IDENTITY ok.
  (( RC == 0 )) && awk '
    /^ARGV psql/ { ok = 0 }
    /^IDENTITY ok/ { ok = 1 }
    /^WRITE/ { if (!ok) bad = 1 }
    END { exit bad }' "$CALLS"
}

# --- ISSUE-342: completion classification -------------------------------------

restore_mode_fails() {
  local mode="$1" expect="$2"
  setup_case; run_restore "$GOOD_DSN" STUB_RESTORE="$mode"
  (( RC != 0 )) && no_marker && ! grep -q '^PARITY' "$CALLS" && contains "$OUTPUT" "$expect"
}
test_signal_exit_never_certified()        { restore_mode_fails kill 'terminated abnormally (exit status 137)'; }
test_signal_after_known_errors_refused()  { restore_mode_fails ext_kill 'terminated abnormally (exit status 137)'; }
test_empty_log_status1_refused()          { restore_mode_fails empty1 'exited 1 without completing'; }
test_known_errors_without_summary_refused() { restore_mode_fails ext_no_summary 'summary: absent'; }
test_summary_count_mismatch_refused()     { restore_mode_fails summary_mismatch 'summary: 3'; }
test_missing_binary_status_refused()      { restore_mode_fails missing 'exit status 127'; }
test_unknown_error_refused()              { restore_mode_fails unknown 'beyond the known extension-owner ones'; }
test_status0_with_error_lines_refused()   { restore_mode_fails ok_with_errors 'inconsistent result'; }

test_complete_restore_with_known_errors_certified() {
  setup_case; run_restore "$GOOD_DSN" STUB_RESTORE=ext
  (( RC == 0 )) && contains "$OUTPUT" 'ignoring only 2 extension-owner error(s)' \
    && grep -q '^WRITE marker db=afldb_restore_test$' "$CALLS"
}

test_parity_mismatch_still_withholds_marker() {
  setup_case
  # Source and restored values differ only by connection: make the stub
  # answer differently per database.
  sed -i 's/echo "${STUB_PARITY:-42}"/[[ "$db" == afldb_restore_test ]] \&\& echo 41 || echo 42/' "$CASE_DIR/bin/psql"
  run_restore "$GOOD_DSN"
  (( RC != 0 )) && no_marker && contains "$OUTPUT" 'RESTORE VERIFICATION FAILED'
}

for t in $(declare -F | awk '{print $3}' | grep '^test_'); do
  run_test "$t" "$t"
done

echo "restore-test harness: ${passed} passed, ${failed} failed"
(( failed == 0 ))
