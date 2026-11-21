#!/usr/bin/env bash
# Sitting A1, block S9 = public smoke from the WORKSTATION (unauthenticated; beta gate on, AFLDB_BETA_EPOCH=1). Read-only: GETs only.
# Expectations as B1-RUNBOOK S9 (run6/b1/B1-RUNBOOK.md). A 5xx or the 503 "Beta gate is on but ..." message is a rollback trigger.
# Run (workstation Bash): bash a1-s9-public-smoke.sh <NEW BUILD_ID from P3b>
set -uo pipefail
B=https://beta.afldb.com; BID=${1:?BUILD_ID}; [[ $BID =~ ^[A-Za-z0-9_-]{1,64}$ ]] || { echo "bad BUILD_ID"; exit 2; }
echo "== A1 S9 $(date -u +%FT%TZ)"
fails=0
chk() { # <label> <expected code> <url> [<expected location path or body fragment>]
  local out code loc; out=$(curl -s -m 30 -o /tmp/a1s9.$$ -w '%{http_code} %{redirect_url}' "$3"); code=${out%% *}; loc=${out#"$code"}; loc=${loc# }
  local ok=1; [ "$code" = "$2" ] || ok=0
  if [ -n "${4:-}" ]; then case $2 in 30*) [[ $loc =~ ^https?://[^/]+(/.*)?$ ]] && [ "${BASH_REMATCH[1]:-/}" = "$4" ] || ok=0;; *) grep -q -- "$4" /tmp/a1s9.$$ || ok=0;; esac; fi
  grep -q 'Beta gate is on but' /tmp/a1s9.$$ && ok=0
  [ $ok = 1 ] && echo "  ok    $1: $code ${loc}" || { echo "  FAIL  $1: $code ${loc} (expected $2 ${4:-})"; fails=$((fails+1)); }
}
chk health 200 "$B/api/health" '"database":"ok"'
chk home 307 "$B/" /beta
chk players 307 "$B/players" '/beta?from=%2Fplayers'
chk admin 307 "$B/admin/operations" /admin/login
chk build-manifest 200 "$B/_next/static/$BID/_buildManifest.js"
r=$(curl -s -m 30 -D - -o /dev/null "$B/beta" | tr -d '\r'); c=$(echo "$r" | head -1 | awk '{print $2}')   # headers end in CRLF
if [ "$c" = 200 ] && echo "$r" | grep -qi '^x-robots-tag: noindex, nofollow'; then echo "  ok    beta: 200 noindex, nofollow"; else echo "  FAIL  beta: $c (expected 200 with X-Robots-Tag noindex, nofollow)"; fails=$((fails+1)); fi
rm -f /tmp/a1s9.$$
[ $fails = 0 ] && echo "S9 RESULT PASS" || { echo "S9 RESULT FAIL ($fails)"; exit 1; }
