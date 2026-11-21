#!/usr/bin/env bash
# R6 (attended reboot, Wed 25 Nov 2026), runbook steps E3/F1: PUBLIC liveness smoke from the WORKSTATION (no SSH, so it cannot trip
# the home IPS). Unauthenticated GETs only, through Cloudflare and Caddy, with the beta gate on (AFLDB_BETA_EPOCH=1):
#   /api/health 200 with "database":"ok" (proves Caddy, the app and PostgreSQL answer); / 307 to /beta; /players 307 to
#   /beta?from=%2Fplayers; /beta 200 with X-Robots-Tag noindex, nofollow; never a 5xx and never the "Beta gate is on but" 503 text.
# Same expectations as a1a2-20261124/a1-s9-public-smoke.sh minus the BUILD_ID manifest (that one is run in step F2 with the BUILD_ID).
# No temp file. Command inventory: curl (GET), grep, head, awk, tr, date, echo.
# Run (workstation Git Bash): bash r6-public-smoke.sh            exit 0 = PASS
set -uo pipefail
B=https://beta.afldb.com
echo "== R6 public smoke $(date -u +%FT%TZ)"
fails=0
chk() { # <label> <expected code> <url> <expected location path or body fragment>
  local out code loc body
  out=$(curl -s -m 20 -o /dev/null -w '%{http_code} %{redirect_url}' "$3"); code=${out%% *}; loc=${out#"$code"}; loc=${loc# }
  local ok=1; [ "$code" = "$2" ] || ok=0
  case $2 in
    30*) [[ $loc =~ ^https?://[^/]+(/.*)?$ ]] && [ "${BASH_REMATCH[1]:-/}" = "$4" ] || ok=0;;
    *) body=$(curl -s -m 20 "$3"); grep -q -- "$4" <<< "$body" || ok=0; grep -q 'Beta gate is on but' <<< "$body" && ok=0;;
  esac
  [ $ok = 1 ] && echo "  ok    $1: $code ${loc}" || { echo "  FAIL  $1: $code ${loc} (expected $2 $4)"; fails=$((fails+1)); }
}
chk health 200 "$B/api/health" '"database":"ok"'
chk home 307 "$B/" /beta
chk players 307 "$B/players" '/beta?from=%2Fplayers'
r=$(curl -s -m 20 -D - -o /dev/null "$B/beta" | tr -d '\r'); c=$(echo "$r" | head -1 | awk '{print $2}')
if [ "$c" = 200 ] && echo "$r" | grep -qi '^x-robots-tag: noindex, nofollow'; then echo "  ok    beta: 200 noindex, nofollow"; else echo "  FAIL  beta: $c"; fails=$((fails+1)); fi
[ $fails = 0 ] && echo "R6 PUBLIC RESULT PASS" || { echo "R6 PUBLIC RESULT FAIL ($fails)"; exit 1; }
