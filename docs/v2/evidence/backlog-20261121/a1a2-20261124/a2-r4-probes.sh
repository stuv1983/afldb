#!/usr/bin/env bash
# Sitting A2, R4 probes from the WORKSTATION against https://beta.afldb.com (unauthenticated GET/HEAD only; caddy357 README §10
# step 6). Never reads a production log.
#   pre   before the reload: records the current answers (the deny shapes still reach the app); never fails on deny probes
#   post  after the reload: legitimate pages 200 or the beta gate's 307 to /beta; deny shapes 404 with body "Not Found";
#         /seasons/%zz 400; HSTS and CSP headers present; then sends four redaction probes (invite path + query, double-slash
#         invite path, magic-link query token, token-bearing Referer); the OWNER then runs three COUNT-ONLY greps over the newest
#         50 access-log lines (no line is displayed): 0 probe strings, >= 2 /admin/invite/REDACTED, >= 1 bare /beta/verify uri
# Any post FAIL = R4 rollback (restore "$B", validate, reload, re-run the legitimate-page probes).
# Run (workstation Git Bash): bash a2-r4-probes.sh pre|post
set -uo pipefail
B=https://beta.afldb.com; MODE=${1:?pre|post}; [[ $MODE =~ ^(pre|post)$ ]] || exit 2
T=$(mktemp); fails=0
echo "== A2 R4 probes $MODE $(date -u +%FT%TZ)"
req() { curl -s --path-as-is -m 30 -o "$T" -w '%{http_code} %{redirect_url}' "$B$1"; }
for p in / /players/scott-pendlebury-11724 /seasons/2024 /matches/1 /clubs/carlton /brownlow/2024 /sitemap/0.xml; do
  out=$(req "$p"); code=${out%% *}; loc=${out#"$code"}
  if [ "$code" = 200 ] || { [ "$code" = 307 ] && [[ $loc == *"/beta"* ]]; }; then echo "  ok    legit $p: $code$loc"; else echo "  FAIL  legit $p: $code$loc"; fails=$((fails+1)); fi
done
for p in /seasons/02024 /seasons/%32024 //seasons/2024 /players/x-1.json /matches/100000 /clubs/Carlton /seasons/2024/ /sitemap/1000.xml; do
  out=$(req "$p"); code=${out%% *}; body=$(head -c 200 "$T" | tr -d '\r\n')
  if [ "$MODE" = pre ]; then echo "  rec   deny $p: $code"; continue; fi
  if [ "$code" = 404 ] && [ "$body" = "Not Found" ]; then echo "  ok    deny $p: 404 Not Found"; else echo "  FAIL  deny $p: $code body=${body:0:40}"; fails=$((fails+1)); fi
done
out=$(req /seasons/%zz); code=${out%% *}
if [ "$MODE" = post ] && [ "$code" != 400 ]; then echo "  FAIL  /seasons/%zz: $code (expected 400)"; fails=$((fails+1)); else echo "  ok/rec /seasons/%zz: $code"; fi
H=$(curl -s -m 30 -I "$B/" | tr -d '\r')
hsts=$(grep -ci '^strict-transport-security:' <<< "$H"); csp=$(grep -ci '^content-security-policy:' <<< "$H")
if [ "$MODE" = post ] && { [ "$hsts" != 1 ] || [ "$csp" != 1 ]; }; then echo "  FAIL  headers hsts=$hsts csp=$csp"; fails=$((fails+1)); else echo "  ok/rec headers hsts=$hsts csp=$csp"; fi
if [ "$MODE" = post ]; then
  # Run d (2026-11-22): two more shapes, so every filtered field is exercised: the magic-link query token (request>uri "?.*$")
  # and a token-bearing Referer (request>headers>Referer). The owner check is COUNT-ONLY: no log line is displayed.
  curl -s -m 30 -o /dev/null -w '  sent  redaction probe 1: %{http_code}\n' "$B/admin/invite/ISSUE362-PROBE-0001?q=ISSUE362-PROBE-0002"
  curl -s --path-as-is -m 30 -o /dev/null -w '  sent  redaction probe 2: %{http_code}\n' "$B//admin/invite/ISSUE362-PROBE-0003"
  curl -s -m 30 -o /dev/null -w '  sent  redaction probe 3: %{http_code}\n' "$B/beta/verify?token=ISSUE362-PROBE-0004"
  curl -s -m 30 -o /dev/null -w '  sent  redaction probe 4: %{http_code}\n' -e "$B/admin/invite/ISSUE362-PROBE-0005?r=ISSUE362-PROBE-0006" "$B/"
  echo "  OWNER (counts only, nothing displayed):"
  echo "    sudo tail -n 50 /var/log/caddy/afldb-access.log | grep -c 'ISSUE362-PROBE'        # expect 0"
  echo "    sudo tail -n 50 /var/log/caddy/afldb-access.log | grep -c '/admin/invite/REDACTED' # expect >= 2"
  echo "    sudo tail -n 50 /var/log/caddy/afldb-access.log | grep -c '\"uri\":\"/beta/verify\"'  # expect >= 1 (query removed)"
fi
rm -f "$T"
[ $fails = 0 ] && echo "R4 PROBES RESULT $MODE PASS" || { echo "R4 PROBES RESULT $MODE FAIL ($fails)"; exit 1; }
