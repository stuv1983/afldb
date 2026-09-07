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
