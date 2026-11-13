#!/usr/bin/env bash
# AFLDB-ISSUE-362 SEC-1 probe: do the Caddy access logs (and Caddy's own stderr
# log) carry magic-link tokens, invite tokens, search text or a Referer path,
# and is routing unchanged?
#
# Runs ONE isolated Caddy on loopback 127.0.0.1:3410 (admin API off, own XDG
# dirs, no system service touched) in front of a stub upstream on 3411, using
# a deploy Caddyfile whose site addresses, upstream port and log/web paths are
# rewritten by sed. Nothing is installed; nothing outside <workdir> is written.
#
# Usage: caddy-redaction-probe.sh <caddy-binary> <Caddyfile.production> <label> <workdir> <stub.mjs>
set -u
BIN=$1; CF=$2; LABEL=$3; WD=$4; STUB=$5
PORT=3410; UP=3411
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
R=$WD/$LABEL
rm -rf "$R"; mkdir -p "$R/logs" "$R/xdg/data" "$R/xdg/config" "$WD/soon"
[ -f "$WD/soon/index.html" ] || echo '<h1>soon</h1>' > "$WD/soon/index.html"
touch -d '2026-01-01 00:00:00 UTC' "$WD/soon/index.html"

if grep -q '^{$' "$CF"; then
  # The file has its own global options block: inject the isolation options into it.
  INJECT=(-e '0,/^{$/s//{\n\tadmin off\n\tauto_https off\n\tpersist_config off/')
else
  INJECT=(-e '1i{\n\tadmin off\n\tauto_https off\n\tpersist_config off\n}')
fi
{
  sed "${INJECT[@]}" -e "s#^beta\.afldb\.com {#http://beta.afldb.com:$PORT {#" \
      -e "s#^www\.afldb\.com {#http://www.afldb.com:$PORT {#" \
      -e "s#^afldb\.com {#http://afldb.com:$PORT {#" \
      -e "s#127\.0\.0\.1:3100#127.0.0.1:$UP#g" \
      -e "s#/var/log/caddy/#$R/logs/#g" \
      -e "s#/var/www/afldb-soon#$WD/soon#g" "$CF"
} > "$R/Caddyfile.test"

echo "== caddy: $("$BIN" version)"
echo "== sha256 of binary: $(sha256sum "$BIN" | cut -d' ' -f1)"
echo "== Caddyfile under test: $CF  sha256 $(sha256sum "$CF" | cut -d' ' -f1)"
export XDG_DATA_HOME=$R/xdg/data XDG_CONFIG_HOME=$R/xdg/config
# U-1 guard: the DEV host runs a live Caddy whose admin API listens on 127.0.0.1:2019.
# This run must never talk to it: refuse to start unless the adapted test config
# disables the admin endpoint (adapt/validate/run --config never use the API).
"$BIN" adapt --config "$R/Caddyfile.test" --adapter caddyfile > "$R/adapted-test.json" 2>/dev/null
if grep -q '"admin":{"disabled":true' "$R/adapted-test.json"; then
  echo "== admin guard: test config has admin disabled (adapted JSON: $(grep -o '"admin":{[^}]*}' "$R/adapted-test.json"))"
else
  echo "== admin guard: FAILED, admin not disabled; refusing to run"; exit 3
fi
echo "== adapt of the UNMODIFIED deploy file (syntax only):"
"$BIN" adapt --config "$CF" --adapter caddyfile > "$R/adapted-unmodified.json" 2> "$R/adapt-unmodified.err"
echo "adapt rc=$?"; cat "$R/adapt-unmodified.err"
echo "== validate of the sed-rewritten copy:"
"$BIN" validate --config "$R/Caddyfile.test" --adapter caddyfile 2>&1 | tail -3
echo "validate rc=${PIPESTATUS[0]}"

node "$STUB" $UP "$R/upstream.jsonl" & STUBPID=$!
for _ in $(seq 1 50); do curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$UP/api/health" && break; sleep 0.1; done
"$BIN" run --config "$R/Caddyfile.test" --adapter caddyfile > "$R/caddy-stderr.log" 2>&1 & CPID=$!
sleep 3

req() { # name, then curl args after the host/path
  local name=$1; shift
  curl -s -S --max-time 10 -D "$R/h.$name" -o "$R/b.$name" -w "$name http=%{http_code}\n" "$@"
}
H() { echo "$1:$PORT:127.0.0.1"; }   # --resolve value
BETA="http://beta.afldb.com:$PORT"; APEX="http://afldb.com:$PORT"; WWW="http://www.afldb.com:$PORT"
RS="--resolve $(H beta.afldb.com) --resolve $(H afldb.com) --resolve $(H www.afldb.com)"

req magic    $RS "$BETA/beta/verify?token=PROBE-MAGIC-aaa111"
req invite   $RS -H 'Referer: https://beta.afldb.com/search?q=PROBE-REFERER-ccc333' "$BETA/admin/invite/PROBE-INVITE-bbb222"
req asset    $RS -H 'Referer: https://beta.afldb.com/admin/invite/PROBE-INVITE-bbb222' "$BETA/_next/static/x.js"
req search   $RS -H 'Cookie: afldb_beta=PROBE-COOKIE-fff666' "$BETA/search?q=PROBE-SEARCH-ddd444&sort=name"
req postinv  $RS -X POST -d 'a=1' "$BETA/admin/invite/PROBE-INVITE-bbb222"
req redir    $RS "$BETA/redir"
req health   $RS "$BETA/api/health"
req forged   $RS -H 'X-Forwarded-For: 6.6.6.6' -H 'X-Real-IP: 7.7.7.7' -H 'Forwarded: for=8.8.8.8' "$BETA/players/1"
req apexroot $RS "$APEX/"
req apexq    $RS "$APEX/?utm=PROBE-APEXQ-ggg777"
req apexea   $RS -X POST -d '{}' -H 'Content-Type: application/json' "$APEX/api/early-access"
req apexbig  $RS -X POST --data-binary @<(head -c 40000 /dev/zero | tr '\0' x) "$APEX/api/early-access"
req apex404  $RS "$APEX/nothing-here"
req www      $RS "$WWW/x?y=1"

kill $STUBPID; wait $STUBPID 2>/dev/null
sleep 1
req down     $RS "$BETA/beta/verify?token=PROBE-DOWN-eee555"
sleep 1
kill $CPID; wait $CPID 2>/dev/null

# Routing summary: status line + headers (Date removed) + body hash, per request.
: > "$R/routing.txt"
for n in magic invite asset search postinv redir health forged apexroot apexq apexea apexbig apex404 www down; do
  { echo "### $n"; grep -vi -e '^date:' -e '^$' "$R/h.$n" | tr -d '\r' | sort; echo "body-sha256: $(sha256sum < "$R/b.$n" | cut -d' ' -f1)"; } >> "$R/routing.txt"
done
echo "== upstream saw (forwarded headers):"
cat "$R/upstream.jsonl"

echo "== sentinel scan (count of lines containing each probe secret):"
for s in PROBE-MAGIC-aaa111 PROBE-INVITE-bbb222 PROBE-REFERER-ccc333 PROBE-SEARCH-ddd444 PROBE-COOKIE-fff666 PROBE-APEXQ-ggg777 PROBE-DOWN-eee555; do
  for f in "$R"/logs/*.log "$R/caddy-stderr.log"; do
    printf '%-24s %-28s %s\n' "$s" "$(basename "$f")" "$(grep -c -- "$s" "$f")"
  done
done
echo "== logged uri fields:"; grep -ho '"uri":"[^"]*"' "$R"/logs/*.log
echo "== logged Referer headers:"; grep -ho '"Referer":\[[^]]*\]' "$R"/logs/*.log
echo "== logged Cookie headers:"; grep -ho '"Cookie":\[[^]]*\]' "$R"/logs/*.log
echo "== log line count per file:"; wc -l "$R"/logs/*.log
echo "== caddy stderr error-level lines (uri/request excerpt):"
grep -h '"level":"error"' "$R/caddy-stderr.log" | head -3 | cut -c1-600
echo "PROBE-DONE $LABEL"
