#!/usr/bin/env bash
# Release 17822b29, block S9 = public smoke from the WORKSTATION (unauthenticated; beta gate on). Read-only: GETs only.
# Same expectations as Sunday's a1-s9-public-smoke.sh (B1-RUNBOOK S9), plus: the PREVIOUS build's manifest must answer 404 (the
# edge serves the new build only) and the unauthenticated sitemap/robots codes are recorded (the gate redirects them).
# A 5xx, a 503, or the "Beta gate is on but ..." text anywhere is a rollback trigger.
# Run (workstation Git Bash): bash r1-s9-public-smoke.sh <SERVING BUILD_ID> <OTHER BUILD_ID>
#   after promotion: <17822b29 BUILD_ID from P3b> XWruOm_9nLCSMY8nGPqYU;  after a rollback: XWruOm_9nLCSMY8nGPqYU <17822b29 BUILD_ID>
# Test seam: S9_BASE overrides the origin ONLY for the rehearsal stub (must be http://127.0.0.1:<port>); never set it on Tuesday.
set -uo pipefail
B=${S9_BASE:-https://beta.afldb.com}
[ "$B" = https://beta.afldb.com ] || [[ $B =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || { echo "bad S9_BASE"; exit 2; }
BID=${1:?serving BUILD_ID}; OTHER=${2:?other BUILD_ID}
[[ $BID =~ ^[A-Za-z0-9_-]{1,64}$ && $OTHER =~ ^[A-Za-z0-9_-]{1,64}$ && $BID != "$OTHER" ]] || { echo "bad BUILD_ID arguments"; exit 2; }
T=$(mktemp); trap 'rm -f "$T"' EXIT
echo "== R1 S9 $(date -u +%FT%TZ) base $B serving $BID"
fails=0
chk() { # <label> <expected code> <url> [<expected location path or body fragment>]
  local out code loc ok=1; out=$(curl -s -m 30 -o "$T" -w '%{http_code} %{redirect_url}' "$3"); code=${out%% *}; loc=${out#"$code"}; loc=${loc# }
  [ "$code" = "$2" ] || ok=0
  if [ -n "${4:-}" ]; then case $2 in 30*) [[ $loc =~ ^https?://[^/]+(/.*)?$ ]] && [ "${BASH_REMATCH[1]:-/}" = "$4" ] || ok=0;; *) grep -q -- "$4" "$T" || ok=0;; esac; fi
  grep -q 'Beta gate is on but' "$T" && ok=0
  [ $ok = 1 ] && echo "  ok    $1: $code ${loc}" || { echo "  FAIL  $1: $code ${loc} (expected $2 ${4:-})"; fails=$((fails+1)); }
}
rec() { # <label> <url>: record only
  local out; out=$(curl -s -m 30 -o "$T" -w '%{http_code} %{redirect_url}' "$2"); echo "  rec   $1: $out"
  case ${out%% *} in 5*) echo "  FAIL  $1: 5xx"; fails=$((fails+1));; esac
}
chk health 200 "$B/api/health" '"database":"ok"'
chk home 307 "$B/" /beta
chk players 307 "$B/players" '/beta?from=%2Fplayers'
chk brownlow-2026 307 "$B/brownlow/2026" '/beta?from=%2Fbrownlow%2F2026'
chk admin 307 "$B/admin/operations" /admin/login
chk build-manifest 200 "$B/_next/static/$BID/_buildManifest.js"
chk other-build-manifest 404 "$B/_next/static/$OTHER/_buildManifest.js"
r=$(curl -s -m 30 -D - -o /dev/null "$B/beta" | tr -d '\r'); c=$(echo "$r" | head -1 | awk '{print $2}')
if [ "$c" = 200 ] && echo "$r" | grep -qi '^x-robots-tag: noindex, nofollow'; then echo "  ok    beta: 200 noindex, nofollow"; else echo "  FAIL  beta: $c (expected 200 with X-Robots-Tag noindex, nofollow)"; fails=$((fails+1)); fi
rec sitemap "$B/sitemap.xml"
rec robots "$B/robots.txt"
[ $fails = 0 ] && echo "S9 RESULT PASS" || { echo "S9 RESULT FAIL ($fails)"; exit 1; }
