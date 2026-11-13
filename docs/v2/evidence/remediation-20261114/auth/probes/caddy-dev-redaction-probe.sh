#!/usr/bin/env bash
# AFLDB-ISSUE-362 SEC-1, development proxy file: same assertions as
# caddy-redaction-probe.sh, for deploy/Caddyfile (:8090 -> 127.0.0.1:3100).
# Isolated: loopback 127.0.0.1:3412 in front of the stub on 3411, admin API off.
# Usage: caddy-dev-redaction-probe.sh <caddy-binary> <deploy/Caddyfile> <label> <workdir> <stub.mjs>
set -u
BIN=$1; CF=$2; LABEL=$3; WD=$4; STUB=$5
PORT=3412; UP=3411
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
R=$WD/$LABEL
rm -rf "$R"; mkdir -p "$R/logs" "$R/xdg/data" "$R/xdg/config"
if grep -q '^{$' "$CF"; then
  INJECT=(-e '0,/^{$/s//{\n\tadmin off\n\tauto_https off\n\tpersist_config off/')
else
  INJECT=(-e '1i{\n\tadmin off\n\tauto_https off\n\tpersist_config off\n}')
fi
sed "${INJECT[@]}" -e "s#^:8090 {#http://127.0.0.1:$PORT {#" -e "s#127\.0\.0\.1:3100#127.0.0.1:$UP#g" \
    -e "s#/var/log/caddy/#$R/logs/#g" "$CF" > "$R/Caddyfile.test"
export XDG_DATA_HOME=$R/xdg/data XDG_CONFIG_HOME=$R/xdg/config
echo "== caddy: $("$BIN" version)"
"$BIN" adapt --config "$R/Caddyfile.test" --adapter caddyfile > "$R/adapted-test.json" 2>/dev/null
grep -q '"admin":{"disabled":true' "$R/adapted-test.json" || { echo "admin guard FAILED"; exit 3; }
echo "== admin guard: admin disabled in the test config"
"$BIN" validate --config "$R/Caddyfile.test" --adapter caddyfile 2>&1 | tail -1
node "$STUB" $UP "$R/upstream.jsonl" & STUBPID=$!
for _ in $(seq 1 50); do curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$UP/api/health" && break; sleep 0.1; done
"$BIN" run --config "$R/Caddyfile.test" --adapter caddyfile > "$R/caddy-stderr.log" 2>&1 & CPID=$!
sleep 3
B="http://127.0.0.1:$PORT"
curl -s -o /dev/null -w 'magic http=%{http_code}\n' "$B/beta/verify?token=PROBE-MAGIC-aaa111"
curl -s -o /dev/null -w 'invite http=%{http_code}\n' -H 'Referer: http://127.0.0.1/admin/invite/PROBE-INVITE-bbb222' "$B/admin/invite/PROBE-INVITE-bbb222"
curl -s -o /dev/null -w 'search http=%{http_code}\n' "$B/search?q=PROBE-SEARCH-ddd444"
kill $STUBPID; wait $STUBPID 2>/dev/null; sleep 1
curl -s -o /dev/null -w 'down http=%{http_code}\n' "$B/beta/verify?token=PROBE-DOWN-eee555"
sleep 1; kill $CPID; wait $CPID 2>/dev/null
for s in PROBE-MAGIC-aaa111 PROBE-INVITE-bbb222 PROBE-SEARCH-ddd444 PROBE-DOWN-eee555; do
  for f in "$R"/logs/*.log "$R/caddy-stderr.log"; do
    printf '%-22s %-24s %s\n' "$s" "$(basename "$f")" "$(grep -c -- "$s" "$f")"
  done
done
echo "== logged uri fields:"; grep -ho '"uri":"[^"]*"' "$R"/logs/*.log
echo "PROBE-DONE $LABEL"
