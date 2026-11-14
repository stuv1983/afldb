#!/usr/bin/env bash
# caddy357: run corpora through ONE isolated Caddy (admin off; run/validate/adapt --config only) in front of a stub.
# usage: matrix.sh <binary> <Caddyfile under test> <label> <corpus>...
# Config under test = the deploy file with sed-rewritten site addresses, upstream port and log/web paths + isolation options.
# SCOPE-TAG: caddy357-afldb-rem2-20261114
set -u
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
BIN=$1; CF=$2; LABEL=$3; shift 3
R=$W/matrix/$LABEL
rm -rf "$R"; mkdir -p "$R/logs" "$R/xdg/data" "$R/xdg/config" "$W/soon"
[ -f "$W/soon/index.html" ] || echo '<h1>soon</h1>' > "$W/soon/index.html"
{
  sed -e '0,/^{$/s//{\n\tadmin off\n\tauto_https off\n\tpersist_config off/' \
      -e "s#^beta\.afldb\.com {#http://beta.afldb.com:$CADDY_PORT {#" \
      -e "s#^www\.afldb\.com {#http://www.afldb.com:$CADDY_PORT {#" \
      -e "s#^afldb\.com {#http://afldb.com:$CADDY_PORT {#" \
      -e "s#^:8090 {#http://beta.afldb.com:$CADDY_PORT {#" \
      -e "s#127\.0\.0\.1:3100#127.0.0.1:$UP_PORT#g" \
      -e "s#/var/log/caddy/#$R/logs/#g" \
      -e "s#/var/www/afldb-soon#$W/soon#g" "$CF"
} > "$R/Caddyfile.test"
export XDG_DATA_HOME=$R/xdg/data XDG_CONFIG_HOME=$R/xdg/config
echo "== binary: $("$BIN" version)  sha256 $(sha256sum "$BIN" | cut -d' ' -f1)"
echo "== file under test: $CF sha256 $(sha256sum "$CF" | cut -d' ' -f1)"
"$BIN" adapt --config "$R/Caddyfile.test" --adapter caddyfile > "$R/adapted.json" 2> "$R/adapt.err"
echo "adapt(test copy) rc=$?"
grep -q '"admin":{"disabled":true' "$R/adapted.json" && echo "== admin guard: admin disabled in the adapted test config" || { echo "== ADMIN GUARD FAILED; refusing to run"; exit 3; }
"$BIN" validate --config "$R/Caddyfile.test" --adapter caddyfile > "$R/validate.out" 2>&1; echo "validate(test copy) rc=$? : $(tail -1 "$R/validate.out" | cut -c1-120)"
sed -e '0,/^{$/s//{\n\tadmin off\n\tpersist_config off/' -e "s#/var/log/caddy/#$R/logs/#g" -e "s#/var/www/afldb-soon#$W/soon#g" "$CF" > "$R/Caddyfile.realshape"
"$BIN" validate --config "$R/Caddyfile.realshape" --adapter caddyfile > "$R/validate-realshape.out" 2>&1; echo "validate(production shape: real host names, TLS automation; only admin off + log/web paths rewritten) rc=$? : $(tail -1 "$R/validate-realshape.out" | cut -c1-100)"
"$BIN" adapt --config "$CF" --adapter caddyfile > "$R/adapted-unmodified.json" 2> "$R/adapt-unmodified.err"; echo "adapt(UNMODIFIED deploy file) rc=$?"
"$BIN" validate --config "$CF" --adapter caddyfile > "$R/validate-unmodified.out" 2>&1; echo "validate(UNMODIFIED deploy file) rc=$? : $(tail -1 "$R/validate-unmodified.out" | cut -c1-120)"
if ss -ltnH | awk '{print $4}' | grep -E ":($CADDY_PORT|$UP_PORT)$"; then echo "port in use"; exit 1; fi
node "$W/in/stub.mjs" $UP_PORT "$R/upstream.jsonl" > "$R/stub.out" 2>&1 & STUBPID=$!
for _ in $(seq 1 50); do curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$UP_PORT/api/health" && break; sleep 0.1; done
"$BIN" run --config "$R/Caddyfile.test" --adapter caddyfile > "$R/caddy-stderr.log" 2>&1 & CPID=$!
echo "$CPID $STUBPID" > "$R/pids"
sleep 3
for c in "$@"; do
  n=$(basename "$c" .tsv)
  : > "$R/upstream.jsonl"
  node "$W/in/client.mjs" "$c" $CADDY_PORT "$R/result-$n.tsv"
  # Node's HTTP parser cannot read Go's answer to a HEAD with a malformed escape (HPE_CLOSED_CONNECTION): re-check those with curl
  if grep -q 'HPE_CLOSED_CONNECTION' "$R/result-$n.tsv"; then
    : > "$R/recheck-$n.tsv"
    grep 'HPE_CLOSED_CONNECTION' "$R/result-$n.tsv" | cut -f5 | while IFS= read -r tg; do
      printf '%s\t%s\n' "$(curl -s -o /dev/null -I --path-as-is --max-time 10 -H 'Host: beta.afldb.com' -w '%{http_code}' "http://127.0.0.1:$CADDY_PORT$tg")" "$tg" >> "$R/recheck-$n.tsv"
    done
    echo "  re-checked with curl -I: $(cut -f1 "$R/recheck-$n.tsv" | sort | uniq -c | tr '\n' ' ')"
  fi
  want=$(awk -F'\t' '$3=="pass" && $2!="/api/health"' "$c" | wc -l)   # the stub does not record /api/health
  got=$(wc -l < "$R/upstream.jsonl")
  echo "  upstream received $got requests; corpus expects $want to pass  $( [ "$want" = "$got" ] && echo EQUAL || echo DIFFERENT )"
done
if [ -n "${HOOK:-}" ]; then
  : > "$R/upstream.jsonl"
  export CADDY_PORT R
  bash "$HOOK" > "$R/hook.out" 2>&1
  echo "  hook $HOOK written to $R/hook.out ($(wc -l < "$R/hook.out") lines); upstream received $(wc -l < "$R/upstream.jsonl") requests during the hook"
fi
kill $STUBPID $CPID 2>/dev/null; wait $STUBPID $CPID 2>/dev/null
sleep 1
echo "== sentinel scan of the logs (0 expected everywhere)"
for s in PROBE-DENY-TOKEN-ddd444 PROBE-PATHSECRET-eee555 PROBE-QUERY-fff666 PROBE-INVITE-bbb222 PROBE-REFQ-hhh888 PROBE-COOKIE-iii999 PROBE-LONG-jjj000 PROBE-BAD-kkk111 PROBE-MAGIC-aaa111 PROBE-SEARCH-ccc333; do
  for f in "$R"/logs/*.log "$R/caddy-stderr.log"; do
    [ -f "$f" ] && printf '  %-26s %-24s %s\n' "$s" "$(basename "$f")" "$(grep -c -- "$s" "$f")"
  done
done
if [ -f "$R/logs/afldb-access.log" ]; then
  echo "== logged records of the hook (status uri), in order"
  grep -o '"status":[0-9]*' "$R/logs/afldb-access.log" | tail -0
  tail -19 "$R/logs/afldb-access.log" | sed -E 's/.*"uri":"([^"]*)".*"status":([0-9]+).*/  \2 \1/'
fi
sleep 1
ss -ltnH | awk '{print $4}' | grep -E ":($CADDY_PORT|$UP_PORT)$" && echo "STILL LISTENING" || echo "stopped: no listener on $CADDY_PORT/$UP_PORT"
pgrep -af "$R" >/dev/null && echo "PROCESS LEFT" || echo "no process of this run left"
echo "MATRIX-DONE $LABEL"
