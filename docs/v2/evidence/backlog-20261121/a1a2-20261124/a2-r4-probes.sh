#!/usr/bin/env bash
# Sitting A2, R4 probes from the WORKSTATION against https://beta.afldb.com (unauthenticated GET/HEAD only; caddy357 README §10
# step 6). Never reads a production log.
#   pre   before the reload: records the current answers (the deny shapes still reach the app); never fails on deny probes
#   post  after the reload: legitimate pages 200 or the beta gate's 307 to /beta; deny shapes 404 with body "Not Found";
#         /seasons/%zz 400; HSTS and CSP headers present; then sends the two invite redaction probes (the OWNER reads only the
#         two newest access-log lines: uri must be /admin/invite/REDACTED, no probe string)
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
  curl -s -m 30 -o /dev/null -w '  sent  redaction probe 1: %{http_code}\n' "$B/admin/invite/ISSUE362-PROBE-0001?q=ISSUE362-PROBE-0002"
  curl -s --path-as-is -m 30 -o /dev/null -w '  sent  redaction probe 2: %{http_code}\n' "$B//admin/invite/ISSUE362-PROBE-0003"
  echo "  OWNER: read ONLY the two newest lines of /var/log/caddy/afldb-access.log; both uri = /admin/invite/REDACTED, no ISSUE362-PROBE string"
fi
rm -f "$T"
[ $fails = 0 ] && echo "R4 PROBES RESULT $MODE PASS" || { echo "R4 PROBES RESULT $MODE FAIL ($fails)"; exit 1; }
