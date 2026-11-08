#!/usr/bin/env bash
set -uo pipefail

TEST_DIR="${BASH_SOURCE[0]%/*}"
ROOT="$(cd "$TEST_DIR/.." && pwd -P)"
# shellcheck source=../deploy/sync-dev-remote.sh
. "$ROOT/deploy/sync-dev-remote.sh"

passed=0
failed=0

run_test() {
  local name="$1"
  shift
  if "$@"; then
    echo "PASS: $name"
    passed=$((passed + 1))
  else
    echo "FAIL: $name" >&2
    failed=$((failed + 1))
  fi
}

contains() {
  [[ "$1" == *"$2"* ]]
}

run_dirty_case() {
  local porcelain="$1"
  local allow_dirty="$2"
  git() {
    [[ "$*" == 'status --porcelain=v1 -z --untracked-files=normal' ]] || return 99
    printf '%b' "$porcelain"
  }
  afldb_classify_worktree "$allow_dirty"
}

test_clean_tree() {
  local output rc
  output="$(run_dirty_case '' 0 2>&1)"; rc=$?
  (( rc == 0 )) && contains "$output" 'tracked modifications: 0' \
    && contains "$output" 'known operational untracked: 0' \
    && contains "$output" 'unknown untracked: 0'
}

test_tracked_modification_blocks() {
  local output rc
  output="$(run_dirty_case ' M docs/deployment.md\0' 0 2>&1)"; rc=$?
  (( rc == 20 )) && contains "$output" 'tracked modifications: 1' \
    && contains "$output" 'docs/deployment.md'
}

test_staged_and_renamed_changes_block() {
  local output rc
  output="$(run_dirty_case 'M  deploy/sync-dev.ps1\0R  renamed.ps1\0original.ps1\0' 0 2>&1)"; rc=$?
  (( rc == 20 )) && contains "$output" 'tracked modifications: 2' \
    && contains "$output" 'original.ps1 -> renamed.ps1'
}

test_known_operational_artifacts_continue() {
  local input output rc
  input='?? .deploy-backups/\0?? .env.bak-issue139-20260906-120000\0?? FETCH_HEAD\0'
  input+='?? docs/rebuild-manifests/afltables_fitzroy_core/settle-2026-2026-09-06-1634.json\0'
  input+='?? afldb-ui-questions-5001-pressure-20260822.WRONG.csv\0'
  output="$(run_dirty_case "$input" 0 2>&1)"; rc=$?
  (( rc == 0 )) && contains "$output" 'known operational untracked: 5' \
    && contains "$output" 'known operational artifact path(s) (preserved):' \
    && contains "$output" '.deploy-backups/' \
    && contains "$output" '.env.bak-issue139-20260906-120000' \
    && contains "$output" 'FETCH_HEAD' \
    && contains "$output" 'settle-2026-2026-09-06-1634.json' \
    && contains "$output" 'afldb-ui-questions-5001-pressure-20260822.WRONG.csv'
}

test_unknown_untracked_blocks() {
  local output rc
  output="$(run_dirty_case '?? src/unreviewed.ts\0' 0 2>&1)"; rc=$?
  (( rc == 20 )) && contains "$output" 'unknown untracked: 1' \
    && contains "$output" 'src/unreviewed.ts'
}

test_known_and_unknown_mixture_blocks() {
  local output rc
  output="$(run_dirty_case '?? .env.bak-20260906\0?? config-surprise.json\0' 0 2>&1)"; rc=$?
  (( rc == 20 )) && contains "$output" 'known operational untracked: 1' \
    && contains "$output" 'unknown untracked: 1'
}

test_allow_dirty_is_explicit() {
  local output rc
  output="$(run_dirty_case ' M tracked.ts\0?? unknown.sh\0' 1 2>&1)"; rc=$?
  (( rc == 0 )) && contains "$output" '-AllowDirtyServer explicitly bypasses 2 blocker(s)' \
    && contains "$output" 'tracked.ts' && contains "$output" 'unknown.sh'
}

test_allowlist_is_narrow() {
  ! afldb_is_known_operational_artifact '.env' \
    && ! afldb_is_known_operational_artifact 'docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260906.json' \
    && ! afldb_is_known_operational_artifact 'random.csv' \
    && ! afldb_is_known_operational_artifact 'src/afldb-ui-questions-hidden.csv'
}

active_service() {
  if [[ "$*" == *ActiveState* ]]; then printf 'active\n'; else printf 'running\n'; fi
}

test_immediate_healthy() (
  afldb_set_now_seconds() { AFLDB_NOW_SECONDS=100; }
  afldb_health_probe() {
    AFLDB_LAST_PROBE_BODY='{"status":"ok","database":"ok","latencyMs":1}'
    AFLDB_LAST_PROBE_ERROR=''
    return 0
  }
  systemctl() { active_service "$@"; }
  afldb_readiness_diagnostics() { echo 'unexpected diagnostics'; return 99; }
  local output rc
  output="$(afldb_wait_for_readiness afldb http://127.0.0.1:3100/api/health 120 2 '' 2>&1)"; rc=$?
  (( rc == 0 )) && contains "$output" 'health ready after 0s and 1 probe(s)' \
    && ! contains "$output" 'unexpected diagnostics'
)

test_transient_connection_then_healthy() (
  local probe_count=0 now=98
  afldb_set_now_seconds() { now=$((now + 2)); AFLDB_NOW_SECONDS="$now"; }
  afldb_health_probe() {
    probe_count=$((probe_count + 1))
    if (( probe_count < 3 )); then
      AFLDB_LAST_HTTP_STATUS='000'
      AFLDB_LAST_PROBE_KIND='connection'
      AFLDB_LAST_PROBE_ERROR='curl exit 7: connection refused'
      return 1
    fi
    AFLDB_LAST_PROBE_BODY='{"status":"ok","database":"ok","latencyMs":25}'
    AFLDB_LAST_PROBE_ERROR=''
    return 0
  }
  systemctl() { active_service "$@"; }
  sleep() { :; }
  local output rc
  output="$(afldb_wait_for_readiness afldb http://127.0.0.1:3100/api/health 120 2 '' 2>&1)"; rc=$?
  (( rc == 0 )) && contains "$output" '3 probe(s)' \
    && contains "$output" 'connection refused'
)

test_service_failed_stops_early() (
  local now=100
  afldb_set_now_seconds() { AFLDB_NOW_SECONDS="$now"; now=$((now + 1)); }
  afldb_health_probe() {
    AFLDB_LAST_HTTP_STATUS='000'; AFLDB_LAST_PROBE_KIND='connection'
    AFLDB_LAST_PROBE_ERROR='curl exit 7: connection refused'; return 1
  }
  systemctl() { if [[ "$*" == *ActiveState* ]]; then echo failed; else echo dead; fi; }
  afldb_readiness_diagnostics() { echo "DIAGNOSTICS:$4"; }
  sleep() { echo 'unexpected sleep'; return 99; }
  local output rc
  output="$(afldb_wait_for_readiness afldb http://127.0.0.1:3100/api/health 120 2 '' 2>&1)"; rc=$?
  (( rc == 26 )) && contains "$output" 'DIAGNOSTICS:systemd reports ActiveState=failed SubState=dead' \
    && ! contains "$output" 'unexpected sleep'
)

test_timeout_and_diagnostics() (
  local now=95
  afldb_set_now_seconds() { now=$((now + 5)); AFLDB_NOW_SECONDS="$now"; }
  afldb_health_probe() {
    AFLDB_LAST_HTTP_STATUS='503'; AFLDB_LAST_PROBE_KIND='http'
    AFLDB_LAST_PROBE_ERROR='HTTP 503; body={"status":"error","database":"unreachable"}'
    return 1
  }
  systemctl() { active_service "$@"; }
  afldb_readiness_diagnostics() { echo "DIAGNOSTICS:$4"; }
  sleep() { :; }
  local output rc
  output="$(afldb_wait_for_readiness afldb http://127.0.0.1:3100/api/health 10 2 '' 2>&1)"; rc=$?
  (( rc == 27 )) && contains "$output" 'DIAGNOSTICS:health contract did not become ready within 10s'
)

test_unhealthy_payload_is_not_ready() {
  local rc
  afldb_health_response_is_ready 200 '{"status":"error","database":"unreachable"}' '' '' >/dev/null 2>&1
  rc=$?
  (( rc != 0 )) && [[ "$AFLDB_LAST_PROBE_KIND" == payload ]] \
    && contains "$AFLDB_LAST_PROBE_ERROR" 'unexpected health payload'
}

test_expected_build_contract() {
  local healthy='{"status":"ok","database":"ok","latencyMs":1}'
  afldb_health_response_is_ready 200 "$healthy" 'build-2' 'build-2' \
    && ! afldb_health_response_is_ready 200 "$healthy" 'build-1' 'build-2' \
    && [[ "$AFLDB_LAST_PROBE_KIND" == build-mismatch ]]
}

test_curl_probe_connection_reset() (
  curl() {
    printf '000'
    echo 'curl: (56) Recv failure: Connection reset by peer' >&2
    return 56
  }
  local rc
  afldb_health_probe http://127.0.0.1:3100/api/health '' >/dev/null 2>&1
  rc=$?
  (( rc != 0 )) && [[ "$AFLDB_LAST_HTTP_STATUS" == 000 ]] \
    && [[ "$AFLDB_LAST_PROBE_KIND" == connection ]] \
    && contains "$AFLDB_LAST_PROBE_ERROR" 'Connection reset by peer'
)

test_curl_probe_healthy_with_build() (
  curl() {
    local header_file='' body_file=''
    while (( $# > 0 )); do
      case "$1" in
        --dump-header) header_file="$2"; shift 2 ;;
        --output) body_file="$2"; shift 2 ;;
        --write-out|--connect-timeout|--max-time) shift 2 ;;
        *) shift ;;
      esac
    done
    printf 'HTTP/1.1 200 OK\r\nx-afldb-build: build-2\r\n\r\n' > "$header_file"
    printf '{"status":"ok","database":"ok","latencyMs":25}' > "$body_file"
    printf '200'
  }
  afldb_health_probe http://127.0.0.1:3100/api/health build-2 \
    && [[ "$AFLDB_LAST_HTTP_STATUS" == 200 ]] \
    && [[ "$AFLDB_LAST_PROBE_KIND" == healthy ]] \
    && contains "$AFLDB_LAST_PROBE_BODY" '"database":"ok"'
)

test_diagnostics_are_bounded() {
  local output
  AFLDB_LAST_HTTP_STATUS=000
  AFLDB_LAST_PROBE_KIND=connection
  AFLDB_LAST_PROBE_ERROR='connection refused'
  systemctl() { echo 'mock systemctl'; return 3; }
  journalctl() { echo 'mock journal'; }
  command() { return 1; }
  output="$(afldb_readiness_diagnostics afldb http://127.0.0.1:3100/api/health 120 timeout 2>&1)"
  contains "$output" 'systemctl status (20 lines)' \
    && contains "$output" 'recent journal (40 lines)' \
    && contains "$output" 'listener check (:3100)' \
    && contains "$output" 'last health probe: status=000'
}

test_no_repository_cleanup_commands() {
  local classifier
  classifier="$(declare -f afldb_classify_worktree)"
  [[ "$classifier" != *'git clean'* && "$classifier" != *'git reset'* \
    && "$classifier" != *'.deploy-backups'* && "$classifier" != *'docs/rebuild-manifests'* ]]
}

# --- AFLDB-ISSUE-336: pinned deploy (afldb_checkout_pinned_revision) on real throwaway repositories ---
# origin/main: A -> B -> C. The working clone's `dev` branch tracks origin/main and starts at A.
PIN_ROOT=''
pin_setup() {
  PIN_ROOT="$(mktemp -d)"
  (
    unset -f git command 2>/dev/null
    set -e
    export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
    git init -q --bare "$PIN_ROOT/origin.git"
    git init -q -b main "$PIN_ROOT/seed"
    for c in A B C; do echo "$c" > "$PIN_ROOT/seed/f"; git -C "$PIN_ROOT/seed" add f; git -C "$PIN_ROOT/seed" commit -qm "$c"; done
    git -C "$PIN_ROOT/seed" push -q "$PIN_ROOT/origin.git" main
    git clone -q "$PIN_ROOT/origin.git" "$PIN_ROOT/work"
    git -C "$PIN_ROOT/work" switch -q --create dev "$(git -C "$PIN_ROOT/seed" rev-parse HEAD~2)"
    git -C "$PIN_ROOT/work" branch -q --set-upstream-to=origin/main dev
  )
}
pin_rev() { (unset -f git; git -C "$PIN_ROOT/seed" rev-parse "$1"); }
pin_run() { (unset -f git command 2>/dev/null; cd "$PIN_ROOT/work" && afldb_checkout_pinned_revision "$1"); }
pin_head() { (unset -f git; git -C "$PIN_ROOT/work" rev-parse HEAD); }
pin_teardown() { rm -rf -- "$PIN_ROOT"; }

test_pin_fast_forwards_to_exactly_the_pin_not_the_tip() {
  local out rc b ok=1
  pin_setup; b="$(pin_rev HEAD~1)"
  out="$(pin_run "$b" 2>&1)"; rc=$?
  (( rc == 0 )) && [[ "$(pin_head)" == "$b" ]] && contains "$out" "pinned revision: dev at $b" && ok=0
  pin_teardown; return $ok
}

test_pin_already_current_is_a_no_op() {
  local rc a ok=1
  pin_setup; a="$(pin_rev HEAD~2)"
  pin_run "$a" >/dev/null 2>&1; rc=$?
  (( rc == 0 )) && [[ "$(pin_head)" == "$a" ]] && ok=0
  pin_teardown; return $ok
}

test_pin_refuses_short_or_malformed_ids() {
  local out rc a ok=1
  pin_setup; a="$(pin_rev HEAD~2)"
  out="$(pin_run "${a:0:12}" 2>&1)"; rc=$?
  (( rc == 30 )) && contains "$out" 'full 40-character' && [[ "$(pin_head)" == "$a" ]] && ok=0
  pin_teardown; return $ok
}

test_pin_refuses_detached_head() {
  local rc a ok=1
  pin_setup; a="$(pin_rev HEAD~2)"
  (unset -f git; git -C "$PIN_ROOT/work" switch -q --detach "$a")
  pin_run "$(pin_rev HEAD)" >/dev/null 2>&1; rc=$?
  (( rc == 31 )) && [[ "$(pin_head)" == "$a" ]] && ok=0
  pin_teardown; return $ok
}

test_pin_refuses_unpublished_commit() {
  local rc a local_only ok=1
  pin_setup; a="$(pin_rev HEAD~2)"
  # A commit that exists in the clone but is not on origin/main.
  local_only="$(unset -f git; cd "$PIN_ROOT/work" && git -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m local && git rev-parse HEAD)"
  (unset -f git; git -C "$PIN_ROOT/work" switch -q --create other "$a" && git -C "$PIN_ROOT/work" branch -q --set-upstream-to=origin/main other)
  pin_run "$local_only" >/dev/null 2>&1; rc=$?
  (( rc == 34 )) && [[ "$(pin_head)" == "$a" ]] && ok=0
  pin_teardown; return $ok
}

test_pin_refuses_diverged_branch_without_rewriting_it() {
  local rc before ok=1
  pin_setup
  before="$(unset -f git; cd "$PIN_ROOT/work" && git -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m dev-only && git rev-parse HEAD)"
  pin_run "$(pin_rev HEAD)" >/dev/null 2>&1; rc=$?
  (( rc == 35 )) && [[ "$(pin_head)" == "$before" ]] && ok=0
  pin_teardown; return $ok
}

test_pin_refuses_branch_without_upstream() {
  local rc a ok=1
  pin_setup; a="$(pin_rev HEAD~2)"
  (unset -f git; git -C "$PIN_ROOT/work" branch -q --unset-upstream dev)
  pin_run "$(pin_rev HEAD)" >/dev/null 2>&1; rc=$?
  (( rc == 33 )) && [[ "$(pin_head)" == "$a" ]] && ok=0
  pin_teardown; return $ok
}

test_pin_helper_never_resets_or_cleans() {
  local body
  body="$(declare -f afldb_checkout_pinned_revision)"
  [[ "$body" != *'git reset'* && "$body" != *'git clean'* && "$body" != *'git checkout'* \
    && "$body" != *'git pull'* && "$body" != *'--force'* ]]
}

run_test 'clean tree continues' test_clean_tree
run_test 'tracked modification blocks' test_tracked_modification_blocks
run_test 'staged and renamed changes block' test_staged_and_renamed_changes_block
run_test 'known operational artifacts warn and continue' test_known_operational_artifacts_continue
run_test 'unknown untracked file blocks' test_unknown_untracked_blocks
run_test 'known plus unknown mixture blocks' test_known_and_unknown_mixture_blocks
run_test 'AllowDirtyServer bypass is explicit' test_allow_dirty_is_explicit
run_test 'operational allowlist is narrow' test_allowlist_is_narrow
run_test 'immediate healthy readiness succeeds' test_immediate_healthy
run_test 'transient connection refusal then healthy succeeds' test_transient_connection_then_healthy
run_test 'failed service stops readiness early' test_service_failed_stops_early
run_test 'readiness timeout fails with diagnostics' test_timeout_and_diagnostics
run_test 'unhealthy HTTP 200 payload is refused' test_unhealthy_payload_is_not_ready
run_test 'expected build identity remains enforced' test_expected_build_contract
run_test 'curl connection reset is a retryable probe failure' test_curl_probe_connection_reset
run_test 'curl probe validates healthy JSON and build header' test_curl_probe_healthy_with_build
run_test 'failure diagnostics are bounded and actionable' test_diagnostics_are_bounded
run_test 'classification performs no repository cleanup' test_no_repository_cleanup_commands
run_test 'pin fast-forwards to exactly the pin, not the upstream tip' test_pin_fast_forwards_to_exactly_the_pin_not_the_tip
run_test 'pin already current is a no-op' test_pin_already_current_is_a_no_op
run_test 'pin refuses a short or malformed id' test_pin_refuses_short_or_malformed_ids
run_test 'pin refuses a detached HEAD' test_pin_refuses_detached_head
run_test 'pin refuses an unpublished commit' test_pin_refuses_unpublished_commit
run_test 'pin refuses a diverged branch without rewriting it' test_pin_refuses_diverged_branch_without_rewriting_it
run_test 'pin refuses a branch without an upstream' test_pin_refuses_branch_without_upstream
run_test 'pin helper never resets, cleans, checks out or pulls' test_pin_helper_never_resets_or_cleans

# --- AFLDB-ISSUE-339: deploy gate helpers ---
test_gate_branch_collision_dev_vs_dev_slash() {
  local root out ok=1
  root="$(mktemp -d)"
  (unset -f git; cd "$root" && git init -q -b main && git -c user.name=t -c user.email=t@e.invalid commit -q --allow-empty -m a && git branch dev)
  out="$(cd "$root" && afldb_pf_branch_collisions 'dev/v2-main')"
  [[ "$out" == 'dev ' ]] && [[ -z "$(cd "$root" && afldb_pf_branch_collisions 'dev-v2-main')" ]] && ok=0
  rm -rf -- "$root"; return $ok
}

test_gate_ledger_accepts_crlf_checksum_and_refuses_drift() {
  local root rev ledger lf crlf ok=1
  root="$(mktemp -d)"; ledger="$root/ledger"
  rev="$(unset -f git; cd "$root" && git init -q -b main && mkdir -p src/db/migrations \
    && printf 'select 1;\nselect 2;\n' > src/db/migrations/001_a.sql && printf 'select 3;\n' > src/db/migrations/002_b.sql \
    && git add . && git -c user.name=t -c user.email=t@e.invalid commit -q -m a && git rev-parse HEAD)"
  crlf="$(printf 'select 1;\r\nselect 2;\r\n' | sha256sum | cut -d' ' -f1)"
  printf '001_a.sql %s\n' "$crlf" > "$ledger"
  (cd "$root" && afldb_pf_compare_ledger "$rev" "$ledger"
   (( ${#AFLDB_PF_LEDGER_PROBLEMS[@]} == 0 && AFLDB_PF_APPLIED_N == 1 && AFLDB_PF_TARGET_M == 2 )) && [[ "$AFLDB_PF_PENDING" == '002_b.sql ' ]]) || { rm -rf -- "$root"; return 1; }
  printf '001_a.sql %s\n' "$(printf 'edited;\n' | sha256sum | cut -d' ' -f1)" > "$ledger"
  (cd "$root" && afldb_pf_compare_ledger "$rev" "$ledger"; [[ "${AFLDB_PF_LEDGER_PROBLEMS[0]}" == *'checksum differs'* ]]) || { rm -rf -- "$root"; return 1; }
  lf="$(printf 'select 3;\n' | sha256sum | cut -d' ' -f1)"
  printf '002_b.sql %s\n' "$lf" > "$ledger"
  (cd "$root" && afldb_pf_compare_ledger "$rev" "$ledger"; [[ "${AFLDB_PF_LEDGER_PROBLEMS[0]}" == *'not migration #1'* ]]) && ok=0
  rm -rf -- "$root"; return $ok
}

test_gate_env_presence_never_prints_values() {
  local root out ok=1
  root="$(mktemp -d)"
  printf 'AFLDB_SESSION_SECRET="s3cr3t-value"\nEMPTY=\n' > "$root/.env"
  out="$(cd "$root" && { afldb_pf_env_has AFLDB_SESSION_SECRET && echo has; afldb_pf_env_has EMPTY || echo empty; afldb_pf_env_has MISSING || echo missing; })"
  [[ "$out" == $'has\nempty\nmissing' && "$out" != *s3cr3t* ]] && [[ "$(cd "$root" && afldb_pf_env_value AFLDB_SESSION_SECRET)" == 's3cr3t-value' ]] && ok=0
  rm -rf -- "$root"; return $ok
}

test_gate_window_states() {
  local out
  out="$(AFLDB_PF_FAILS=0 AFLDB_PF_PREPS=0 AFLDB_PF_NOW=1000 AFLDB_PF_WINDOW_START='' AFLDB_PF_WINDOW_END='' afldb_pf_window_check)"
  [[ "$out" == *'PREP approval window'* ]] || return 1
  out="$(AFLDB_PF_NOW=1000 AFLDB_PF_WINDOW_START=100 AFLDB_PF_WINDOW_END=900 afldb_pf_window_check)"
  [[ "$out" == *'FAIL approval window -- ended'* ]] || return 1
  out="$(AFLDB_PF_NOW=1000 AFLDB_PF_WINDOW_START=100 AFLDB_PF_WINDOW_END=200000 afldb_pf_window_check)"
  [[ "$out" == *'FAIL approval window -- empty, inverted or longer'* ]] || return 1
  out="$(AFLDB_PF_NOW=1000 AFLDB_PF_WINDOW_START=2000 AFLDB_PF_WINDOW_END=3000 afldb_pf_window_check)"
  [[ "$out" == *'PREP approval window -- opens'* ]] || return 1
  out="$(AFLDB_PF_NOW=1000 AFLDB_PF_WINDOW_START=500 AFLDB_PF_WINDOW_END=3000 afldb_pf_window_check)"
  [[ "$out" == *'PASS approval window'* ]]
}

# --- AFLDB-ISSUE-339: the real generated payload, end to end, against a throwaway repository ---
# SYNC_DEV_GENERATED_DIR holds gen-execute.sh and gen-assess.sh, written by
#   tests/sync-dev-static.test.ps1 -ExportDir <dir>
# Values are substituted line by line (AFLDB_PF_*=...), exactly as -Param values would be generated.
E2E=''
e2e_setup() {
  E2E="$(mktemp -d)"
  local stubs="$E2E/stubs"
  mkdir -p "$stubs" "$E2E/evidence" "$E2E/backup"
  (
    unset -f git command 2>/dev/null
    set -e
    export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@e.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@e.invalid
    export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=false
    git init -q --bare -b main "$E2E/origin.git"
    git init -q -b main "$E2E/seed"
    cd "$E2E/seed"
    mkdir -p src/db/migrations docs/rebuild-manifests/afltables_fitzroy_core
    printf '.next/\n.env\n' > .gitignore
    : > docs/rebuild-manifests/afltables_fitzroy_core/.gitkeep
    printf 'create table a();\n' > src/db/migrations/001_a.sql
    printf 'create table b();\n' > src/db/migrations/002_b.sql
    git add . && git commit -qm A
    printf 'create table c();\n' > src/db/migrations/003_c.sql
    git add . && git commit -qm B
    echo tip > tip.txt && git add . && git commit -qm C
    git push -q "$E2E/origin.git" main
    git clone -q "$E2E/origin.git" "$E2E/work"
    cd "$E2E/work"
    git switch -q --create dev-v2-main HEAD~2 && git branch -q --set-upstream-to=origin/main dev-v2-main
    git switch -q main && git reset -q --hard HEAD~2 && git commit -q --allow-empty -m dev-only-main
    git switch -q dev-v2-main
    echo stash-me > stash.txt && git add stash.txt && git stash -q && test "$(git stash list | wc -l)" = 1
    mkdir -p docs/rebuild-manifests/afltables_fitzroy_core .next/standalone/.next
    echo '{}' > docs/rebuild-manifests/afltables_fitzroy_core/settle-2026-test.json
    printf 'DATABASE_URL=x\nAFLDB_OWNER_DATABASE_URL=postgres://u:p@h/afldb_dev\n' > .env
    echo OLDBUILD > .next/standalone/.next/BUILD_ID
    tar -cf "$E2E/backup/app.tar" .next/standalone/.next/BUILD_ID
    (cd "$E2E/backup" && sha256sum app.tar > SHA256SUMS-app)
  )
  local lf1 lf2 now
  lf1="$(printf 'create table a();\n' | sha256sum | cut -d' ' -f1)"
  lf2="$(printf 'create table b();\n' | sha256sum | cut -d' ' -f1)"
  printf '001_a.sql %s\n002_b.sql %s\n' "$lf1" "$lf2" > "$E2E/ledger"
  now="$(date +%s)"
  echo dump > "$E2E/backup/db.dump"
  (cd "$E2E/backup" && sha256sum db.dump > SHA256SUMS && echo 'pg_restore exit=0 seconds=1' > verify-restore.txt)
  local stamp; stamp="$(date -u -d "@$((now - 3600))" +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"label":"live","database":"afldb_dev","readAt":"%s","ledger":{"n":2,"last":"002_b.sql"},"counts":{"t":1}}\n' "$stamp" > "$E2E/backup/live-counts.json"
  printf '{"label":"restored","database":"afldb_v2_x_test","readAt":"%s","ledger":{"n":2,"last":"002_b.sql"},"counts":{"t":1}}\n' "$stamp" > "$E2E/backup/restored-counts.json"
  sleep 600 & E2E_VICTIM=$!
  echo "$E2E_VICTIM" > "$E2E/victim"
  cat > "$stubs/hostname" <<'S'
#!/usr/bin/env bash
echo "${STUB_HOST:-streamanator}"
S
  cat > "$stubs/psql" <<'S'
#!/usr/bin/env bash
echo "psql $*" | sed 's#postgres://[^ ]*#<dsn>#' >> "$E2E/calls"
for a in "$@"; do last="$a"; done
case "$last" in
  *current_database*) echo "${STUB_DB:-afldb_dev} arm" ;;
  *schema_migrations*) cat "$E2E/ledger" ;;
  *) exit 3 ;;
esac
S
  cat > "$stubs/npm" <<'S'
#!/usr/bin/env bash
echo "npm $*" >> "$E2E/calls"
case "$*" in
  --version) echo 10.0.0 ;;
  'run db:migrate'*)
    # AFLDB-ISSUE-339 R339-A: model tools/db/migrate.ts's own target resolution (flag, then
    # exported AFLDB_MIGRATE_TARGET, then .env's, default dev) and record what the child saw.
    flag=''; [[ "$*" =~ --target\ ([a-z-]+) ]] && flag="${BASH_REMATCH[1]}"
    envt="${AFLDB_MIGRATE_TARGET:-$(sed -n 's/^AFLDB_MIGRATE_TARGET=//p' .env | head -1)}"
    echo "MIGRATE_CHILD args=[$*] exported_target=${AFLDB_MIGRATE_TARGET-<unset>} exported_owner_dsn=${AFLDB_OWNER_DATABASE_URL+set}" >> "$E2E/calls"
    if [[ -n "$flag" && -n "$envt" && "$flag" != "$envt" ]]; then echo 'targets disagree' >&2; exit 1; fi
    if [[ "${flag:-${envt:-dev}}" != dev ]]; then echo "MIGRATE_CHILD would write ${flag:-$envt}" >> "$E2E/calls"; exit 0; fi
    have="$(wc -l < "$E2E/ledger")"
    i=0
    for f in $(ls src/db/migrations | LC_ALL=C sort); do
      i=$((i + 1)); (( i <= have )) && continue
      if [[ -n "${STUB_MIGRATE_BAD:-}" ]]; then sum=deadbeef; else sum="$(sha256sum < "src/db/migrations/$f" | cut -d' ' -f1)"; fi
      echo "$f $sum" >> "$E2E/ledger"
    done ;;
  'run build') echo NEWBUILD > .next/standalone/.next/BUILD_ID ;;
esac
S
  cat > "$stubs/systemctl" <<'S'
#!/usr/bin/env bash
echo "systemctl $*" >> "$E2E/calls"
victim="$(cat "$E2E/victim")"
case "$*" in
  *'list-units'*) [[ -n "${STUB_RUNNING:-}" ]] && echo "$STUB_RUNNING loaded active running x" ;;
  *ExecStart*) echo "{ path=$(command -v node) ; argv[]=node deploy/server-cluster.mjs ; }" ;;
  *NextElapseUSecRealtime*) echo "${STUB_TIMER_NEXT:-}" ;;
  *ExecMainStartTimestamp*) echo "${STUB_WRITER_START:-}" ;;
  *'--property Restart '*) echo always ;;
  *MainPID*) if kill -0 "$victim" 2>/dev/null; then echo "$victim"; else echo 4242; fi ;;
  *ActiveState*) echo active ;;
  *SubState*) echo running ;;
  'is-active'*) echo active ;;
esac
exit 0
S
  cat > "$stubs/curl" <<'S'
#!/usr/bin/env bash
out=''; while (( $# )); do case "$1" in --output) out="$2"; shift ;; esac; shift; done
printf '{"status":"ok","database":"ok"}' > "$out"; printf 200
S
  chmod +x "$stubs"/*
}
e2e_teardown() {
  kill "$(cat "$E2E/victim")" 2>/dev/null || true
  rm -rf -- "$E2E"; E2E=''
}
e2e_pin() { (unset -f git; git -C "$E2E/seed" rev-parse HEAD~1); }
# e2e_run <gen file> [NAME=value ...]: run the generated payload with values substituted.
e2e_run() {
  local gen="$1" script="$E2E/run.sh" now kv name value
  shift
  now="$(date +%s)"
  sed -e "s#/__PROJECT__#$E2E/work#g" "$gen" > "$script"
  for kv in "AFLDB_PF_EXPECTED_REVISION=$(e2e_pin)" "AFLDB_PF_EXPECTED_ORIGIN=$E2E/origin.git" \
            "AFLDB_PF_WINDOW_START=$((now - 600))" "AFLDB_PF_WINDOW_END=$((now + 3600))" \
            'AFLDB_PF_ACCEPTANCE=ok:200' "AFLDB_PF_EVIDENCE_DIR=$E2E/evidence" "AFLDB_PF_BACKUP_DIR=$E2E/backup" \
            "AFLDB_PF_ARTIFACT=$E2E/backup/app.tar" 'AFLDB_PF_MIN_FREE_GIB=0' 'AFLDB_PF_MIN_MEM_MIB=0' \
            'AFLDB_PF_REQUIRED_CONFIG=DATABASE_URL AFLDB_OWNER_DATABASE_URL' 'AFLDB_PF_LEDGER_BEFORE=2' 'AFLDB_PF_LEDGER_AFTER=3' "$@"; do
    name="${kv%%=*}"; value="${kv#*=}"
    sed -i -e "s#^${name}=.*\$#${name}='${value}'#" "$script"
  done
  if ! grep -q '^MemAvailable:' /proc/meminfo 2>/dev/null; then
    # Test-only: hosts without MemAvailable (MSYS) get a fixture; the deploy payload unsets this hook.
    echo 'MemAvailable: 4194304 kB' > "$E2E/meminfo"
    sed -i "s#^unset AFLDB_PF_NOW AFLDB_PF_MEMINFO\$#AFLDB_PF_MEMINFO='$E2E/meminfo'#" "$script"
  fi
  (unset -f git command 2>/dev/null; export E2E NVM_DIR="$E2E/no-nvm"; PATH="$E2E/stubs:$(e2e_node_dir):$PATH" bash "$script" > "$E2E/out" 2>&1)
}
# A Node >= 20 for the payload's floor check, with the payload's nvm step neutralised (NVM_DIR) so
# the stubs stay first on PATH.
e2e_node_dir() {
  local d best=''
  for d in "$(dirname "$(command -v node)")" "$HOME"/.nvm/versions/node/*/bin; do
    if [[ -x "$d/node" ]] && "$d/node" -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' 2>/dev/null; then best="$d"; fi
  done
  printf '%s' "${best:-$(dirname "$(command -v node)")}"
}
e2e_head() { (unset -f git; git -C "$E2E/work" rev-parse HEAD); }
e2e_untouched() {
  # No checkout change, install, migration, build or restart.
  local start; start="$(unset -f git; git -C "$E2E/work" rev-parse dev-v2-main@{upstream}~2)"
  [[ "$(e2e_head)" == "$start" ]] && ! grep -q '^npm ci\|^npm run' "$E2E/calls" 2>/dev/null \
    && kill -0 "$(cat "$E2E/victim")" 2>/dev/null && [[ "$(cat "$E2E/work/.next/standalone/.next/BUILD_ID")" == OLDBUILD ]] \
    && [[ "$(wc -l < "$E2E/ledger")" == 2 ]]
}
e2e_case() { # name expected_rc expected_text [NAME=value ...]
  local expected_rc="$1" text="$2" rc ok=1
  shift 2
  e2e_setup
  e2e_run "$SYNC_DEV_GENERATED_DIR/gen-execute.sh" "$@"; rc=$?
  if (( rc == expected_rc )) && grep -qF -- "$text" "$E2E/out" && e2e_untouched \
      && grep -q "^RESULT exit=$expected_rc " "$E2E"/evidence/*.txt; then ok=0
  else echo "    rc=$rc; blockers and tail:"; { grep -F "[preflight] FAIL" "$E2E/out"; tail -n 3 "$E2E/out"; } | sed 's/^/    /'; fi
  e2e_teardown; return $ok
}
test_e2e_ready_pin_deploys_and_preserves() {
  local rc ok=1 pin
  e2e_setup; pin="$(e2e_pin)"
  e2e_run "$SYNC_DEV_GENERATED_DIR/gen-execute.sh"; rc=$?
  if (( rc == 0 )) && [[ "$(e2e_head)" == "$pin" ]] && grep -q '^npm ci' "$E2E/calls" \
      && grep -q '^npm run build' "$E2E/calls" && [[ "$(wc -l < "$E2E/ledger")" == 3 ]] \
      && ! kill -0 "$(cat "$E2E/victim")" 2>/dev/null \
      && grep -q 'PASS post-migration parity' "$E2E/out" && grep -q 'PASS preserved state after deploy' "$E2E/out" \
      && grep -q '1 commit(s) behind the published tip' "$E2E/out" && grep -q 'diverged from the target' "$E2E/out" \
      && [[ "$(unset -f git; git -C "$E2E/work" stash list | wc -l)" == 1 ]] && grep -q '^RESULT exit=0 ' "$E2E"/evidence/*.txt \
      && ! grep -q 'p@h' "$E2E"/evidence/*.txt "$E2E/out"; then ok=0
  else echo "    rc=$rc; blockers and tail:"; { grep -F "[preflight] FAIL" "$E2E/out"; tail -n 3 "$E2E/out"; } | sed 's/^/    /'; fi
  e2e_teardown; return $ok
}
test_e2e_wrong_host_blocks() { STUB_HOST=elsewhere e2e_case 40 "FAIL expected host -- on 'elsewhere'"; }
test_e2e_branch_collision_blocks() {
  local ok=1 rc
  e2e_setup
  (unset -f git; git -C "$E2E/work" branch -q dev)
  e2e_run "$SYNC_DEV_GENERATED_DIR/gen-execute.sh" AFLDB_PF_TARGET_BRANCH=dev/v2-main AFLDB_PF_EXPECTED_BRANCH=dev/v2-main; rc=$?
  (( rc == 40 )) && grep -q "FAIL branch namespace -- 'dev/v2-main' collides with existing branch(es) dev" "$E2E/out" && e2e_untouched && ok=0
  e2e_teardown; return $ok
}
test_e2e_unapproved_migration_blocks() { e2e_case 40 'unapproved pending: 003_c.sql' AFLDB_PF_LEDGER_BEFORE= AFLDB_PF_LEDGER_AFTER=; }
test_e2e_wrong_transition_blocks() { e2e_case 40 'approval expects 117 before' AFLDB_PF_LEDGER_BEFORE=117 AFLDB_PF_LEDGER_AFTER=118; }
test_e2e_wrong_database_blocks() { STUB_DB=afldb_prod e2e_case 40 "connected to 'afldb_prod', expected 'afldb_dev'"; }
test_e2e_stale_backup_blocks() { STUB_WRITER_START="@$(date +%s)" e2e_case 40 'started after the backup was read'; }
test_e2e_unpublished_pin_blocks() { e2e_case 40 'is not a commit here after the fetch' AFLDB_PF_EXPECTED_REVISION=0123456789abcdef0123456789abcdef01234567; }
test_e2e_running_job_blocks() { STUB_RUNNING=afldb-settle-afl-api.service e2e_case 40 'afldb-settle-afl-api.service is running'; }
test_e2e_missing_preparation_stops_execute() { e2e_case 41 'PREP verified database backup' AFLDB_PF_BACKUP_DIR= AFLDB_PF_ACCEPTANCE=fail:ConnectFailure; }
test_e2e_parity_failure_stops_before_build() {
  local rc ok=1
  e2e_setup
  STUB_MIGRATE_BAD=1 e2e_run "$SYNC_DEV_GENERATED_DIR/gen-execute.sh"; rc=$?
  (( rc == 44 )) && grep -q 'FAIL post-migration parity' "$E2E/out" && ! grep -q '^npm run build' "$E2E/calls" \
    && kill -0 "$(cat "$E2E/victim")" 2>/dev/null && grep -q '^RESULT exit=44 ' "$E2E"/evidence/*.txt && ok=0
  e2e_teardown; return $ok
}
test_e2e_assessment_reports_all_and_changes_nothing() {
  local rc ok=1
  e2e_setup
  e2e_run "$SYNC_DEV_GENERATED_DIR/gen-assess.sh" AFLDB_PF_BACKUP_DIR= AFLDB_PF_ARTIFACT= AFLDB_PF_LEDGER_BEFORE= AFLDB_PF_LEDGER_AFTER=; rc=$?
  (( rc == 40 )) && grep -q 'unapproved pending' "$E2E/out" && grep -q 'PREP verified database backup' "$E2E/out" \
    && grep -q 'PREP recoverable application artifact' "$E2E/out" && e2e_untouched && ok=0
  e2e_teardown; return $ok
}
test_e2e_exit_status_survives_a_logging_pipeline() {
  local rc ok=1
  e2e_setup
  sed -e "s#/__PROJECT__#$E2E/work#g" -e "s#^AFLDB_PF_EVIDENCE_DIR=.*#AFLDB_PF_EVIDENCE_DIR='$E2E/evidence'#" \
    "$SYNC_DEV_GENERATED_DIR/gen-execute.sh" > "$E2E/run.sh"
  (unset -f git command 2>/dev/null; export E2E NVM_DIR="$E2E/no-nvm"; PATH="$E2E/stubs:$(e2e_node_dir):$PATH" bash "$E2E/run.sh" 2>&1 | tee "$E2E/log" >/dev/null; exit "${PIPESTATUS[0]}"); rc=$?
  (( rc == 40 )) && grep -q 'gate result -- BLOCKED' "$E2E/log" && e2e_untouched && ok=0
  e2e_teardown; return $ok
}

# --- AFLDB-ISSUE-339 corrections (R339-A/B/C/D) ---

# R339-D: the gate's psql never sees the password in argv, and inherited routing is removed.
d_case() { # d_case <dsn line written to .env> -> sets D_RC, D_ARGV, D_PW, D_PGDB
  local root; root="$(mktemp -d)"
  printf '%s\n' "$1" > "$root/.env"
  : > "$root/argv"
  psql() { printf '%s\n' "$*" > "$D_ROOT/argv"; printf '%s' "${PGPASSWORD-<unset>}" > "$D_ROOT/pw"; printf '%s' "${PGDATABASE-<unset>}" > "$D_ROOT/pgdb"; echo 'afldb_dev owner'; }
  D_ROOT="$root"
  (cd "$root" && PGDATABASE=afldb_prod PGSERVICE=prod AFLDB_PF_DSN_NAME=AFLDB_OWNER_DATABASE_URL afldb_pf_psql 'SELECT current_database(), current_user' >/dev/null); D_RC=$?
  D_ARGV="$(cat "$root/argv")"; D_PW="$(cat "$root/pw" 2>/dev/null || true)"; D_PGDB="$(cat "$root/pgdb" 2>/dev/null || true)"
  unset -f psql; rm -rf -- "$root"
}
test_r339d_userinfo_password_moves_to_environment() {
  d_case 'AFLDB_OWNER_DATABASE_URL=postgres://owner:fake%40pw%2Fx@h:5432/afldb_dev?sslmode=require'
  (( D_RC == 0 )) && [[ "$D_ARGV" == *'postgres://owner@h:5432/afldb_dev?sslmode=require'* && "$D_ARGV" != *fake* ]] \
    && [[ "$D_PW" == 'fake@pw/x' && "$D_PGDB" == '<unset>' ]]
}
test_r339d_query_password_moves_to_environment() {
  d_case 'AFLDB_OWNER_DATABASE_URL=postgresql://owner@h/afldb_dev?sslmode=require&pass%77ord=fakepw'
  (( D_RC == 0 )) && [[ "$D_ARGV" == *'postgresql://owner@h/afldb_dev?sslmode=require'* && "$D_ARGV" != *fakepw* && "$D_PW" == fakepw ]]
}
test_r339d_ambiguous_or_unmovable_passwords_refused() {
  local line
  for line in 'AFLDB_OWNER_DATABASE_URL=postgres://owner:fakeA@h/afldb_dev?password=fakeB' \
              'AFLDB_OWNER_DATABASE_URL=postgres://owner:fakeA@h/afldb_dev?pass%77ord=fakeB' \
              'AFLDB_OWNER_DATABASE_URL=postgres://owner@h/afldb_dev?sslpassword=fakeC' \
              'AFLDB_OWNER_DATABASE_URL=host=h dbname=afldb_dev password=fakeD' \
              'AFLDB_OWNER_DATABASE_URL=postgres://owner:fake%4@h/afldb_dev'; do
    d_case "$line"
    (( D_RC == 2 )) && [[ -z "$D_ARGV" ]] || { echo "    not refused: ${line%%:*}..."; return 1; }
  done
}
test_r339d_passwordless_dsn_unchanged() {
  d_case 'AFLDB_OWNER_DATABASE_URL=postgres://owner@h/afldb_dev'
  (( D_RC == 0 )) && [[ "$D_ARGV" == *'postgres://owner@h/afldb_dev '* && "$D_PW" == '<unset>' ]]
}

# R339-B: the only permitted preserved-state change is target main moving to the assessed revision.
test_r339b_expected_state_allows_only_target_main_move() {
  local a b
  a="$(printf 'a%.0s' {1..40})"; b="$(printf 'b%.0s' {1..40})"
  AFLDB_PF_STATE_BEFORE="main=$a stashes=1/x untracked=2/y env=z"
  [[ "$(AFLDB_PF_TARGET_BRANCH_RESOLVED=main AFLDB_PF_TARGET_REV=$b afldb_pf_expected_state)" == "main=$b stashes=1/x untracked=2/y env=z" ]] \
    && [[ "$(AFLDB_PF_TARGET_BRANCH_RESOLVED=dev-v2-main AFLDB_PF_TARGET_REV=$b afldb_pf_expected_state)" == "$AFLDB_PF_STATE_BEFORE" ]] \
    && [[ "$(AFLDB_PF_TARGET_BRANCH_RESOLVED=main AFLDB_PF_TARGET_REV='' afldb_pf_expected_state)" == "$AFLDB_PF_STATE_BEFORE" ]]
}
# Make main the deploy target, behind origin/main, with the stash/untracked/.env state kept.
e2e_make_main_target() {
  (unset -f git; cd "$E2E/work" && git switch -q main && git reset -q --hard origin/main~2 \
    && git branch -q --set-upstream-to=origin/main main)
}
test_e2e_r339b_pinned_main_fast_forward_completes() {
  local rc ok=1 pin
  e2e_setup; e2e_make_main_target; pin="$(e2e_pin)"
  e2e_run "$SYNC_DEV_GENERATED_DIR/gen-execute.sh" AFLDB_PF_TARGET_BRANCH=main AFLDB_PF_EXPECTED_BRANCH=main; rc=$?
  if (( rc == 0 )) && [[ "$(e2e_head)" == "$pin" && "$(unset -f git; git -C "$E2E/work" rev-parse refs/heads/main)" == "$pin" ]] \
      && grep -q 'PASS checkout revalidation -- main at .*main fast-forwarded as assessed' "$E2E/out" \
      && grep -q 'PASS preserved state after deploy' "$E2E/out" \
      && [[ "$(unset -f git; git -C "$E2E/work" stash list | wc -l)" == 1 ]]; then ok=0
  else echo "    rc=$rc"; grep -F '[preflight] FAIL' "$E2E/out" | sed 's/^/    /'; fi
  e2e_teardown; return $ok
}
test_e2e_r339b_unpinned_main_fast_forward_completes() {
  local rc ok=1 tip
  e2e_setup; e2e_make_main_target; tip="$(unset -f git; git -C "$E2E/seed" rev-parse HEAD)"
  e2e_run "$SYNC_DEV_GENERATED_DIR/gen-execute.sh" AFLDB_PF_TARGET_BRANCH=main AFLDB_PF_EXPECTED_BRANCH= AFLDB_PF_EXPECTED_REVISION=; rc=$?
  if (( rc == 0 )) && [[ "$(e2e_head)" == "$tip" ]] && grep -q 'PASS preserved state after deploy' "$E2E/out"; then ok=0
  else echo "    rc=$rc"; grep -F '[preflight] FAIL' "$E2E/out" | sed 's/^/    /'; fi
  e2e_teardown; return $ok
}
test_e2e_r339b_non_target_main_still_preserved() {
  # The existing dev-v2-main deploy: main is not the target and must not have moved.
  local rc ok=1 main_before
  e2e_setup; main_before="$(unset -f git; git -C "$E2E/work" rev-parse refs/heads/main)"
  e2e_run "$SYNC_DEV_GENERATED_DIR/gen-execute.sh"; rc=$?
  (( rc == 0 )) && [[ "$(unset -f git; git -C "$E2E/work" rev-parse refs/heads/main)" == "$main_before" ]] && ok=0
  e2e_teardown; return $ok
}

# R339-A: conflicting migration configuration refuses before checkout; the child is pinned.
test_e2e_r339a_exported_target_blocks() { AFLDB_MIGRATE_TARGET=prod e2e_case 40 'AFLDB_MIGRATE_TARGET is exported'; }
test_e2e_r339a_exported_dsn_blocks() {
  AFLDB_OWNER_DATABASE_URL='postgres://u:fake@h/afldb_other' e2e_case 40 'AFLDB_OWNER_DATABASE_URL is exported in the deploy shell'
}
test_e2e_r339a_custom_dsn_name_blocks() {
  e2e_case 40 'is not what db:migrate --target dev reads' AFLDB_PF_DSN_NAME=AFLDB_CODE_TEST_DATABASE_URL
}
e2e_dotenv_case() { # e2e_dotenv_case <line appended to .env> <expected text>
  local rc ok=1
  e2e_setup; printf '%s\n' "$1" >> "$E2E/work/.env"
  e2e_run "$SYNC_DEV_GENERATED_DIR/gen-execute.sh"; rc=$?
  (( rc == 40 )) && grep -qF -- "$2" "$E2E/out" && e2e_untouched && ok=0
  e2e_teardown; return $ok
}
test_e2e_r339a_dotenv_target_blocks() { e2e_dotenv_case 'AFLDB_MIGRATE_TARGET=prod' '.env sets AFLDB_MIGRATE_TARGET'; }
test_e2e_r339a_duplicate_dsn_line_blocks() {
  e2e_dotenv_case 'AFLDB_OWNER_DATABASE_URL=postgres://u:p@h/afldb_other' 'found 2 definition(s)'
}
test_e2e_r339a_migration_child_is_pinned() {
  local rc ok=1
  e2e_setup
  e2e_run "$SYNC_DEV_GENERATED_DIR/gen-execute.sh"; rc=$?
  (( rc == 0 )) && grep -q '^MIGRATE_CHILD args=\[run db:migrate -- --target dev\] exported_target=<unset> exported_owner_dsn=$' "$E2E/calls" \
    && ! grep -q 'MIGRATE_CHILD would write' "$E2E/calls" && grep -q 'PASS migration target is the assessed database' "$E2E/out" \
    && ! grep -q 'fake\|u:p@' "$E2E/out" && ok=0
  e2e_teardown; return $ok
}

# R339-C: the real transport command (deploy/sync-dev-transport.sh), executed by a POSIX shell.
C_DIR=''
c_payload() { printf '%s' "$1" | gzip -c | base64 -w0; }
c_run() { # c_run <payload> [PATH] -> C_RC; runs under sh with TMPDIR inside C_DIR
  local template cmd path="${2:-$PATH}"
  template="$(tr -d '\r' < "$ROOT/deploy/sync-dev-transport.sh")"
  cmd="${template//__AFLDB_PAYLOAD__/$1}"
  (cd "$C_DIR/cwd" && TMPDIR="$C_DIR/tmp" MARK="$C_DIR/mark" PATH="$path" sh -c "$cmd" > "$C_DIR/out" 2>&1); C_RC=$?
}
c_setup() { C_DIR="$(mktemp -d)"; mkdir -p "$C_DIR/cwd" "$C_DIR/tmp"; }
c_clean() { [[ -z "$(ls -A "$C_DIR/tmp")" ]]; }
test_r339c_complete_payload_runs_and_propagates_status() {
  local ok=1
  c_setup
  c_run "$(c_payload 'set -e; echo GATE_RAN > "$MARK"; exit 40')"
  (( C_RC == 40 )) && [[ "$(cat "$C_DIR/mark" 2>/dev/null)" == GATE_RAN ]] && c_clean && ok=0
  rm -rf -- "$C_DIR"; return $ok
}
c_refused() { # c_refused <payload> [PATH]
  c_setup; c_run "$@"
  local ok=1
  (( C_RC == 47 )) && [[ ! -e "$C_DIR/mark" ]] && grep -q 'could not be decoded completely' "$C_DIR/out" && c_clean && ok=0
  rm -rf -- "$C_DIR"; return $ok
}
test_r339c_invalid_base64_refused() { c_refused '!!!not-base64!!!'; }
test_r339c_corrupt_gzip_refused() { c_refused "$(printf 'not gzip at all' | base64 -w0)"; }
test_r339c_truncated_payload_never_runs_partial_input() {
  # The marker command comes FIRST, followed by padding, so a truncated stream would contain it.
  local full pad
  pad="$(head -c 20000 /dev/urandom | base64 -w0)"
  full="$(c_payload "echo PARTIAL > \"\$MARK\"; : '$pad'")"
  c_refused "${full:0:$(( ${#full} / 2 / 4 * 4 ))}"
}
test_r339c_missing_decoder_refused() {
  local bin tool found; bin="$(mktemp -d)"
  # `builtin`: test_diagnostics_are_bounded leaves a global command() stub that returns 1, which
  # made every lookup fail and left a PATH with no sh at all. Setup now fails loudly instead.
  for tool in sh bash mktemp gunzip gzip rm ls cat; do
    found="$(builtin command -v "$tool")" && [[ "$found" == /* ]] \
      || { echo "missing-decoder setup: cannot link $tool" >&2; rm -rf -- "$bin"; return 1; }
    ln -s "$found" "$bin/$tool"
  done
  [[ ! -e "$bin/base64" ]] || { rm -rf -- "$bin"; return 1; }
  c_refused "$(c_payload 'echo GATE_RAN > "$MARK"')" "$bin"; local rc=$?
  rm -rf -- "$bin"; return $rc
}
test_r339c_transport_holds_no_double_quote() {
  ! grep -q '"' "$ROOT/deploy/sync-dev-transport.sh" && ! grep -q 'bash -s' "$ROOT/deploy/sync-dev-transport.sh"
}

run_test 'R339-D: userinfo password leaves argv for PGPASSWORD (percent-decoded); routing env removed' test_r339d_userinfo_password_moves_to_environment
run_test 'R339-D: query password (encoded keyword) leaves argv' test_r339d_query_password_moves_to_environment
run_test 'R339-D: dual/ssl/key-value/malformed passwords are refused before psql' test_r339d_ambiguous_or_unmovable_passwords_refused
run_test 'R339-D: password-free DSN is passed unchanged' test_r339d_passwordless_dsn_unchanged
run_test 'R339-B: expected state permits only the target-main move' test_r339b_expected_state_allows_only_target_main_move
run_test 'R339-C: complete payload runs and its status propagates' test_r339c_complete_payload_runs_and_propagates_status
run_test 'R339-C: invalid base64 refuses (47) with nothing run' test_r339c_invalid_base64_refused
run_test 'R339-C: corrupt gzip refuses (47) with nothing run' test_r339c_corrupt_gzip_refused
run_test 'R339-C: truncated payload refuses (47) without running partial input' test_r339c_truncated_payload_never_runs_partial_input
run_test 'R339-C: missing decoder refuses (47) with nothing run' test_r339c_missing_decoder_refused
run_test 'R339-C: transport template has no double quote and no bash -s' test_r339c_transport_holds_no_double_quote
run_test 'gate: branch namespace collision dev vs dev/v2-main' test_gate_branch_collision_dev_vs_dev_slash
run_test 'gate: ledger accepts CRLF checksum, refuses drift and reordering' test_gate_ledger_accepts_crlf_checksum_and_refuses_drift
run_test 'gate: .env presence by name never prints values' test_gate_env_presence_never_prints_values
run_test 'gate: approval window missing/expired/too long/future/open' test_gate_window_states
if [[ -n "${SYNC_DEV_GENERATED_DIR:-}" && -f "$SYNC_DEV_GENERATED_DIR/gen-execute.sh" && -f "$SYNC_DEV_GENERATED_DIR/gen-assess.sh" ]]; then
  run_test 'e2e: READY pin behind tip deploys, migrates exactly, preserves main/stash' test_e2e_ready_pin_deploys_and_preserves
  run_test 'e2e: wrong host blocks before any change' test_e2e_wrong_host_blocks
  run_test 'e2e: branch namespace collision blocks before any change' test_e2e_branch_collision_blocks
  run_test 'e2e: unapproved pending migration blocks' test_e2e_unapproved_migration_blocks
  run_test 'e2e: approved transition mismatch blocks' test_e2e_wrong_transition_blocks
  run_test 'e2e: wrong database blocks' test_e2e_wrong_database_blocks
  run_test 'e2e: stale backup (writer ran after it) blocks' test_e2e_stale_backup_blocks
  run_test 'e2e: unpublished/absent pin blocks' test_e2e_unpublished_pin_blocks
  run_test 'e2e: running afldb job blocks' test_e2e_running_job_blocks
  run_test 'e2e: missing preparation (41) stops execute' test_e2e_missing_preparation_stops_execute
  run_test 'e2e: post-migration parity failure stops before build/restart' test_e2e_parity_failure_stops_before_build
  run_test 'e2e: assessment reports every blocker and changes nothing' test_e2e_assessment_reports_all_and_changes_nothing
  run_test 'e2e: exit status survives a tee logging pipeline' test_e2e_exit_status_survives_a_logging_pipeline
  run_test 'e2e R339-B: pinned main fast-forward completes, stash preserved' test_e2e_r339b_pinned_main_fast_forward_completes
  run_test 'e2e R339-B: unpinned main fast-forward completes' test_e2e_r339b_unpinned_main_fast_forward_completes
  run_test 'e2e R339-B: non-target main is still preserved exactly' test_e2e_r339b_non_target_main_still_preserved
  run_test 'e2e R339-A: exported AFLDB_MIGRATE_TARGET blocks before checkout' test_e2e_r339a_exported_target_blocks
  run_test 'e2e R339-A: exported owner DSN blocks before checkout' test_e2e_r339a_exported_dsn_blocks
  run_test 'e2e R339-A: custom -DsnName without -SkipMigrate blocks' test_e2e_r339a_custom_dsn_name_blocks
  run_test 'e2e R339-A: .env migration target other than dev blocks' test_e2e_r339a_dotenv_target_blocks
  run_test 'e2e R339-A: duplicate .env DSN line blocks' test_e2e_r339a_duplicate_dsn_line_blocks
  run_test 'e2e R339-A: migration child is pinned to --target dev with no exported target/DSN' test_e2e_r339a_migration_child_is_pinned
else
  echo 'NOT RUN: e2e generated-payload cases (set SYNC_DEV_GENERATED_DIR; see tests/sync-dev-static.test.ps1 -ExportDir)'
fi

echo "$passed passed, $failed failed"
(( failed == 0 ))
