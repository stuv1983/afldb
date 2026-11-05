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

echo "$passed passed, $failed failed"
(( failed == 0 ))
