# Remote-only helpers embedded by sync-dev.ps1 into the SSH payload.
# This file defines functions; it performs no action when sourced.

afldb_is_known_operational_artifact() {
  local path="$1"

  case "$path" in
    .deploy-backups/|.deploy-backups/*|FETCH_HEAD)
      return 0
      ;;
  esac

  [[ "$path" =~ ^\.env\.bak-[A-Za-z0-9][A-Za-z0-9._-]*$ ]] && return 0
  [[ "$path" =~ ^docs/rebuild-manifests/afltables_fitzroy_core/settle-[A-Za-z0-9][A-Za-z0-9._-]*\.json$ ]] && return 0
  [[ "$path" =~ ^afldb-ui-questions-[A-Za-z0-9][A-Za-z0-9._-]*\.csv$ ]] && return 0
  return 1
}

afldb_classify_worktree() {
  local allow_dirty="${1:-0}"
  local status_file entry status path rename_source
  local -a tracked=()
  local -a known=()
  local -a unknown=()

  status_file="$(mktemp)"
  if ! git status --porcelain=v1 -z --untracked-files=normal > "$status_file"; then
    rm -f -- "$status_file"
    echo "[deploy] unable to inspect the server working tree" >&2
    return 19
  fi

  while IFS= read -r -d '' entry <&3; do
    status="${entry:0:2}"
    path="${entry:3}"
    if [[ "$status" == "??" ]]; then
      if afldb_is_known_operational_artifact "$path"; then
        known+=("$path")
      else
        unknown+=("$path")
      fi
      continue
    fi

    if [[ "$status" == *R* || "$status" == *C* ]]; then
      rename_source=''
      IFS= read -r -d '' rename_source <&3 || true
      path="${rename_source:-<unknown source>} -> $path"
    fi
    tracked+=("$path")
  done 3< "$status_file"
  rm -f -- "$status_file"

  echo "[deploy] Remote working tree:"
  echo "[deploy] - tracked modifications: ${#tracked[@]}"
  echo "[deploy] - known operational untracked: ${#known[@]}"
  echo "[deploy] - unknown untracked: ${#unknown[@]}"

  if (( ${#known[@]} > 0 )); then
    echo "[deploy] known operational artifact path(s) (preserved):"
    printf '[deploy]   %s\n' "${known[@]}"
  fi

  if (( ${#tracked[@]} == 0 && ${#unknown[@]} == 0 )); then
    return 0
  fi

  if (( ${#tracked[@]} > 0 )); then
    echo "[deploy] tracked modification blocker path(s):" >&2
    printf '[deploy]   %s\n' "${tracked[@]}" >&2
  fi
  if (( ${#unknown[@]} > 0 )); then
    echo "[deploy] unknown untracked blocker path(s):" >&2
    printf '[deploy]   %s\n' "${unknown[@]}" >&2
  fi

  if [[ "$allow_dirty" == 1 ]]; then
    echo "[deploy] WARNING: -AllowDirtyServer explicitly bypasses $(( ${#tracked[@]} + ${#unknown[@]} )) blocker(s); no files will be cleaned, reset or deleted." >&2
    return 0
  fi

  echo "[deploy] server working tree has blocking changes; review them or rerun with -AllowDirtyServer to bypass explicitly" >&2
  return 20
}

# AFLDB-ISSUE-336 (DEV deployment preparation): deploy EXACTLY one reviewed commit instead of
# whatever the upstream tip is at deploy time. Fast-forwards the checked-out branch to the pin and
# refuses -- changing nothing -- unless every precondition holds: a full 40-hex commit id; a branch
# (not a detached HEAD); the commit present after the fetch; the commit already published on the
# branch's upstream; and HEAD equal to the pin or an ancestor of it. No reset, no merge commit, no
# checkout of another ref: a diverged branch is refused, never rewritten.
afldb_checkout_pinned_revision() {
  local expected="$1" branch upstream head

  if [[ ! "$expected" =~ ^[0-9a-f]{40}$ ]]; then
    echo "[deploy] pinned revision must be a full 40-character lower-case commit id; got '$expected'" >&2
    return 30
  fi
  if ! branch="$(git symbolic-ref --quiet --short HEAD)"; then
    echo "[deploy] a pinned deploy needs a checked-out branch, not a detached HEAD" >&2
    return 31
  fi
  if ! git cat-file -e "${expected}^{commit}" 2>/dev/null; then
    echo "[deploy] pinned revision $expected is not present after the fetch" >&2
    return 32
  fi
  if ! upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)"; then
    echo "[deploy] branch $branch has no upstream; the pinned revision must be published on it" >&2
    return 33
  fi
  if ! git merge-base --is-ancestor "$expected" "$upstream"; then
    echo "[deploy] pinned revision $expected is not on $upstream; publish it first" >&2
    return 34
  fi
  head="$(git rev-parse HEAD)"
  if [[ "$head" != "$expected" ]]; then
    if ! git merge-base --is-ancestor "$head" "$expected"; then
      echo "[deploy] $branch at $head is not an ancestor of the pinned revision $expected; refusing (no reset, no merge commit)" >&2
      return 35
    fi
    git merge --ff-only --quiet "$expected" || return 36
  fi
  if [[ "$(git rev-parse HEAD)" != "$expected" ]]; then
    echo "[deploy] HEAD is not the pinned revision after the fast-forward" >&2
    return 37
  fi
  echo "[deploy] pinned revision: $branch at $expected (upstream $upstream at $(git rev-parse --short "$upstream"))"
}

afldb_compact_text() {
  tr '\r\n' '  ' | cut -c 1-300
}

afldb_health_payload_is_healthy() {
  node -e 'let body=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => { body += chunk; }); process.stdin.on("end", () => { try { const value = JSON.parse(body); process.exit(value && value.status === "ok" && value.database === "ok" ? 0 : 1); } catch { process.exit(1); } });'
}

afldb_health_response_is_ready() {
  local http_status="$1"
  local body="$2"
  local live_build="${3:-}"
  local expected_build="${4:-}"

  AFLDB_LAST_PROBE_BODY="$(printf '%s' "$body" | afldb_compact_text)"
  if [[ "$http_status" != 200 ]]; then
    AFLDB_LAST_PROBE_KIND='http'
    AFLDB_LAST_PROBE_ERROR="HTTP ${http_status:-<none>}; body=${AFLDB_LAST_PROBE_BODY:-<empty>}"
    return 1
  fi
  if ! printf '%s' "$body" | afldb_health_payload_is_healthy; then
    AFLDB_LAST_PROBE_KIND='payload'
    AFLDB_LAST_PROBE_ERROR="HTTP 200 returned an unexpected health payload: ${AFLDB_LAST_PROBE_BODY:-<empty>}"
    return 1
  fi
  if [[ -n "$expected_build" && -z "$live_build" ]]; then
    AFLDB_LAST_PROBE_KIND='build-missing'
    AFLDB_LAST_PROBE_ERROR='x-afldb-build response header is missing'
    return 1
  fi
  if [[ -n "$expected_build" && "$live_build" != "$expected_build" ]]; then
    AFLDB_LAST_PROBE_KIND='build-mismatch'
    AFLDB_LAST_PROBE_ERROR="build mismatch: built=$expected_build live=$live_build"
    return 1
  fi

  AFLDB_LAST_PROBE_KIND='healthy'
  AFLDB_LAST_PROBE_ERROR=''
  return 0
}

afldb_health_probe() {
  local health_url="$1"
  local expected_build="${2:-}"
  local temp_dir body_file header_file error_file http_status curl_status body live_build

  AFLDB_LAST_HTTP_STATUS=''
  AFLDB_LAST_PROBE_KIND='connection'
  AFLDB_LAST_PROBE_ERROR='health probe did not run'
  AFLDB_LAST_PROBE_BODY=''

  temp_dir="$(mktemp -d)"
  body_file="$temp_dir/body"
  header_file="$temp_dir/headers"
  error_file="$temp_dir/error"
  curl_status=0
  if http_status="$(curl --silent --show-error --connect-timeout 2 --max-time 5 \
      --dump-header "$header_file" --output "$body_file" --write-out '%{http_code}' \
      "$health_url" 2> "$error_file")"; then
    curl_status=0
  else
    curl_status=$?
  fi

  body="$(test -f "$body_file" && cat "$body_file" || true)"
  live_build="$(test -f "$header_file" && tr -d '\r' < "$header_file" | sed -n 's/^x-afldb-build:[[:space:]]*//Ip' | tail -n 1 || true)"
  AFLDB_LAST_HTTP_STATUS="$http_status"

  if (( curl_status != 0 )); then
    AFLDB_LAST_PROBE_KIND='connection'
    AFLDB_LAST_PROBE_ERROR="$(test -f "$error_file" && afldb_compact_text < "$error_file" || true)"
    AFLDB_LAST_PROBE_ERROR="curl exit $curl_status: ${AFLDB_LAST_PROBE_ERROR:-no detail}"
    rm -f -- "$body_file" "$header_file" "$error_file"
    rmdir -- "$temp_dir" 2>/dev/null || true
    return 1
  fi

  rm -f -- "$body_file" "$header_file" "$error_file"
  rmdir -- "$temp_dir" 2>/dev/null || true
  afldb_health_response_is_ready "$http_status" "$body" "$live_build" "$expected_build"
}

afldb_set_now_seconds() {
  AFLDB_NOW_SECONDS="$(date +%s)"
}

afldb_service_state() {
  local service="$1"
  AFLDB_SERVICE_ACTIVE="$(systemctl show --property=ActiveState --value "$service" 2>/dev/null || true)"
  AFLDB_SERVICE_SUB="$(systemctl show --property=SubState --value "$service" 2>/dev/null || true)"
}

afldb_readiness_diagnostics() {
  local service="$1"
  local health_url="$2"
  local elapsed="$3"
  local reason="$4"
  local port=''

  echo "[deploy] readiness failure after ${elapsed}s: $reason" >&2
  echo "[deploy] last health probe: status=${AFLDB_LAST_HTTP_STATUS:-<none>} kind=${AFLDB_LAST_PROBE_KIND:-<none>} error=${AFLDB_LAST_PROBE_ERROR:-<none>}" >&2
  echo "[deploy] --- systemctl status (20 lines) ---" >&2
  systemctl status "$service" --no-pager --lines=20 >&2 || true
  echo "[deploy] --- recent journal (40 lines) ---" >&2
  journalctl --no-pager -u "$service" -n 40 >&2 || true

  if [[ "$health_url" =~ ^https?://[^/:]+:([0-9]+)(/|$) ]]; then
    port="${BASH_REMATCH[1]}"
  fi
  if [[ -n "$port" ]]; then
    echo "[deploy] --- listener check (:${port}) ---" >&2
    if command -v ss >/dev/null 2>&1; then
      ss -ltn "sport = :$port" >&2 || true
    elif command -v netstat >/dev/null 2>&1; then
      netstat -ltn 2>/dev/null | grep -E "[.:]${port}[[:space:]]" >&2 || true
    else
      echo "[deploy] neither ss nor netstat is available" >&2
    fi
  fi
}

afldb_wait_for_readiness() {
  local service="$1"
  local health_url="$2"
  local timeout_seconds="$3"
  local interval_seconds="$4"
  local expected_build="${5:-}"
  local started_at elapsed remaining sleep_for attempts=0

  if [[ ! "$timeout_seconds" =~ ^[1-9][0-9]*$ || ! "$interval_seconds" =~ ^[1-9][0-9]*$ ]]; then
    echo "[deploy] readiness timeout and interval must be positive integer seconds" >&2
    return 28
  fi

  afldb_set_now_seconds
  started_at="$AFLDB_NOW_SECONDS"
  while true; do
    attempts=$((attempts + 1))
    if afldb_health_probe "$health_url" "$expected_build"; then
      afldb_set_now_seconds
      elapsed=$((AFLDB_NOW_SECONDS - started_at))
      echo "[deploy] health ready after ${elapsed}s and ${attempts} probe(s): ${AFLDB_LAST_PROBE_BODY}"
      if [[ -n "$expected_build" ]]; then
        echo "[deploy] live BUILD_ID: $expected_build"
      fi
      return 0
    fi

    afldb_service_state "$service"
    afldb_set_now_seconds
    elapsed=$((AFLDB_NOW_SECONDS - started_at))
    if [[ "$AFLDB_SERVICE_ACTIVE" == failed || ( "$AFLDB_SERVICE_ACTIVE" == inactive && "$AFLDB_SERVICE_SUB" == dead ) ]]; then
      afldb_readiness_diagnostics "$service" "$health_url" "$elapsed" "systemd reports ActiveState=${AFLDB_SERVICE_ACTIVE:-<none>} SubState=${AFLDB_SERVICE_SUB:-<none>}"
      return 26
    fi
    if (( elapsed >= timeout_seconds )); then
      afldb_readiness_diagnostics "$service" "$health_url" "$elapsed" "health contract did not become ready within ${timeout_seconds}s"
      case "$AFLDB_LAST_PROBE_KIND" in
        build-missing) return 21 ;;
        build-mismatch) return 22 ;;
        *) return 27 ;;
      esac
    fi

    if (( attempts == 1 || attempts % 5 == 0 )); then
      echo "[deploy] readiness pending (${elapsed}s/${timeout_seconds}s): $AFLDB_LAST_PROBE_ERROR"
    fi
    remaining=$((timeout_seconds - elapsed))
    sleep_for="$interval_seconds"
    (( sleep_for > remaining )) && sleep_for="$remaining"
    sleep "$sleep_for"
  done
}

# =============================================================================================
# AFLDB-ISSUE-339: the DEV deploy gate. Runs on the host, from the reviewed workstation payload
# (never the server checkout's own copy), after `git fetch` and BEFORE any checkout change, install,
# migration, build or restart. It collects every safely discoverable blocker into one report.
#
#   PASS  check satisfied             FAIL  blocker
#   PREP  preparation still missing (named during assessment; mutation requires it)
#   INFO  recorded fact, not a decision
#
# afldb_deploy_gate returns 0 (READY), 40 (BLOCKED: at least one FAIL) or 41 (PREPARATION REQUIRED:
# no FAIL, at least one PREP). Both 40 and 41 stop an execute run before it changes anything.
# Revalidation after each input changes: 42 checkout, 43 before migration, 44 post-migration parity,
# 45 before restart, 46 preserved state. Every result line is appended to a timestamped, secret-free
# evidence file under AFLDB_PF_EVIDENCE_DIR (names, hashes and counts only; never a value).
# Inputs are AFLDB_PF_* variables assigned by sync-dev.ps1 in the payload.
# =============================================================================================

AFLDB_PF_FAILS=0
AFLDB_PF_PREPS=0
AFLDB_PF_EVIDENCE_FILE=''

afldb_pf_now() { if [[ -n "${AFLDB_PF_NOW:-}" ]]; then echo "$AFLDB_PF_NOW"; else date +%s; fi; }
afldb_pf_hostname() { hostname; }

afldb_pf_record() {
  local status="$1" label="$2" detail="${3:-}" line
  case "$status" in
    FAIL) AFLDB_PF_FAILS=$((AFLDB_PF_FAILS + 1)) ;;
    PREP) AFLDB_PF_PREPS=$((AFLDB_PF_PREPS + 1)) ;;
  esac
  line="$(printf '%-4s %s' "$status" "$label")"
  if [[ -n "$detail" ]]; then line+=" -- $detail"; fi
  echo "[preflight] $line"
  if [[ -n "$AFLDB_PF_EVIDENCE_FILE" ]]; then printf '%s\n' "$line" >> "$AFLDB_PF_EVIDENCE_FILE"; fi
  return 0
}

afldb_pf_open_evidence() {
  local stamp host short
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  host="$(afldb_pf_hostname 2>/dev/null || echo unknown-host)"
  short="$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
  AFLDB_PF_EVIDENCE_FILE=''
  if [[ -z "${AFLDB_PF_EVIDENCE_DIR:-}" ]] || ! (umask 077 && mkdir -p -- "$AFLDB_PF_EVIDENCE_DIR") 2>/dev/null; then
    afldb_pf_record FAIL 'evidence directory is writable' "${AFLDB_PF_EVIDENCE_DIR:-<unset>}"
    return 0
  fi
  AFLDB_PF_EVIDENCE_FILE="$AFLDB_PF_EVIDENCE_DIR/${stamp}-${host//[^A-Za-z0-9._-]/_}-${short}-${AFLDB_PF_PHASE:-execute}-$$.txt"
  if ! (umask 077 && : > "$AFLDB_PF_EVIDENCE_FILE") 2>/dev/null; then
    AFLDB_PF_EVIDENCE_FILE=''
    afldb_pf_record FAIL 'evidence file is writable' "$AFLDB_PF_EVIDENCE_DIR"
    return 0
  fi
  printf '# AFLDB deploy gate (AFLDB-ISSUE-339) phase=%s utc=%s host=%s dir=%s head=%s\n' \
    "${AFLDB_PF_PHASE:-execute}" "$stamp" "$host" "$(pwd -P)" "$(git rev-parse HEAD 2>/dev/null || echo unknown)" \
    >> "$AFLDB_PF_EVIDENCE_FILE"
  return 0
}

# EXIT trap: the final exit status (including a failed later step) is always recorded.
afldb_pf_finish() {
  local rc="$1"
  if [[ -n "$AFLDB_PF_EVIDENCE_FILE" && -f "$AFLDB_PF_EVIDENCE_FILE" ]]; then
    printf 'RESULT exit=%s utc=%s head=%s\n' "$rc" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "$(git rev-parse HEAD 2>/dev/null || echo unknown)" >> "$AFLDB_PF_EVIDENCE_FILE"
    echo "[preflight] evidence: $AFLDB_PF_EVIDENCE_FILE (exit $rc)"
  fi
  return 0
}

# .env reads: presence by NAME only; a value is returned solely to a caller that never prints it.
afldb_pf_env_has() {
  [[ -f .env ]] && grep -Eq "^[[:space:]]*(export[[:space:]]+)?$1=[\"']?[^\"'[:space:]]" .env
}
afldb_pf_env_value() {
  local value
  value="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" .env 2>/dev/null | tail -n 1 || true)"
  value="${value#*=}"; value="${value%$'\r'}"
  if [[ ${#value} -ge 2 && ( "$value" == \"*\" || "$value" == \'*\' ) ]]; then value="${value:1:${#value}-2}"; fi
  printf '%s' "$value"
}

# One read-only statement; the DSN and any server error text are never printed.
afldb_pf_psql() {
  local dsn
  dsn="$(afldb_pf_env_value "$AFLDB_PF_DSN_NAME")"
  if [[ -z "$dsn" ]]; then return 2; fi
  PGOPTIONS='-c default_transaction_read_only=on' PGAPPNAME='afldb-deploy-gate' \
    psql "$dsn" -X -q -A -t -F ' ' -v ON_ERROR_STOP=1 -c "$1" </dev/null 2>/dev/null
}
afldb_pf_read_ledger() {
  afldb_pf_psql 'SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE "C"' > "$1"
}
afldb_pf_hash() { sha256sum | cut -c1-16; }

afldb_pf_revision_migrations() {
  git ls-tree --name-only "$1" -- src/db/migrations/ 2>/dev/null \
    | sed 's#^src/db/migrations/##' | grep -E '\.sql$' | LC_ALL=C sort || true
}

# The ledger accepts the raw, canonical-LF or canonical-CRLF SHA-256 (tools/db/migration-checksum.ts).
afldb_pf_checksum_matches() {
  local rev="$1" name="$2" stored="$3" tmp raw lf crlf rc=1
  tmp="$(mktemp)"
  if git cat-file blob "$rev:src/db/migrations/$name" > "$tmp" 2>/dev/null; then
    raw="$(sha256sum < "$tmp" | cut -d' ' -f1)"
    lf="$(perl -0777 -pe 's/\r\n/\n/g' < "$tmp" | sha256sum | cut -d' ' -f1)"
    crlf="$(perl -0777 -pe 's/\r\n/\n/g; s/\n/\r\n/g' < "$tmp" | sha256sum | cut -d' ' -f1)"
    if [[ "$stored" == "$raw" || "$stored" == "$lf" || "$stored" == "$crlf" ]]; then rc=0; fi
  fi
  rm -f -- "$tmp"
  return "$rc"
}

# The applied ledger must be exactly the first N migrations of the target revision, checksums equal.
# Sets AFLDB_PF_APPLIED_N, AFLDB_PF_TARGET_M, AFLDB_PF_PENDING and AFLDB_PF_LEDGER_PROBLEMS.
afldb_pf_compare_ledger() {
  local rev="$1" ledger="$2" i=0 name stored
  local -a target=()
  AFLDB_PF_LEDGER_PROBLEMS=()
  mapfile -t target < <(afldb_pf_revision_migrations "$rev")
  AFLDB_PF_TARGET_M=${#target[@]}
  while read -r name stored; do
    if [[ -z "$name" ]]; then continue; fi
    if (( i >= ${#target[@]} )) || [[ "${target[$i]}" != "$name" ]]; then
      AFLDB_PF_LEDGER_PROBLEMS+=("applied $name is not migration #$((i + 1)) of the target revision")
    elif ! afldb_pf_checksum_matches "$rev" "$name" "$stored"; then
      AFLDB_PF_LEDGER_PROBLEMS+=("applied $name checksum differs from the target revision")
    fi
    i=$((i + 1))
  done < "$ledger"
  AFLDB_PF_APPLIED_N=$i
  AFLDB_PF_PENDING=''
  if (( i < ${#target[@]} )); then AFLDB_PF_PENDING="$(printf '%s ' "${target[@]:$i}")"; fi
  return 0
}

# Git cannot hold refs/heads/dev and refs/heads/dev/v2-main at once.
afldb_pf_branch_collisions() {
  local wanted="$1" ref name
  while IFS= read -r ref; do
    name="${ref#refs/heads/}"
    if [[ "$name" != "$wanted" && ( "$wanted" == "$name/"* || "$name" == "$wanted/"* ) ]]; then
      printf '%s ' "$name"
    fi
  done < <(git for-each-ref --format='%(refname)' refs/heads/ 2>/dev/null || true)
  return 0
}

# Preserved-state digest: local main, stashes, the untracked set and .env (hashes and counts only).
afldb_pf_state_digest() {
  local main stashes untracked env_hash
  main="$(git rev-parse --verify --quiet refs/heads/main 2>/dev/null || echo none)"
  stashes="$(git stash list --format=%H 2>/dev/null || true)"
  untracked="$(git status --porcelain=v1 -z --untracked-files=normal 2>/dev/null | tr '\0' '\n' | grep '^?? ' | LC_ALL=C sort || true)"
  env_hash='absent'
  if [[ -f .env ]]; then env_hash="$(afldb_pf_hash < .env)"; fi
  printf 'main=%s stashes=%s/%s untracked=%s/%s env=%s' "$main" \
    "$(printf '%s' "$stashes" | grep -c . || true)" "$(printf '%s' "$stashes" | afldb_pf_hash)" \
    "$(printf '%s' "$untracked" | grep -c . || true)" "$(printf '%s' "$untracked" | afldb_pf_hash)" "$env_hash"
}

# systemctl prints local times ("Sun 2026-11-08 05:08:36 AEDT"); parse date and time in the host zone.
afldb_pf_systemd_epoch() {
  local value="$1"
  if [[ -z "$value" || "$value" == n/a ]]; then return 0; fi
  date -d "$(awk '{print $2" "$3}' <<<"$value")" +%s 2>/dev/null || true
}

# Running afldb-* jobs, and writer timers due inside the deploy window. One problem per line.
afldb_pf_runtime_conflicts() {
  local now unit next epoch
  now="$(afldb_pf_now)"
  while read -r unit _; do
    if [[ -n "$unit" ]]; then printf '%s is running\n' "$unit"; fi
  done < <(systemctl list-units --type=service --state=active,activating,deactivating,reloading \
             --no-legend --plain 'afldb-*' 2>/dev/null || true)
  for unit in ${AFLDB_PF_CONFLICT_TIMERS:-}; do
    next="$(systemctl show -p NextElapseUSecRealtime --value "$unit.timer" 2>/dev/null || true)"
    epoch="$(afldb_pf_systemd_epoch "$next")"
    if [[ -n "$epoch" ]] && (( epoch >= now && epoch - now < AFLDB_PF_CONFLICT_MINUTES * 60 )); then
      printf '%s.timer fires at %s, inside the %s-minute deploy window\n' "$unit" "$next" "$AFLDB_PF_CONFLICT_MINUTES"
    fi
  done
  return 0
}

afldb_pf_window_check() {
  local now start="${AFLDB_PF_WINDOW_START:-}" end="${AFLDB_PF_WINDOW_END:-}"
  now="$(afldb_pf_now)"
  if [[ -z "$start" || -z "$end" ]]; then
    afldb_pf_record PREP 'approval window' 'not supplied (-ApprovalWindowStart/-ApprovalWindowEnd)'
  elif (( end <= start || end - start > 86400 )); then
    afldb_pf_record FAIL 'approval window' 'empty, inverted or longer than 24 h'
  elif (( now > end )); then
    afldb_pf_record FAIL 'approval window' "ended $(date -u -d "@$end" +%FT%TZ); a new owner approval is required"
  elif (( now < start )); then
    afldb_pf_record PREP 'approval window' "opens $(date -u -d "@$start" +%FT%TZ)"
  else
    afldb_pf_record PASS 'approval window' "open until $(date -u -d "@$end" +%FT%TZ)"
  fi
}

# Verified backup in the dev-backup-verify.sh layout (ISSUE-336 procedure): checksums, a restore that
# reproduced the live counts and ledger, the same database and ledger as live now, fresh, and newer
# than any writer job's last start.
afldb_pf_backup_check() {
  local dir="${AFLDB_PF_BACKUP_DIR:-}" live_n="$1" live_last="$2" out line read_at='' now unit started
  local -a problems=()
  if [[ -z "$dir" ]]; then
    afldb_pf_record PREP 'verified database backup' 'not supplied (-BackupDir)'
    return 0
  fi
  if [[ ! -d "$dir" ]]; then
    afldb_pf_record FAIL 'verified database backup' "$dir does not exist"
    return 0
  fi
  if [[ ! -s "$dir/SHA256SUMS" ]]; then problems+=('no SHA256SUMS')
  elif ! (cd "$dir" && sha256sum --quiet --strict -c SHA256SUMS >/dev/null 2>&1); then problems+=('SHA256SUMS verification failed'); fi
  if ! grep -q '^pg_restore exit=0' "$dir/verify-restore.txt" 2>/dev/null; then problems+=('no successful verify-restore.txt'); fi
  out="$(node -e '
    const fs = require("fs"), path = require("path");
    const [dir, db, n, last] = process.argv.slice(1);
    const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
                          catch { console.log(`PROBLEM ${f} missing or unreadable`); return null; } };
    const live = read("live-counts.json"), restored = read("restored-counts.json");
    if (live) {
      if (live.database !== db) console.log(`PROBLEM backup is of ${live.database}, expected ${db}`);
      const l = live.ledger || {};
      if (String(l.n) !== n || l.last !== last) console.log(`PROBLEM stale: backup ledger ${l.n}/${l.last}, live ${n}/${last}`);
      const t = Date.parse(live.readAt);
      if (Number.isFinite(t)) console.log(`READAT ${Math.floor(t / 1000)}`); else console.log("PROBLEM readAt is not a timestamp");
    }
    if (live && restored) {
      const a = live.counts || {}, b = restored.counts || {};
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      if (!keys.size) console.log("PROBLEM no table counts");
      for (const k of keys) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { console.log(`PROBLEM restored count differs for ${k}`); break; }
      const rl = restored.ledger || {}, ll = live.ledger || {};
      if (rl.n !== ll.n || rl.last !== ll.last) console.log("PROBLEM restored ledger differs from the backup ledger");
    }' "$dir" "$AFLDB_PF_EXPECTED_DATABASE" "$live_n" "$live_last" </dev/null 2>/dev/null || echo 'PROBLEM backup records could not be evaluated')"
  while IFS= read -r line; do
    case "$line" in PROBLEM\ *) problems+=("${line#PROBLEM }") ;; READAT\ *) read_at="${line#READAT }" ;; esac
  done <<<"$out"
  now="$(afldb_pf_now)"
  if [[ -n "$read_at" ]]; then
    if (( now - read_at > ${AFLDB_PF_MAX_BACKUP_AGE_HOURS:-12} * 3600 )); then
      problems+=("stale: read $(( (now - read_at) / 3600 )) h ago, limit ${AFLDB_PF_MAX_BACKUP_AGE_HOURS:-12} h")
    fi
    for unit in ${AFLDB_PF_CONFLICT_TIMERS:-}; do
      started="$(systemctl show --timestamp=unix -p ExecMainStartTimestamp --value "$unit.service" 2>/dev/null || true)"
      started="${started#@}"
      if [[ "$started" =~ ^[0-9]+$ ]] && (( started > read_at )); then problems+=("stale: $unit.service started after the backup was read"); fi
    done
  fi
  if (( ${#problems[@]} )); then
    afldb_pf_record FAIL 'verified database backup' "$dir: $(IFS=';'; echo "${problems[*]}")"
  else
    afldb_pf_record PASS 'verified database backup' "$dir (ledger $live_n/$live_last, read $(date -u -d "@$read_at" +%FT%TZ))"
  fi
}

# Recoverable artifact: a checksummed archive of the build serving now, without any .env member.
afldb_pf_artifact_check() {
  local archive="${AFLDB_PF_ARTIFACT:-}" dir base listed members live archived
  local -a problems=()
  if [[ -z "$archive" ]]; then
    afldb_pf_record PREP 'recoverable application artifact' 'not supplied (-ArtifactArchive)'
    return 0
  fi
  if [[ ! -s "$archive" ]]; then
    afldb_pf_record FAIL 'recoverable application artifact' "$archive is missing or empty"
    return 0
  fi
  dir="$(dirname -- "$archive")"; base="$(basename -- "$archive")"
  listed="$(cd "$dir" && grep -h -E "^[0-9a-f]{64}[ *]+${base//./\\.}$" SHA256SUMS-app SHA256SUMS 2>/dev/null | head -n 1 || true)"
  if [[ -z "$listed" ]]; then problems+=('not listed in SHA256SUMS-app or SHA256SUMS')
  elif ! (cd "$dir" && printf '%s\n' "$listed" | sha256sum --quiet --strict -c - >/dev/null 2>&1); then problems+=('checksum mismatch'); fi
  members="$(tar -tf "$archive" 2>/dev/null || true)"
  if ! grep -qx '.next/standalone/.next/BUILD_ID' <<<"$members"; then problems+=('no .next/standalone/.next/BUILD_ID member'); fi
  if grep -Eq '(^|/)\.env($|[.])' <<<"$members"; then problems+=('contains an .env member'); fi
  live="$(tr -d '\r\n' < .next/standalone/.next/BUILD_ID 2>/dev/null || true)"
  archived="$(tar -xOf "$archive" .next/standalone/.next/BUILD_ID 2>/dev/null | tr -d '\r\n' || true)"
  if [[ -z "$live" || "$archived" != "$live" ]]; then problems+=("archived build ${archived:-<none>} is not the serving build ${live:-<none>}"); fi
  if (( ${#problems[@]} )); then
    afldb_pf_record FAIL 'recoverable application artifact' "$archive: $(IFS=';'; echo "${problems[*]}")"
  else
    afldb_pf_record PASS 'recoverable application artifact' "$archive (BUILD_ID $live)"
  fi
}

afldb_deploy_gate() {
  local host top here expected_dir origin classify_rc=0 current target upstream='' collisions main_sha behind
  local name missing='' avail_kb mem_kb deploy_node unit_exec unit_node unit_version ledger conflicts db_identity
  AFLDB_PF_FAILS=0; AFLDB_PF_PREPS=0
  AFLDB_PF_TARGET_REV=''; AFLDB_PF_TARGET_BRANCH_RESOLVED=''; AFLDB_PF_LEDGER_SHA=''
  afldb_pf_open_evidence
  afldb_pf_record INFO 'phase' "${AFLDB_PF_PHASE:-execute}"

  # Host and repository.
  host="$(afldb_pf_hostname 2>/dev/null || true)"
  if [[ -n "${AFLDB_PF_EXPECTED_HOST:-}" && "$host" == "$AFLDB_PF_EXPECTED_HOST" ]]; then
    afldb_pf_record PASS 'expected host' "$host"
  else
    afldb_pf_record FAIL 'expected host' "on '${host:-<unknown>}', expected '${AFLDB_PF_EXPECTED_HOST:-<unset>}'"
  fi
  top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  top="$(cd "${top:-/nonexistent}" 2>/dev/null && pwd -P || true)"
  here="$(pwd -P)"
  expected_dir="$(cd "${AFLDB_PF_PROJECT_DIR:-/nonexistent}" 2>/dev/null && pwd -P || true)"
  if [[ -n "$top" && "$top" == "$here" && "$here" == "$expected_dir" && "$(git rev-parse --git-dir 2>/dev/null)" == .git ]]; then
    afldb_pf_record PASS 'expected repository (primary checkout at the project directory)' "$here"
  else
    afldb_pf_record FAIL 'expected repository (primary checkout at the project directory)' \
      "cwd $here, toplevel ${top:-<none>}, expected ${AFLDB_PF_PROJECT_DIR:-<unset>}"
  fi
  origin="$(git remote get-url origin 2>/dev/null | sed -E 's#(://)[^@/]*@#\1#' || true)"
  if [[ -n "${AFLDB_PF_EXPECTED_ORIGIN:-}" && "$origin" != "$AFLDB_PF_EXPECTED_ORIGIN" ]]; then
    afldb_pf_record FAIL 'expected origin' "origin is '${origin:-<none>}', expected '$AFLDB_PF_EXPECTED_ORIGIN'"
  else
    afldb_pf_record PASS 'expected origin' "${origin:-<none>}"
  fi

  # Working tree: the existing exact operational-file allowlist.
  afldb_classify_worktree "${AFLDB_PF_ALLOW_DIRTY:-0}" || classify_rc=$?
  if (( classify_rc == 0 )); then
    afldb_pf_record PASS 'working tree holds only permitted operational files' \
      "$([[ "${AFLDB_PF_ALLOW_DIRTY:-0}" == 1 ]] && echo 'explicit -AllowDirtyServer bypass in force' || echo 'exact allowlist')"
  else
    afldb_pf_record FAIL 'working tree holds only permitted operational files' "classifier exit $classify_rc; blocker paths above"
  fi

  # Branch, namespace, upstream and revision.
  current="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  if [[ -z "$current" ]]; then afldb_pf_record FAIL 'checked-out branch' 'HEAD is detached'; fi
  target="${AFLDB_PF_TARGET_BRANCH:-$current}"
  if [[ -n "${AFLDB_PF_EXPECTED_REVISION:-}" && -z "${AFLDB_PF_EXPECTED_BRANCH:-}" ]]; then
    afldb_pf_record FAIL 'expected branch' 'a pinned deploy must name -ExpectedBranch'
  elif [[ -n "${AFLDB_PF_EXPECTED_BRANCH:-}" && "$target" != "$AFLDB_PF_EXPECTED_BRANCH" ]]; then
    afldb_pf_record FAIL 'expected branch' "target branch '${target:-<none>}', expected '$AFLDB_PF_EXPECTED_BRANCH'"
  fi
  if [[ -z "$target" ]] || ! git check-ref-format --branch "$target" >/dev/null 2>&1; then
    afldb_pf_record FAIL 'target branch name' "'${target:-<none>}' is not a valid branch name"
    target=''
  fi
  if [[ -n "$target" ]]; then
    collisions="$(afldb_pf_branch_collisions "$target")"
    if [[ -n "$collisions" ]]; then
      afldb_pf_record FAIL 'branch namespace' "'$target' collides with existing branch(es) ${collisions% } (refs/heads/x and refs/heads/x/y cannot coexist)"
    elif ! git show-ref --verify --quiet "refs/heads/$target"; then
      afldb_pf_record FAIL 'target branch exists locally' "'$target' does not exist; create it with its upstream in a separately approved step"
    else
      afldb_pf_record PASS 'branch namespace and existence' "$target (current: ${current:-detached})"
      upstream="$(git rev-parse --abbrev-ref --symbolic-full-name "$target@{upstream}" 2>/dev/null || true)"
      if [[ -z "$upstream" || "$upstream" != "${AFLDB_PF_EXPECTED_UPSTREAM:-}" ]]; then
        afldb_pf_record FAIL 'expected upstream' "'$target' tracks '${upstream:-<none>}', expected '${AFLDB_PF_EXPECTED_UPSTREAM:-<unset>}'"
      else
        afldb_pf_record PASS 'expected upstream' "$upstream at $(git rev-parse --short "$upstream")"
        if [[ -n "${AFLDB_PF_EXPECTED_REVISION:-}" ]]; then
          AFLDB_PF_TARGET_REV="$AFLDB_PF_EXPECTED_REVISION"
        else
          AFLDB_PF_TARGET_REV="$(git rev-parse --verify --quiet "$upstream^{commit}" || true)"
        fi
        if [[ ! "$AFLDB_PF_TARGET_REV" =~ ^[0-9a-f]{40}$ ]] || ! git cat-file -e "${AFLDB_PF_TARGET_REV}^{commit}" 2>/dev/null; then
          afldb_pf_record FAIL 'target revision present' "${AFLDB_PF_TARGET_REV:-<none>} is not a commit here after the fetch"
          AFLDB_PF_TARGET_REV=''
        elif ! git merge-base --is-ancestor "$AFLDB_PF_TARGET_REV" "$upstream"; then
          afldb_pf_record FAIL 'target revision is published' "$AFLDB_PF_TARGET_REV is not on $upstream"
        elif ! git merge-base --is-ancestor "refs/heads/$target" "$AFLDB_PF_TARGET_REV"; then
          afldb_pf_record FAIL 'fast-forward only' "$target at $(git rev-parse --short "refs/heads/$target") is not an ancestor of $AFLDB_PF_TARGET_REV (no reset, no merge commit)"
        else
          behind="$(git rev-list --count "$AFLDB_PF_TARGET_REV..$upstream")"
          afldb_pf_record PASS 'target revision' "$AFLDB_PF_TARGET_REV on $target; $behind commit(s) behind the published tip of $upstream"
        fi
        AFLDB_PF_TARGET_BRANCH_RESOLVED="$target"
      fi
    fi
  fi
  main_sha="$(git rev-parse --verify --quiet refs/heads/main 2>/dev/null || true)"
  if [[ -n "$main_sha" && "$target" != main ]]; then
    afldb_pf_record INFO 'local main is preserved, not deployed' "main at $main_sha$(git merge-base --is-ancestor refs/heads/main "${AFLDB_PF_TARGET_REV:-HEAD}" 2>/dev/null && echo ' (ancestor of the target)' || echo ' (diverged from the target)')"
  fi
  AFLDB_PF_STATE_BEFORE="$(afldb_pf_state_digest)"
  afldb_pf_record INFO 'preserved state digest' "$AFLDB_PF_STATE_BEFORE"

  # Configuration presence by name.
  for name in ${AFLDB_PF_REQUIRED_CONFIG:-}; do
    if ! afldb_pf_env_has "$name"; then missing+="$name "; fi
  done
  if [[ -n "$missing" ]]; then
    afldb_pf_record FAIL 'required configuration present in .env (names only)' "missing or empty: ${missing% }"
  else
    afldb_pf_record PASS 'required configuration present in .env (names only)' "$(wc -w <<<"${AFLDB_PF_REQUIRED_CONFIG:-}" | tr -d ' ') name(s)"
  fi

  # Capacity and runtime compatibility.
  avail_kb="$(df -Pk . 2>/dev/null | awk 'NR == 2 { print $4 }' || true)"
  if [[ "$avail_kb" =~ ^[0-9]+$ ]] && (( avail_kb >= ${AFLDB_PF_MIN_FREE_GIB:-10} * 1048576 )); then
    afldb_pf_record PASS 'free disk space' "$(( avail_kb / 1048576 )) GiB >= ${AFLDB_PF_MIN_FREE_GIB:-10} GiB"
  else
    afldb_pf_record FAIL 'free disk space' "${avail_kb:-unknown} KiB < ${AFLDB_PF_MIN_FREE_GIB:-10} GiB"
  fi
  mem_kb="$(awk '/^MemAvailable:/ { print $2 }' "${AFLDB_PF_MEMINFO:-/proc/meminfo}" 2>/dev/null || true)"
  if [[ "$mem_kb" =~ ^[0-9]+$ ]] && (( mem_kb >= ${AFLDB_PF_MIN_MEM_MIB:-2100} * 1024 )); then
    afldb_pf_record PASS 'available memory' "$(( mem_kb / 1024 )) MiB >= ${AFLDB_PF_MIN_MEM_MIB:-2100} MiB"
  else
    afldb_pf_record FAIL 'available memory' "${mem_kb:-unknown} KiB < ${AFLDB_PF_MIN_MEM_MIB:-2100} MiB"
  fi
  deploy_node="$(node --version 2>/dev/null || true)"
  unit_exec="$(systemctl show -p ExecStart --value "$AFLDB_PF_SERVICE" 2>/dev/null || true)"
  unit_node=''
  if [[ "$unit_exec" =~ path=([^[:space:]\;]+) ]]; then unit_node="${BASH_REMATCH[1]}"; fi
  if [[ -z "$unit_node" ]]; then
    afldb_pf_record FAIL 'runtime matches the service' "cannot read $AFLDB_PF_SERVICE ExecStart"
  elif [[ "${unit_node##*/}" != node ]]; then
    afldb_pf_record INFO 'runtime matches the service' "unit interpreter $unit_node is not node; not compared"
  else
    unit_version="$("$unit_node" --version 2>/dev/null || true)"
    if [[ -n "$deploy_node" && "$unit_version" == "$deploy_node" ]]; then
      afldb_pf_record PASS 'runtime matches the service' "build and service both $deploy_node"
    else
      afldb_pf_record FAIL 'runtime matches the service' "build node ${deploy_node:-<none>}, service node ${unit_version:-<none>} ($unit_node)"
    fi
  fi

  # Jobs and timers.
  conflicts="$(afldb_pf_runtime_conflicts)"
  if [[ -n "$conflicts" ]]; then
    afldb_pf_record FAIL 'no running job or writer timer inside the deploy window' "$(tr '\n' ';' <<<"$conflicts")"
  else
    afldb_pf_record PASS 'no running job or writer timer inside the deploy window' "${AFLDB_PF_CONFLICT_MINUTES} min; timers: ${AFLDB_PF_CONFLICT_TIMERS:-none}"
  fi

  # Operator preparation.
  afldb_pf_window_check
  case "${AFLDB_PF_ACCEPTANCE:-}" in
    ok:*) afldb_pf_record PASS 'acceptance address reachable from the workstation' "HTTP ${AFLDB_PF_ACCEPTANCE#ok:}; owner sign-in is still a manual step" ;;
    *) afldb_pf_record PREP 'acceptance address reachable from the workstation' "${AFLDB_PF_ACCEPTANCE:-unchecked} (check the workstation VPN)" ;;
  esac

  # Database identity, ledger, migration transition, backup and artifact.
  ledger="$(mktemp)"
  if ! afldb_pf_env_has "$AFLDB_PF_DSN_NAME"; then
    afldb_pf_record FAIL 'database identity' "$AFLDB_PF_DSN_NAME is not set in .env"
  elif ! db_identity="$(afldb_pf_psql 'SELECT current_database(), current_user')"; then
    afldb_pf_record FAIL 'database identity' "read-only connection via $AFLDB_PF_DSN_NAME failed (details withheld)"
  elif [[ "${db_identity%% *}" != "$AFLDB_PF_EXPECTED_DATABASE" ]]; then
    afldb_pf_record FAIL 'database identity' "connected to '${db_identity%% *}', expected '$AFLDB_PF_EXPECTED_DATABASE'"
  elif ! afldb_pf_read_ledger "$ledger"; then
    afldb_pf_record FAIL 'migration ledger readable' "afldb_meta.schema_migrations via $AFLDB_PF_DSN_NAME"
  else
    afldb_pf_record PASS 'database identity' "$db_identity via $AFLDB_PF_DSN_NAME (read-only session)"
    AFLDB_PF_LEDGER_SHA="$(afldb_pf_hash < "$ledger")"
    if [[ -z "$AFLDB_PF_TARGET_REV" ]]; then
      afldb_pf_record FAIL 'migration transition' 'no target revision to compare against'
    else
      afldb_pf_compare_ledger "$AFLDB_PF_TARGET_REV" "$ledger"
      if (( ${#AFLDB_PF_LEDGER_PROBLEMS[@]} )); then
        afldb_pf_record FAIL 'applied migrations match the target revision' "$(IFS=';'; echo "${AFLDB_PF_LEDGER_PROBLEMS[*]}")"
      else
        afldb_pf_record PASS 'applied migrations match the target revision' "$AFLDB_PF_APPLIED_N applied, names and checksums equal (ledger sha $AFLDB_PF_LEDGER_SHA)"
      fi
      if [[ -n "${AFLDB_PF_LEDGER_BEFORE:-}" && "$AFLDB_PF_APPLIED_N" != "$AFLDB_PF_LEDGER_BEFORE" ]]; then
        afldb_pf_record FAIL 'approved migration transition' "ledger has $AFLDB_PF_APPLIED_N, approval expects $AFLDB_PF_LEDGER_BEFORE before"
      elif [[ -n "${AFLDB_PF_LEDGER_AFTER:-}" && "$AFLDB_PF_TARGET_M" != "$AFLDB_PF_LEDGER_AFTER" ]]; then
        afldb_pf_record FAIL 'approved migration transition' "target has $AFLDB_PF_TARGET_M, approval expects $AFLDB_PF_LEDGER_AFTER after"
      elif [[ -n "$AFLDB_PF_PENDING" && -z "${AFLDB_PF_LEDGER_AFTER:-}" ]]; then
        afldb_pf_record FAIL 'approved migration transition' "unapproved pending: ${AFLDB_PF_PENDING% } (approve with -ExpectedLedgerBefore $AFLDB_PF_APPLIED_N -ExpectedLedgerAfter $AFLDB_PF_TARGET_M)"
      elif [[ -n "$AFLDB_PF_PENDING" && "${AFLDB_PF_SKIP_MIGRATE:-0}" == 1 ]]; then
        afldb_pf_record FAIL 'approved migration transition' "-SkipMigrate with pending ${AFLDB_PF_PENDING% }"
      else
        afldb_pf_record PASS 'approved migration transition' "$AFLDB_PF_APPLIED_N -> $AFLDB_PF_TARGET_M${AFLDB_PF_PENDING:+ (pending ${AFLDB_PF_PENDING% })}"
      fi
    fi
    afldb_pf_backup_check "$(grep -c . "$ledger" || true)" "$(awk 'END { print $1 }' "$ledger")"
  fi
  rm -f -- "$ledger"
  if [[ -z "$AFLDB_PF_LEDGER_SHA" ]]; then
    afldb_pf_record FAIL 'verified database backup' 'not evaluated without a live ledger'
  fi
  afldb_pf_artifact_check

  if (( AFLDB_PF_FAILS > 0 )); then
    afldb_pf_record INFO 'gate result' "BLOCKED: $AFLDB_PF_FAILS blocker(s), $AFLDB_PF_PREPS preparation item(s); nothing was changed"
    return 40
  fi
  if (( AFLDB_PF_PREPS > 0 )); then
    afldb_pf_record INFO 'gate result' "PREPARATION REQUIRED: $AFLDB_PF_PREPS item(s); nothing was changed"
    return 41
  fi
  afldb_pf_record INFO 'gate result' "READY: target $AFLDB_PF_TARGET_REV on $AFLDB_PF_TARGET_BRANCH_RESOLVED"
  return 0
}

afldb_pf_revalidate_checkout() {
  local branch head state
  branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  head="$(git rev-parse HEAD 2>/dev/null || true)"
  state="$(afldb_pf_state_digest)"
  if [[ "$branch" != "$AFLDB_PF_TARGET_BRANCH_RESOLVED" || "$head" != "$AFLDB_PF_TARGET_REV" \
        || "${state%% untracked=*}" != "${AFLDB_PF_STATE_BEFORE%% untracked=*}" ]]; then
    afldb_pf_record FAIL 'checkout revalidation' "branch ${branch:-<detached>} at ${head:-<none>}; $state"
    return 42
  fi
  afldb_pf_record PASS 'checkout revalidation' "$branch at $head; main and stashes unchanged"
}

afldb_pf_revalidate_before_migration() {
  local ledger conflicts
  ledger="$(mktemp)"
  if ! afldb_pf_read_ledger "$ledger"; then
    rm -f -- "$ledger"; afldb_pf_record FAIL 'pre-migration revalidation' 'ledger unreadable'; return 43
  fi
  if [[ "$(afldb_pf_hash < "$ledger")" != "$AFLDB_PF_LEDGER_SHA" ]]; then
    rm -f -- "$ledger"; afldb_pf_record FAIL 'pre-migration revalidation' 'the ledger changed after the gate; rerun the assessment'; return 43
  fi
  rm -f -- "$ledger"
  conflicts="$(afldb_pf_runtime_conflicts)"
  if [[ -n "$conflicts" ]]; then
    afldb_pf_record FAIL 'pre-migration revalidation' "$(tr '\n' ';' <<<"$conflicts")"; return 43
  fi
  afldb_pf_record PASS 'pre-migration revalidation' 'ledger unchanged since the gate; no running job'
}

afldb_pf_migration_parity() {
  local ledger
  ledger="$(mktemp)"
  if ! afldb_pf_read_ledger "$ledger"; then
    rm -f -- "$ledger"; afldb_pf_record FAIL 'post-migration parity' 'ledger unreadable'; return 44
  fi
  afldb_pf_compare_ledger "$AFLDB_PF_TARGET_REV" "$ledger"
  rm -f -- "$ledger"
  if (( ${#AFLDB_PF_LEDGER_PROBLEMS[@]} )) || [[ -n "$AFLDB_PF_PENDING" ]] \
      || [[ -n "${AFLDB_PF_LEDGER_AFTER:-}" && "$AFLDB_PF_APPLIED_N" != "$AFLDB_PF_LEDGER_AFTER" ]]; then
    afldb_pf_record FAIL 'post-migration parity' "applied $AFLDB_PF_APPLIED_N/$AFLDB_PF_TARGET_M ${AFLDB_PF_PENDING:+pending ${AFLDB_PF_PENDING% } }$(IFS=';'; echo "${AFLDB_PF_LEDGER_PROBLEMS[*]}")"
    return 44
  fi
  afldb_pf_record PASS 'post-migration parity' "$AFLDB_PF_APPLIED_N/$AFLDB_PF_TARGET_M, names and checksums equal"
}

afldb_pf_revalidate_before_restart() {
  local conflicts fails_before="$AFLDB_PF_FAILS" preps_before="$AFLDB_PF_PREPS"
  conflicts="$(afldb_pf_runtime_conflicts)"
  if [[ -n "$conflicts" ]]; then afldb_pf_record FAIL 'pre-restart revalidation' "$(tr '\n' ';' <<<"$conflicts")"; fi
  afldb_pf_window_check
  if (( AFLDB_PF_FAILS > fails_before || AFLDB_PF_PREPS > preps_before )); then return 45; fi
  afldb_pf_record PASS 'pre-restart revalidation' 'no running job or due writer timer; approval window open'
}

afldb_pf_verify_preserved() {
  local state
  state="$(afldb_pf_state_digest)"
  if [[ "$state" != "$AFLDB_PF_STATE_BEFORE" ]]; then
    afldb_pf_record FAIL 'preserved state after deploy' "before: $AFLDB_PF_STATE_BEFORE; after: $state"
    return 46
  fi
  afldb_pf_record PASS 'preserved state after deploy' "$state"
}
